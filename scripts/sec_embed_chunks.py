#!/usr/bin/env python3
"""
sec_embed_chunks.py - Generate Embeddings for SEC Filing Chunks

Creates embeddings for text chunks using Cloudflare Workers AI and stores
them in Vectorize for RAG queries.

Usage:
    python scripts/sec_embed_chunks.py --pending
    python scripts/sec_embed_chunks.py --filing-id 123
    python scripts/sec_embed_chunks.py --company BF.B
"""

import os
import sys
import json
import argparse
import logging
import time
from typing import List, Dict, Optional

import requests

# Add lib to path
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "lib"))

from d1_utils import init_d1_config, d1_execute

# Logging setup
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s - %(levelname)s - %(message)s",
    datefmt="%Y-%m-%d %H:%M:%S",
)
logger = logging.getLogger(__name__)

# Cloudflare API configuration
CF_ACCOUNT_ID = os.environ.get("CLOUDFLARE_ACCOUNT_ID")
CF_API_TOKEN = os.environ.get("CLOUDFLARE_API_TOKEN")
VECTORIZE_INDEX = "sec-filings-index"

# Rate limiting for Cloudflare AI
MIN_REQUEST_INTERVAL = 0.2  # 200ms between requests
_last_request_time = 0


def _rate_limit():
    """Enforce rate limiting for Cloudflare API."""
    global _last_request_time
    elapsed = time.time() - _last_request_time
    if elapsed < MIN_REQUEST_INTERVAL:
        time.sleep(MIN_REQUEST_INTERVAL - elapsed)
    _last_request_time = time.time()


def generate_embedding(text: str) -> Optional[List[float]]:
    """
    Generate embedding using Cloudflare Workers AI.

    Uses the bge-base-en-v1.5 model which produces 768-dimensional vectors.
    """
    if not CF_ACCOUNT_ID or not CF_API_TOKEN:
        logger.error("Cloudflare credentials not configured")
        return None

    _rate_limit()

    url = f"https://api.cloudflare.com/client/v4/accounts/{CF_ACCOUNT_ID}/ai/run/@cf/baai/bge-base-en-v1.5"

    try:
        response = requests.post(
            url,
            headers={
                "Authorization": f"Bearer {CF_API_TOKEN}",
                "Content-Type": "application/json"
            },
            json={"text": text},
            timeout=30
        )
        response.raise_for_status()
        data = response.json()

        if data.get("success") and data.get("result"):
            return data["result"]["data"][0]
        else:
            logger.error(f"Embedding API error: {data.get('errors')}")
            return None

    except Exception as e:
        logger.error(f"Failed to generate embedding: {e}")
        return None


def upsert_to_vectorize(vectors: List[Dict]) -> bool:
    """
    Upsert vectors to Cloudflare Vectorize.

    Args:
        vectors: List of dicts with 'id', 'values', and 'metadata'

    Returns:
        True if successful
    """
    if not CF_ACCOUNT_ID or not CF_API_TOKEN:
        logger.error("Cloudflare credentials not configured")
        return False

    url = f"https://api.cloudflare.com/client/v4/accounts/{CF_ACCOUNT_ID}/vectorize/indexes/{VECTORIZE_INDEX}/upsert"

    try:
        # Vectorize expects NDJSON format
        ndjson_lines = []
        for v in vectors:
            ndjson_lines.append(json.dumps(v))
        ndjson_body = "\n".join(ndjson_lines)

        response = requests.post(
            url,
            headers={
                "Authorization": f"Bearer {CF_API_TOKEN}",
                "Content-Type": "application/x-ndjson"
            },
            data=ndjson_body,
            timeout=60
        )
        response.raise_for_status()
        data = response.json()

        if data.get("success"):
            logger.debug(f"Upserted {len(vectors)} vectors")
            return True
        else:
            logger.error(f"Vectorize upsert error: {data.get('errors')}")
            return False

    except Exception as e:
        logger.error(f"Failed to upsert to Vectorize: {e}")
        return False


def get_pending_chunks(limit: int = 100) -> List[Dict]:
    """Get chunks that don't have embeddings yet."""
    result = d1_execute(f"""
        SELECT
            c.id, c.content, c.filing_id, c.section_id, c.chunk_index,
            sf.filing_type, sf.fiscal_year,
            sc.ticker, sc.company_name
        FROM sec_filing_chunks c
        JOIN sec_filings sf ON c.filing_id = sf.id
        JOIN sec_companies sc ON sf.sec_company_id = sc.id
        WHERE c.vector_id IS NULL
        ORDER BY sf.filing_date DESC
        LIMIT {limit}
    """)

    if result.get("success") and result.get("result"):
        return result["result"][0].get("results", [])
    return []


def get_chunks_by_filing(filing_id: int) -> List[Dict]:
    """Get all chunks for a specific filing."""
    result = d1_execute(f"""
        SELECT
            c.id, c.content, c.filing_id, c.section_id, c.chunk_index,
            sf.filing_type, sf.fiscal_year,
            sc.ticker, sc.company_name
        FROM sec_filing_chunks c
        JOIN sec_filings sf ON c.filing_id = sf.id
        JOIN sec_companies sc ON sf.sec_company_id = sc.id
        WHERE c.filing_id = {filing_id}
        ORDER BY c.chunk_index
    """)

    if result.get("success") and result.get("result"):
        return result["result"][0].get("results", [])
    return []


def get_chunks_by_company(ticker: str, limit: int = 500) -> List[Dict]:
    """Get all unembedded chunks for a company."""
    result = d1_execute(f"""
        SELECT
            c.id, c.content, c.filing_id, c.section_id, c.chunk_index,
            sf.filing_type, sf.fiscal_year,
            sc.ticker, sc.company_name
        FROM sec_filing_chunks c
        JOIN sec_filings sf ON c.filing_id = sf.id
        JOIN sec_companies sc ON sf.sec_company_id = sc.id
        WHERE sc.ticker = '{ticker}'
          AND c.vector_id IS NULL
        ORDER BY sf.filing_date DESC, c.chunk_index
        LIMIT {limit}
    """)

    if result.get("success") and result.get("result"):
        return result["result"][0].get("results", [])
    return []


def update_chunk_vector_id(chunk_id: int, vector_id: str):
    """Update chunk record with its Vectorize vector ID."""
    d1_execute(
        "UPDATE sec_filing_chunks SET vector_id = ? WHERE id = ?",
        [vector_id, chunk_id]
    )


def process_chunks(chunks: List[Dict], batch_size: int = 10) -> Dict:
    """
    Process a list of chunks: generate embeddings and store in Vectorize.

    Args:
        chunks: List of chunk records from database
        batch_size: Number of vectors to upsert at once

    Returns:
        Dict with processing stats
    """
    if not chunks:
        return {"processed": 0}

    stats = {"processed": 0, "errors": 0}
    vectors_batch = []

    for chunk in chunks:
        chunk_id = chunk["id"]
        content = chunk["content"]

        # Generate embedding
        embedding = generate_embedding(content)
        if not embedding:
            logger.warning(f"Failed to embed chunk {chunk_id}")
            stats["errors"] += 1
            continue

        # Build vector record with metadata for filtering
        vector_id = f"chunk-{chunk_id}"
        vector = {
            "id": vector_id,
            "values": embedding,
            "metadata": {
                "chunk_id": chunk_id,
                "filing_id": chunk["filing_id"],
                "ticker": chunk["ticker"],
                "company_name": chunk["company_name"],
                "filing_type": chunk["filing_type"],
                "fiscal_year": chunk["fiscal_year"],
            }
        }
        vectors_batch.append(vector)

        # Track for D1 update
        chunk["vector_id"] = vector_id

        # Upsert in batches
        if len(vectors_batch) >= batch_size:
            if upsert_to_vectorize(vectors_batch):
                # Update D1 records
                for v in vectors_batch:
                    cid = v["metadata"]["chunk_id"]
                    update_chunk_vector_id(cid, v["id"])
                stats["processed"] += len(vectors_batch)
                logger.info(f"Upserted batch of {len(vectors_batch)} vectors")
            else:
                stats["errors"] += len(vectors_batch)

            vectors_batch = []

    # Final batch
    if vectors_batch:
        if upsert_to_vectorize(vectors_batch):
            for v in vectors_batch:
                cid = v["metadata"]["chunk_id"]
                update_chunk_vector_id(cid, v["id"])
            stats["processed"] += len(vectors_batch)
            logger.info(f"Upserted final batch of {len(vectors_batch)} vectors")
        else:
            stats["errors"] += len(vectors_batch)

    return stats


def main():
    parser = argparse.ArgumentParser(description="Generate embeddings for SEC filing chunks")
    parser.add_argument("--pending", action="store_true", help="Process all pending chunks")
    parser.add_argument("--filing-id", type=int, help="Process chunks for a specific filing")
    parser.add_argument("--company", help="Process chunks for a specific company ticker")
    parser.add_argument("--limit", type=int, default=100, help="Max chunks to process")
    parser.add_argument("--batch-size", type=int, default=10, help="Vectorize upsert batch size")
    parser.add_argument("--dry-run", action="store_true", help="Print what would be processed")
    args = parser.parse_args()

    # Initialize D1
    init_d1_config(logger=logger)

    # Get chunks to process
    if args.filing_id:
        chunks = get_chunks_by_filing(args.filing_id)
    elif args.company:
        chunks = get_chunks_by_company(args.company, args.limit)
    elif args.pending:
        chunks = get_pending_chunks(args.limit)
    else:
        parser.print_help()
        return

    logger.info(f"Found {len(chunks)} chunks to process")

    if args.dry_run:
        logger.info("[DRY RUN] Would process:")
        for chunk in chunks[:10]:
            logger.info(f"  - Chunk {chunk['id']}: {chunk['ticker']} {chunk['filing_type']} ({len(chunk['content'])} chars)")
        if len(chunks) > 10:
            logger.info(f"  ... and {len(chunks) - 10} more")
        return

    # Process chunks
    result = process_chunks(chunks, args.batch_size)
    print(json.dumps(result, indent=2))


if __name__ == "__main__":
    main()

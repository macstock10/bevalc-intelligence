#!/usr/bin/env python3
"""Backfill missing brand_slugs from colas table."""
import os
import sys
from pathlib import Path

# Load .env
env_file = Path(__file__).parent.parent / ".env"
if env_file.exists():
    with open(env_file) as f:
        for line in f:
            line = line.strip()
            if line and not line.startswith('#') and '=' in line:
                key, value = line.split('=', 1)
                os.environ[key.strip()] = value.strip()

sys.path.insert(0, str(Path(__file__).parent))

from lib.d1_utils import d1_execute, escape_sql_value, make_slug, init_d1_config

# Initialize D1
init_d1_config()

def backfill():
    print("Fetching all distinct brand names from colas...")

    # Get all distinct brand names
    result = d1_execute("SELECT DISTINCT brand_name FROM colas WHERE brand_name IS NOT NULL AND brand_name != ''")

    if not result.get("success"):
        print(f"Error: {result}")
        return

    brands = [r["brand_name"] for r in result.get("result", [{}])[0].get("results", [])]
    print(f"Found {len(brands):,} distinct brands")

    # Build values for insert
    values = []
    for brand_name in brands:
        slug = make_slug(brand_name)
        if slug:
            values.append(f"({escape_sql_value(slug)}, {escape_sql_value(brand_name)}, 1)")

    print(f"Inserting {len(values):,} brand slugs...")

    # Insert in batches
    batch_size = 1000
    total_inserted = 0

    for i in range(0, len(values), batch_size):
        batch = values[i:i + batch_size]
        batch_num = i // batch_size + 1
        total_batches = (len(values) + batch_size - 1) // batch_size

        print(f"  Batch {batch_num}/{total_batches}...", end=" ", flush=True)

        sql = f"INSERT OR IGNORE INTO brand_slugs (slug, brand_name, filing_count) VALUES {','.join(batch)}"
        result = d1_execute(sql)

        if result.get("success"):
            changes = 0
            for res in result.get("result", []):
                changes += res.get("meta", {}).get("changes", 0)
            total_inserted += changes
            print(f"{changes} new")
        else:
            print(f"ERROR: {result.get('error', 'Unknown')}")

    print(f"\nTotal new brands added: {total_inserted:,}")

if __name__ == "__main__":
    backfill()

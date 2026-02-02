"""
sec_edgar.py - SEC EDGAR API Client

Provides rate-limited access to SEC EDGAR API for fetching company filings.
Follows SEC fair access guidelines: 10 requests per second max.

Features:
- Rate limiting (10 req/sec max)
- Exponential backoff retry on failures
- Circuit breaker for persistent failures
- Structured logging

Functions:
- get_company_filings: Fetch filing list for a company
- get_filing_document: Download raw filing document
- get_filing_metadata: Get filing metadata from EDGAR
"""

import os
import time
import logging
from typing import List, Dict, Any, Optional
from datetime import datetime, timedelta

import requests

from retry_utils import (
    retry_with_backoff,
    RetryConfig,
    RateLimiter,
    CircuitBreaker,
    with_circuit_breaker
)

# SEC EDGAR API Configuration
EDGAR_BASE_URL = "https://data.sec.gov"
EDGAR_ARCHIVES_URL = "https://www.sec.gov/Archives/edgar/data"
SEC_USER_AGENT = "BevAlcIntelligence/1.0 (hello@bevalcintel.com)"

# Target companies for v1
TARGET_COMPANIES = {
    "BF.B": {"cik": "0000014693", "name": "Brown-Forman Corporation"},
    "STZ": {"cik": "0000016918", "name": "Constellation Brands, Inc."},
    "TAP": {"cik": "0000024545", "name": "Molson Coors Beverage Company"},
    "SAM": {"cik": "0000949870", "name": "Boston Beer Company, Inc."},
    "MGPI": {"cik": "0000835011", "name": "MGP Ingredients, Inc."},
}

# Module state
_logger = None
_rate_limiter = None
_circuit_breaker = None
_retry_config = None


def init_edgar_client(logger: logging.Logger = None):
    """
    Initialize the EDGAR client with optional logger.

    Sets up rate limiter (10 req/sec), circuit breaker, and retry config.
    """
    global _logger, _rate_limiter, _circuit_breaker, _retry_config
    _logger = logger or logging.getLogger(__name__)

    # Rate limiter: SEC allows 10 requests/second, we use 8 to be safe
    _rate_limiter = RateLimiter(rate=8, per=1.0)

    # Circuit breaker: open after 5 consecutive failures, retry after 60s
    _circuit_breaker = CircuitBreaker(
        failure_threshold=5,
        recovery_timeout=60.0,
        logger=_logger
    )

    # Retry config: 3 attempts with exponential backoff
    _retry_config = RetryConfig(
        max_attempts=3,
        base_delay=2.0,
        max_delay=30.0,
        retryable_status_codes=(429, 500, 502, 503, 504)
    )


def _get_logger():
    """Get configured logger or default."""
    return _logger or logging.getLogger(__name__)


def _get_rate_limiter():
    """Get rate limiter, initializing if needed."""
    global _rate_limiter
    if _rate_limiter is None:
        _rate_limiter = RateLimiter(rate=8, per=1.0)
    return _rate_limiter


def _get_circuit_breaker():
    """Get circuit breaker, initializing if needed."""
    global _circuit_breaker
    if _circuit_breaker is None:
        _circuit_breaker = CircuitBreaker(failure_threshold=5, recovery_timeout=60.0)
    return _circuit_breaker


def _get_retry_config():
    """Get retry config, initializing if needed."""
    global _retry_config
    if _retry_config is None:
        _retry_config = RetryConfig(max_attempts=3, base_delay=2.0)
    return _retry_config


def _make_request(url: str, headers: Dict = None) -> Optional[requests.Response]:
    """
    Make rate-limited request to SEC EDGAR with retry and circuit breaker.

    Args:
        url: URL to request
        headers: Optional additional headers

    Returns:
        Response object or None on failure
    """
    logger = _get_logger()
    rate_limiter = _get_rate_limiter()
    circuit_breaker = _get_circuit_breaker()

    # Check circuit breaker
    if not circuit_breaker.can_execute():
        logger.warning(f"Circuit breaker open, skipping request: {url}")
        return None

    # Rate limit
    wait_time = rate_limiter.wait()
    if wait_time > 0:
        logger.debug(f"Rate limited, waited {wait_time:.2f}s")

    default_headers = {
        "User-Agent": SEC_USER_AGENT,
        "Accept-Encoding": "gzip, deflate",
        "Accept": "application/json, text/html, */*",
    }
    if headers:
        default_headers.update(headers)

    config = _get_retry_config()
    last_error = None

    for attempt in range(config.max_attempts):
        try:
            response = requests.get(url, headers=default_headers, timeout=30)

            # Handle rate limiting
            if response.status_code == 429:
                retry_after = response.headers.get("Retry-After", "10")
                try:
                    wait = float(retry_after)
                except ValueError:
                    wait = 10.0
                logger.warning(f"Rate limited by SEC, waiting {wait}s")
                time.sleep(wait)
                continue

            # Handle server errors with retry
            if response.status_code in config.retryable_status_codes:
                if attempt < config.max_attempts - 1:
                    delay = config.base_delay * (config.exponential_base ** attempt)
                    logger.warning(f"SEC returned {response.status_code}, retrying in {delay:.1f}s")
                    time.sleep(delay)
                    continue

            response.raise_for_status()
            circuit_breaker.record_success()
            return response

        except requests.exceptions.RequestException as e:
            last_error = e
            if attempt < config.max_attempts - 1:
                delay = config.base_delay * (config.exponential_base ** attempt)
                logger.warning(f"Request failed: {e}, retrying in {delay:.1f}s")
                time.sleep(delay)
            else:
                logger.error(f"Request failed after {config.max_attempts} attempts: {e}")
                circuit_breaker.record_failure()

    return None


def get_company_cik(ticker: str) -> Optional[str]:
    """Get CIK for a ticker symbol."""
    if ticker in TARGET_COMPANIES:
        return TARGET_COMPANIES[ticker]["cik"]
    return None


def get_company_filings(
    cik: str,
    filing_types: List[str] = None,
    start_date: str = None,
    end_date: str = None,
    max_filings: int = 100
) -> List[Dict]:
    """
    Fetch list of filings for a company from SEC EDGAR.

    Args:
        cik: Company CIK (with or without leading zeros)
        filing_types: Filter by filing type (e.g., ['10-K', '10-Q', '8-K'])
        start_date: Filter filings on or after this date (YYYY-MM-DD)
        end_date: Filter filings on or before this date (YYYY-MM-DD)
        max_filings: Maximum number of filings to return

    Returns:
        List of filing metadata dicts
    """
    logger = _get_logger()

    # Normalize CIK (remove leading zeros for API, keep for URLs)
    cik_int = int(cik.lstrip("0"))
    cik_padded = str(cik_int).zfill(10)

    # Use submissions endpoint for filing history
    url = f"{EDGAR_BASE_URL}/submissions/CIK{cik_padded}.json"

    response = _make_request(url)
    if not response:
        return []

    try:
        data = response.json()
    except Exception as e:
        logger.error(f"Failed to parse EDGAR response: {e}")
        return []

    filings = []
    recent = data.get("filings", {}).get("recent", {})

    # Extract filing arrays
    accession_numbers = recent.get("accessionNumber", [])
    filing_dates = recent.get("filingDate", [])
    forms = recent.get("form", [])
    primary_documents = recent.get("primaryDocument", [])
    report_dates = recent.get("reportDate", [])

    # Parse start/end dates if provided
    start_dt = datetime.strptime(start_date, "%Y-%m-%d") if start_date else None
    end_dt = datetime.strptime(end_date, "%Y-%m-%d") if end_date else None

    for i in range(len(accession_numbers)):
        form = forms[i] if i < len(forms) else ""
        filing_date = filing_dates[i] if i < len(filing_dates) else ""

        # Filter by filing type
        if filing_types and form not in filing_types:
            continue

        # Filter by date
        if filing_date:
            try:
                fd = datetime.strptime(filing_date, "%Y-%m-%d")
                if start_dt and fd < start_dt:
                    continue
                if end_dt and fd > end_dt:
                    continue
            except ValueError:
                pass

        accession = accession_numbers[i]
        accession_clean = accession.replace("-", "")

        filing = {
            "accession_number": accession,
            "filing_type": form,
            "filing_date": filing_date,
            "report_date": report_dates[i] if i < len(report_dates) else None,
            "primary_document": primary_documents[i] if i < len(primary_documents) else None,
            "cik": cik_padded,
            "edgar_url": f"{EDGAR_ARCHIVES_URL}/{cik_int}/{accession_clean}/{accession}-index.html",
            "document_url": None,
        }

        # Build primary document URL
        if filing["primary_document"]:
            filing["document_url"] = f"{EDGAR_ARCHIVES_URL}/{cik_int}/{accession_clean}/{filing['primary_document']}"

        filings.append(filing)

        if len(filings) >= max_filings:
            break

    logger.info(f"Found {len(filings)} filings for CIK {cik}")
    return filings


def get_filing_document(cik: str, accession_number: str, document_name: str = None) -> Optional[str]:
    """
    Download raw filing document from SEC EDGAR.

    Args:
        cik: Company CIK
        accession_number: Filing accession number (e.g., "0000014693-24-000045")
        document_name: Specific document to fetch (e.g., "bfb-20240430.htm")

    Returns:
        Raw document content as string, or None on error
    """
    logger = _get_logger()

    cik_int = int(cik.lstrip("0"))
    accession_clean = accession_number.replace("-", "")

    if document_name:
        url = f"{EDGAR_ARCHIVES_URL}/{cik_int}/{accession_clean}/{document_name}"
    else:
        # Fetch the full submission text file
        url = f"{EDGAR_ARCHIVES_URL}/{cik_int}/{accession_clean}/{accession_number}.txt"

    response = _make_request(url)
    if not response:
        return None

    return response.text


def get_filing_index(cik: str, accession_number: str) -> Optional[Dict]:
    """
    Get filing index with list of all documents in the filing.

    Args:
        cik: Company CIK
        accession_number: Filing accession number

    Returns:
        Dict with filing documents and metadata
    """
    logger = _get_logger()

    cik_int = int(cik.lstrip("0"))
    cik_padded = str(cik_int).zfill(10)
    accession_clean = accession_number.replace("-", "")

    url = f"{EDGAR_BASE_URL}/submissions/CIK{cik_padded}/{accession_clean}.json"

    response = _make_request(url)
    if not response:
        # Fallback to index page parsing
        return _parse_filing_index_html(cik, accession_number)

    try:
        return response.json()
    except Exception as e:
        logger.error(f"Failed to parse filing index: {e}")
        return None


def _parse_filing_index_html(cik: str, accession_number: str) -> Optional[Dict]:
    """Fallback: parse filing index HTML page."""
    logger = _get_logger()

    cik_int = int(cik.lstrip("0"))
    accession_clean = accession_number.replace("-", "")

    url = f"{EDGAR_ARCHIVES_URL}/{cik_int}/{accession_clean}/{accession_number}-index.html"

    response = _make_request(url)
    if not response:
        return None

    # Basic HTML parsing for document list
    import re

    documents = []
    html = response.text

    # Find document links in the index page
    doc_pattern = r'<a href="([^"]+\.htm[l]?)"[^>]*>([^<]+)</a>'
    matches = re.findall(doc_pattern, html, re.IGNORECASE)

    for filename, description in matches:
        documents.append({
            "filename": filename,
            "description": description.strip(),
        })

    return {"documents": documents}


def parse_fiscal_period(filing_type: str, report_date: str) -> Dict:
    """
    Parse fiscal year and quarter from filing metadata.

    Args:
        filing_type: Filing type (10-K, 10-Q, 8-K)
        report_date: Report period end date (YYYY-MM-DD)

    Returns:
        Dict with fiscal_year and fiscal_quarter
    """
    result = {"fiscal_year": None, "fiscal_quarter": None}

    if not report_date:
        return result

    try:
        dt = datetime.strptime(report_date, "%Y-%m-%d")
        result["fiscal_year"] = dt.year

        # Determine quarter based on month
        month = dt.month
        if filing_type == "10-K":
            # Annual report - no quarter
            result["fiscal_quarter"] = None
        elif filing_type == "10-Q":
            # Quarterly report
            if month in [1, 2, 3]:
                result["fiscal_quarter"] = 1
            elif month in [4, 5, 6]:
                result["fiscal_quarter"] = 2
            elif month in [7, 8, 9]:
                result["fiscal_quarter"] = 3
            else:
                result["fiscal_quarter"] = 4
        # 8-K doesn't have quarters

    except ValueError:
        pass

    return result


def get_historical_filings(
    ticker: str,
    years_10k: int = 5,
    years_10q: int = 3,
    years_8k: int = 2
) -> List[Dict]:
    """
    Get historical filings for a company based on specified depth.

    Args:
        ticker: Company ticker symbol
        years_10k: Number of years of 10-K filings to fetch
        years_10q: Number of years of 10-Q filings to fetch
        years_8k: Number of years of 8-K filings to fetch

    Returns:
        List of all matching filings
    """
    logger = _get_logger()

    company = TARGET_COMPANIES.get(ticker)
    if not company:
        logger.error(f"Unknown ticker: {ticker}")
        return []

    cik = company["cik"]
    today = datetime.now()

    all_filings = []

    # Fetch 10-K filings
    if years_10k > 0:
        start_date = (today - timedelta(days=years_10k * 365)).strftime("%Y-%m-%d")
        filings = get_company_filings(
            cik,
            filing_types=["10-K"],
            start_date=start_date,
            max_filings=years_10k + 2  # Buffer for fiscal year timing
        )
        all_filings.extend(filings)
        logger.info(f"Fetched {len(filings)} 10-K filings for {ticker}")

    # Fetch 10-Q filings
    if years_10q > 0:
        start_date = (today - timedelta(days=years_10q * 365)).strftime("%Y-%m-%d")
        filings = get_company_filings(
            cik,
            filing_types=["10-Q"],
            start_date=start_date,
            max_filings=years_10q * 4 + 4  # 4 quarters per year + buffer
        )
        all_filings.extend(filings)
        logger.info(f"Fetched {len(filings)} 10-Q filings for {ticker}")

    # Fetch 8-K filings
    if years_8k > 0:
        start_date = (today - timedelta(days=years_8k * 365)).strftime("%Y-%m-%d")
        filings = get_company_filings(
            cik,
            filing_types=["8-K"],
            start_date=start_date,
            max_filings=100  # 8-Ks can be frequent
        )
        all_filings.extend(filings)
        logger.info(f"Fetched {len(filings)} 8-K filings for {ticker}")

    return all_filings


def get_circuit_breaker_status() -> Dict:
    """Get current circuit breaker status for monitoring."""
    cb = _get_circuit_breaker()
    return {
        "state": cb.state,
        "failures": cb.failures,
        "threshold": cb.failure_threshold,
        "recovery_timeout": cb.recovery_timeout
    }

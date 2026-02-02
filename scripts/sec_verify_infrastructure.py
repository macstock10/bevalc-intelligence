#!/usr/bin/env python3
"""
sec_verify_infrastructure.py - SEC Research Infrastructure Verification

Verifies all infrastructure components are properly configured:
- D1 database schema
- R2 bucket
- Vectorize index
- API endpoints
- Environment variables

Usage:
    python scripts/sec_verify_infrastructure.py
    python scripts/sec_verify_infrastructure.py --fix  # Attempt to fix issues
    python scripts/sec_verify_infrastructure.py --verbose
"""

import os
import sys
import json
import argparse
import logging
from typing import Dict, List, Tuple
from datetime import datetime

import requests

# Add lib to path
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "lib"))

# Logging setup
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s - %(levelname)s - %(message)s",
    datefmt="%Y-%m-%d %H:%M:%S",
)
logger = logging.getLogger(__name__)

# ANSI colors for terminal output (disabled on Windows by default)
import platform
_USE_COLORS = platform.system() != "Windows" or os.environ.get("FORCE_COLOR")

class Colors:
    GREEN = '\033[92m' if _USE_COLORS else ''
    RED = '\033[91m' if _USE_COLORS else ''
    YELLOW = '\033[93m' if _USE_COLORS else ''
    BLUE = '\033[94m' if _USE_COLORS else ''
    RESET = '\033[0m' if _USE_COLORS else ''
    BOLD = '\033[1m' if _USE_COLORS else ''


def check_mark(success: bool) -> str:
    """Return check or X mark (ASCII safe for Windows)."""
    if success:
        return f"{Colors.GREEN}[OK]{Colors.RESET}"
    return f"{Colors.RED}[FAIL]{Colors.RESET}"


def print_header(title: str):
    """Print section header."""
    print(f"\n{'='*60}")
    print(f"{Colors.BOLD}{title}{Colors.RESET}")
    print(f"{'='*60}")


def print_result(name: str, success: bool, message: str = ""):
    """Print check result."""
    mark = check_mark(success)
    status = f"{Colors.GREEN}OK{Colors.RESET}" if success else f"{Colors.RED}FAILED{Colors.RESET}"
    if message:
        print(f"  {mark} {name}: {status} - {message}")
    else:
        print(f"  {mark} {name}: {status}")


class InfrastructureVerifier:
    """Verifies SEC Research infrastructure components."""

    def __init__(self, verbose: bool = False):
        self.verbose = verbose
        self.results: List[Tuple[str, bool, str]] = []
        self.cf_account_id = os.environ.get("CLOUDFLARE_ACCOUNT_ID")
        self.cf_api_token = os.environ.get("CLOUDFLARE_API_TOKEN")
        self.d1_database_id = os.environ.get("CLOUDFLARE_D1_DATABASE_ID")

    def add_result(self, name: str, success: bool, message: str = ""):
        """Add a check result."""
        self.results.append((name, success, message))
        print_result(name, success, message)

    def check_environment_variables(self) -> bool:
        """Check required environment variables are set."""
        print_header("Environment Variables")

        required_vars = [
            ("CLOUDFLARE_ACCOUNT_ID", self.cf_account_id),
            ("CLOUDFLARE_API_TOKEN", self.cf_api_token),
            ("CLOUDFLARE_D1_DATABASE_ID", self.d1_database_id),
        ]

        optional_vars = [
            ("R2_ACCESS_KEY_ID", os.environ.get("R2_ACCESS_KEY_ID")),
            ("R2_SECRET_ACCESS_KEY", os.environ.get("R2_SECRET_ACCESS_KEY")),
            ("ANTHROPIC_API_KEY", os.environ.get("ANTHROPIC_API_KEY")),
        ]

        all_required_set = True
        for name, value in required_vars:
            is_set = bool(value)
            if not is_set:
                all_required_set = False
            self.add_result(name, is_set, "Set" if is_set else "NOT SET (required)")

        for name, value in optional_vars:
            is_set = bool(value)
            self.add_result(name, is_set, "Set" if is_set else "Not set (optional)")

        return all_required_set

    def check_d1_connection(self) -> bool:
        """Check D1 database connection."""
        print_header("D1 Database Connection")

        if not self.cf_account_id or not self.cf_api_token or not self.d1_database_id:
            self.add_result("D1 Connection", False, "Missing credentials")
            return False

        url = f"https://api.cloudflare.com/client/v4/accounts/{self.cf_account_id}/d1/database/{self.d1_database_id}/query"

        try:
            response = requests.post(
                url,
                headers={
                    "Authorization": f"Bearer {self.cf_api_token}",
                    "Content-Type": "application/json"
                },
                json={"sql": "SELECT 1 as test"},
                timeout=10
            )

            if response.status_code == 200:
                data = response.json()
                if data.get("success"):
                    self.add_result("D1 Connection", True, "Connected successfully")
                    return True

            self.add_result("D1 Connection", False, f"HTTP {response.status_code}")
            return False

        except Exception as e:
            self.add_result("D1 Connection", False, str(e))
            return False

    def check_d1_schema(self) -> bool:
        """Check D1 database has SEC tables."""
        print_header("D1 Schema (SEC Tables)")

        required_tables = [
            "sec_companies",
            "sec_filings",
            "sec_filing_sections",
            "sec_filing_chunks",
            "sec_8k_events",
            "sec_mda_diffs",
            "sec_query_cache",
        ]

        if not self.cf_account_id or not self.cf_api_token or not self.d1_database_id:
            self.add_result("Schema Check", False, "Missing credentials")
            return False

        url = f"https://api.cloudflare.com/client/v4/accounts/{self.cf_account_id}/d1/database/{self.d1_database_id}/query"

        all_exist = True
        for table in required_tables:
            try:
                response = requests.post(
                    url,
                    headers={
                        "Authorization": f"Bearer {self.cf_api_token}",
                        "Content-Type": "application/json"
                    },
                    json={"sql": f"SELECT name FROM sqlite_master WHERE type='table' AND name='{table}'"},
                    timeout=10
                )

                exists = False
                if response.status_code == 200:
                    data = response.json()
                    if data.get("success") and data.get("result"):
                        results = data["result"][0].get("results", [])
                        exists = len(results) > 0

                self.add_result(f"Table: {table}", exists, "Exists" if exists else "MISSING - run migration")
                if not exists:
                    all_exist = False

            except Exception as e:
                self.add_result(f"Table: {table}", False, str(e))
                all_exist = False

        return all_exist

    def check_sec_companies_data(self) -> bool:
        """Check sec_companies has the target companies."""
        print_header("SEC Companies Data")

        expected_companies = ["BF.B", "STZ", "TAP", "SAM", "MGPI"]

        url = f"https://api.cloudflare.com/client/v4/accounts/{self.cf_account_id}/d1/database/{self.d1_database_id}/query"

        try:
            response = requests.post(
                url,
                headers={
                    "Authorization": f"Bearer {self.cf_api_token}",
                    "Content-Type": "application/json"
                },
                json={"sql": "SELECT ticker FROM sec_companies ORDER BY ticker"},
                timeout=10
            )

            if response.status_code == 200:
                data = response.json()
                if data.get("success") and data.get("result"):
                    results = data["result"][0].get("results", [])
                    tickers = [r["ticker"] for r in results]

                    all_present = True
                    for company in expected_companies:
                        present = company in tickers
                        self.add_result(f"Company: {company}", present)
                        if not present:
                            all_present = False

                    return all_present

            self.add_result("Companies Data", False, "Query failed")
            return False

        except Exception as e:
            self.add_result("Companies Data", False, str(e))
            return False

    def check_r2_bucket(self) -> bool:
        """Check R2 bucket exists and is accessible."""
        print_header("R2 Bucket")

        # Check for S3 credentials
        r2_key = os.environ.get("R2_ACCESS_KEY_ID")
        r2_secret = os.environ.get("R2_SECRET_ACCESS_KEY")

        if r2_key and r2_secret:
            try:
                import boto3
                from botocore.config import Config

                r2_endpoint = f"https://{self.cf_account_id}.r2.cloudflarestorage.com"
                s3 = boto3.client(
                    "s3",
                    endpoint_url=r2_endpoint,
                    aws_access_key_id=r2_key,
                    aws_secret_access_key=r2_secret,
                    config=Config(signature_version="s3v4"),
                    region_name="auto"
                )

                # Try to list bucket (will fail if doesn't exist)
                s3.head_bucket(Bucket="bevalc-sec-filings")
                self.add_result("R2 Bucket", True, "bevalc-sec-filings exists")
                return True

            except Exception as e:
                if "404" in str(e) or "NoSuchBucket" in str(e):
                    self.add_result("R2 Bucket", False, "Bucket does not exist - create with: npx wrangler r2 bucket create bevalc-sec-filings")
                else:
                    self.add_result("R2 Bucket", False, f"Error: {e}")
                return False
        else:
            self.add_result("R2 Bucket", False, "R2 credentials not configured (optional - will use D1 only)")
            return False

    def check_vectorize_index(self) -> bool:
        """Check Vectorize index exists."""
        print_header("Vectorize Index")

        if not self.cf_account_id or not self.cf_api_token:
            self.add_result("Vectorize Index", False, "Missing credentials")
            return False

        url = f"https://api.cloudflare.com/client/v4/accounts/{self.cf_account_id}/vectorize/indexes/sec-filings-index"

        try:
            response = requests.get(
                url,
                headers={"Authorization": f"Bearer {self.cf_api_token}"},
                timeout=10
            )

            if response.status_code == 200:
                data = response.json()
                if data.get("success"):
                    index_info = data.get("result", {})
                    dimensions = index_info.get("config", {}).get("dimensions", "?")
                    metric = index_info.get("config", {}).get("metric", "?")
                    self.add_result("Vectorize Index", True, f"sec-filings-index ({dimensions}d, {metric})")
                    return True

            if response.status_code == 404:
                self.add_result("Vectorize Index", False,
                    "Index does not exist - create with: npx wrangler vectorize create sec-filings-index --dimensions 768 --metric cosine")
            else:
                self.add_result("Vectorize Index", False, f"HTTP {response.status_code}")
            return False

        except Exception as e:
            self.add_result("Vectorize Index", False, str(e))
            return False

    def check_api_endpoints(self, base_url: str = "https://bevalc-api.yourdomain.workers.dev") -> bool:
        """Check API endpoints are responding."""
        print_header("API Endpoints")

        # Use localhost if testing locally
        if os.environ.get("API_BASE_URL"):
            base_url = os.environ.get("API_BASE_URL")

        endpoints = [
            ("/api/sec/companies", "GET"),
            ("/api/sec/filings", "GET"),
            ("/api/sec/8k-events", "GET"),
        ]

        all_ok = True
        for endpoint, method in endpoints:
            try:
                url = f"{base_url}{endpoint}"
                if method == "GET":
                    response = requests.get(url, timeout=10)
                else:
                    response = requests.post(url, json={}, timeout=10)

                success = response.status_code in [200, 400, 401]  # 400/401 means endpoint exists
                self.add_result(f"{method} {endpoint}", success, f"HTTP {response.status_code}")
                if not success:
                    all_ok = False

            except requests.exceptions.ConnectionError:
                self.add_result(f"{method} {endpoint}", False, "Connection failed - is worker deployed?")
                all_ok = False
            except Exception as e:
                self.add_result(f"{method} {endpoint}", False, str(e))
                all_ok = False

        return all_ok

    def check_edgar_connectivity(self) -> bool:
        """Check SEC EDGAR is accessible."""
        print_header("SEC EDGAR Connectivity")

        try:
            response = requests.get(
                "https://data.sec.gov/submissions/CIK0000014693.json",
                headers={
                    "User-Agent": "BevAlcIntelligence/1.0 (hello@bevalcintel.com)"
                },
                timeout=10
            )

            if response.status_code == 200:
                data = response.json()
                company_name = data.get("name", "Unknown")
                self.add_result("EDGAR API", True, f"Connected - Test: {company_name}")
                return True

            self.add_result("EDGAR API", False, f"HTTP {response.status_code}")
            return False

        except Exception as e:
            self.add_result("EDGAR API", False, str(e))
            return False

    def get_summary(self) -> Dict:
        """Get summary of all checks."""
        total = len(self.results)
        passed = sum(1 for _, success, _ in self.results if success)
        failed = total - passed

        return {
            "total_checks": total,
            "passed": passed,
            "failed": failed,
            "success_rate": f"{(passed/total)*100:.1f}%" if total > 0 else "N/A",
            "results": [
                {"name": name, "success": success, "message": message}
                for name, success, message in self.results
            ]
        }

    def print_summary(self):
        """Print summary of all checks."""
        summary = self.get_summary()

        print_header("Summary")
        print(f"  Total Checks: {summary['total_checks']}")
        print(f"  {Colors.GREEN}Passed: {summary['passed']}{Colors.RESET}")
        print(f"  {Colors.RED}Failed: {summary['failed']}{Colors.RESET}")
        print(f"  Success Rate: {summary['success_rate']}")

        if summary['failed'] > 0:
            print(f"\n{Colors.YELLOW}Action Items:{Colors.RESET}")
            for name, success, message in self.results:
                if not success:
                    print(f"  - {name}: {message}")

    def run_all_checks(self, skip_api: bool = False) -> bool:
        """Run all infrastructure checks."""
        print(f"\n{Colors.BOLD}SEC Research Infrastructure Verification{Colors.RESET}")
        print(f"Timestamp: {datetime.now().isoformat()}")

        # Run checks
        env_ok = self.check_environment_variables()

        if env_ok:
            d1_ok = self.check_d1_connection()
            if d1_ok:
                self.check_d1_schema()
                self.check_sec_companies_data()

            self.check_r2_bucket()
            self.check_vectorize_index()

        self.check_edgar_connectivity()

        if not skip_api:
            self.check_api_endpoints()

        self.print_summary()

        return self.get_summary()["failed"] == 0


def main():
    parser = argparse.ArgumentParser(description="Verify SEC Research infrastructure")
    parser.add_argument("--verbose", "-v", action="store_true", help="Verbose output")
    parser.add_argument("--skip-api", action="store_true", help="Skip API endpoint checks")
    parser.add_argument("--json", action="store_true", help="Output results as JSON")
    args = parser.parse_args()

    verifier = InfrastructureVerifier(verbose=args.verbose)
    success = verifier.run_all_checks(skip_api=args.skip_api)

    if args.json:
        print(json.dumps(verifier.get_summary(), indent=2))

    sys.exit(0 if success else 1)


if __name__ == "__main__":
    main()

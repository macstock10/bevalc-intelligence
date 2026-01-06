"""
email_sender.py - Python wrapper for the Resend email system

This module provides Python functions to send emails using the React Email + Resend
system in the /emails folder. It calls the Node.js send script via subprocess.

Usage:
    from src.email_sender import send_weekly_report, send_welcome

    # Send weekly report
    result = send_weekly_report(
        to="user@example.com",
        week_ending="January 5, 2026",
        download_link="https://...",
        new_filings_count="847",
        new_brands_count="23"
    )

    # Send welcome email
    result = send_welcome(to="user@example.com", first_name="John")
"""

import subprocess
import os
import json
from pathlib import Path
from typing import Optional, Dict, Any

# Path to the emails folder
EMAILS_DIR = Path(__file__).parent.parent.parent / "emails"
SEND_SCRIPT = EMAILS_DIR / "send.js"


def _run_send_script(template: str, args: Dict[str, Any], test: bool = False) -> Dict[str, Any]:
    """
    Run the Node.js send script with the given arguments.

    Returns:
        dict with 'success' (bool) and 'message' or 'error'
    """
    # Build command
    cmd = ["node", str(SEND_SCRIPT), template]

    for key, value in args.items():
        if value is not None:
            # Convert snake_case to camelCase for CLI args
            cli_key = key.replace("_", "")
            # Special cases for camelCase
            if key == "week_ending":
                cli_key = "weekEnding"
            elif key == "download_link":
                cli_key = "downloadLink"
            elif key == "new_filings_count":
                cli_key = "newFilingsCount"
            elif key == "new_brands_count":
                cli_key = "newBrandsCount"
            elif key == "first_name":
                cli_key = "firstName"

            cmd.extend([f"--{cli_key}", str(value)])

    if test:
        cmd.append("--test")

    try:
        result = subprocess.run(
            cmd,
            cwd=str(EMAILS_DIR),
            capture_output=True,
            text=True,
            env={**os.environ}  # Pass through environment variables
        )

        if result.returncode == 0:
            return {
                "success": True,
                "message": result.stdout.strip()
            }
        else:
            return {
                "success": False,
                "error": result.stderr.strip() or result.stdout.strip()
            }

    except FileNotFoundError:
        return {
            "success": False,
            "error": "Node.js not found. Please install Node.js to use the email system."
        }
    except Exception as e:
        return {
            "success": False,
            "error": str(e)
        }


def send_weekly_report(
    to: str,
    week_ending: str,
    download_link: str,
    new_filings_count: Optional[str] = None,
    new_brands_count: Optional[str] = None,
    test: bool = False
) -> Dict[str, Any]:
    """
    Send the weekly report email.

    Args:
        to: Recipient email address
        week_ending: Date string (e.g., "January 5, 2026")
        download_link: URL to the PDF report
        new_filings_count: Optional count of new filings to display
        new_brands_count: Optional count of new brands to display
        test: If True, sends with [TEST] prefix in subject

    Returns:
        dict with 'success' (bool) and 'message' or 'error'
    """
    return _run_send_script(
        "weekly-report",
        {
            "to": to,
            "week_ending": week_ending,
            "download_link": download_link,
            "new_filings_count": new_filings_count,
            "new_brands_count": new_brands_count,
        },
        test=test
    )


def send_welcome(
    to: str,
    first_name: Optional[str] = None,
    test: bool = False
) -> Dict[str, Any]:
    """
    Send the welcome email.

    Args:
        to: Recipient email address
        first_name: Optional first name for personalization
        test: If True, sends with [TEST] prefix in subject

    Returns:
        dict with 'success' (bool) and 'message' or 'error'
    """
    return _run_send_script(
        "welcome",
        {
            "to": to,
            "first_name": first_name,
        },
        test=test
    )


def check_email_setup() -> Dict[str, Any]:
    """
    Verify the email system is set up correctly.

    Returns:
        dict with 'ready' (bool) and any issues found
    """
    issues = []

    # Check Node.js
    try:
        result = subprocess.run(["node", "--version"], capture_output=True, text=True)
        if result.returncode != 0:
            issues.append("Node.js not working properly")
    except FileNotFoundError:
        issues.append("Node.js not installed")

    # Check send script exists
    if not SEND_SCRIPT.exists():
        issues.append(f"Send script not found at {SEND_SCRIPT}")

    # Check for RESEND_API_KEY
    if not os.environ.get("RESEND_API_KEY"):
        issues.append("RESEND_API_KEY environment variable not set")

    # Check if node_modules exists (packages installed)
    node_modules = EMAILS_DIR / "node_modules"
    if not node_modules.exists():
        issues.append(f"Dependencies not installed. Run: cd emails && npm install")

    return {
        "ready": len(issues) == 0,
        "issues": issues
    }


if __name__ == "__main__":
    # Quick test
    print("Checking email setup...")
    status = check_email_setup()

    if status["ready"]:
        print("Email system is ready!")
    else:
        print("Issues found:")
        for issue in status["issues"]:
            print(f"  - {issue}")

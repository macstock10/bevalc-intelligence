"""
r2_utils.py - Cloudflare R2 Storage Utilities

Provides S3-compatible operations for storing SEC filing documents in R2.

Functions:
- upload_to_r2: Upload content to R2 bucket
- download_from_r2: Download content from R2 bucket
- file_exists_in_r2: Check if file exists
- list_r2_files: List files with prefix
"""

import os
import hashlib
import logging
from typing import Optional, List, Dict
from datetime import datetime, timezone

import requests

# R2 Configuration
R2_ACCOUNT_ID = os.environ.get("CLOUDFLARE_ACCOUNT_ID")
R2_ACCESS_KEY_ID = os.environ.get("R2_ACCESS_KEY_ID")
R2_SECRET_ACCESS_KEY = os.environ.get("R2_SECRET_ACCESS_KEY")
R2_BUCKET_NAME = "bevalc-sec-filings"

# R2 S3-compatible endpoint
R2_ENDPOINT = f"https://{R2_ACCOUNT_ID}.r2.cloudflarestorage.com"

_logger = None


def init_r2_client(logger: logging.Logger = None):
    """Initialize R2 client with optional logger."""
    global _logger
    _logger = logger or logging.getLogger(__name__)


def _get_logger():
    """Get configured logger or default."""
    return _logger or logging.getLogger(__name__)


def _get_s3_client():
    """Get boto3 S3 client configured for R2."""
    try:
        import boto3
        from botocore.config import Config
    except ImportError:
        _get_logger().error("boto3 not installed. Run: pip install boto3")
        return None

    if not R2_ACCESS_KEY_ID or not R2_SECRET_ACCESS_KEY:
        _get_logger().warning("R2 credentials not configured. Using Cloudflare API fallback.")
        return None

    return boto3.client(
        "s3",
        endpoint_url=R2_ENDPOINT,
        aws_access_key_id=R2_ACCESS_KEY_ID,
        aws_secret_access_key=R2_SECRET_ACCESS_KEY,
        config=Config(
            signature_version="s3v4",
            retries={"max_attempts": 3, "mode": "adaptive"}
        ),
        region_name="auto"
    )


def upload_to_r2(
    content: str,
    key: str,
    content_type: str = "text/html",
    metadata: Dict = None
) -> bool:
    """
    Upload content to R2 bucket.

    Args:
        content: String content to upload
        key: Object key (path) in bucket
        content_type: MIME type
        metadata: Optional metadata dict

    Returns:
        True if successful
    """
    logger = _get_logger()

    # Try S3 client first
    s3 = _get_s3_client()
    if s3:
        try:
            extra_args = {"ContentType": content_type}
            if metadata:
                extra_args["Metadata"] = {k: str(v) for k, v in metadata.items()}

            s3.put_object(
                Bucket=R2_BUCKET_NAME,
                Key=key,
                Body=content.encode("utf-8"),
                **extra_args
            )
            logger.debug(f"Uploaded to R2: {key}")
            return True
        except Exception as e:
            logger.error(f"R2 upload failed: {e}")
            return False

    # Fallback: Use Cloudflare API (limited, for small files)
    return _upload_via_cf_api(content, key, content_type, metadata)


def _upload_via_cf_api(
    content: str,
    key: str,
    content_type: str,
    metadata: Dict = None
) -> bool:
    """Fallback upload using Cloudflare REST API."""
    logger = _get_logger()
    api_token = os.environ.get("CLOUDFLARE_API_TOKEN")
    account_id = os.environ.get("CLOUDFLARE_ACCOUNT_ID")

    if not api_token or not account_id:
        logger.error("Cloudflare credentials not configured for R2 fallback")
        return False

    # Note: Cloudflare REST API for R2 has limitations
    # For production, use S3-compatible API with boto3
    url = f"https://api.cloudflare.com/client/v4/accounts/{account_id}/r2/buckets/{R2_BUCKET_NAME}/objects/{key}"

    try:
        response = requests.put(
            url,
            headers={
                "Authorization": f"Bearer {api_token}",
                "Content-Type": content_type
            },
            data=content.encode("utf-8"),
            timeout=60
        )
        if response.status_code in [200, 201]:
            logger.debug(f"Uploaded to R2 via API: {key}")
            return True
        else:
            logger.error(f"R2 API upload failed: {response.status_code} - {response.text}")
            return False
    except Exception as e:
        logger.error(f"R2 API upload error: {e}")
        return False


def download_from_r2(key: str) -> Optional[str]:
    """
    Download content from R2 bucket.

    Args:
        key: Object key (path) in bucket

    Returns:
        Content as string, or None if not found
    """
    logger = _get_logger()

    s3 = _get_s3_client()
    if s3:
        try:
            response = s3.get_object(Bucket=R2_BUCKET_NAME, Key=key)
            content = response["Body"].read().decode("utf-8")
            return content
        except s3.exceptions.NoSuchKey:
            logger.debug(f"Object not found in R2: {key}")
            return None
        except Exception as e:
            logger.error(f"R2 download failed: {e}")
            return None

    # Fallback: Try public URL if bucket has public access
    public_url = f"https://pub-{R2_ACCOUNT_ID}.r2.dev/{key}"
    try:
        response = requests.get(public_url, timeout=30)
        if response.status_code == 200:
            return response.text
    except Exception:
        pass

    return None


def file_exists_in_r2(key: str) -> bool:
    """
    Check if file exists in R2 bucket.

    Args:
        key: Object key (path) in bucket

    Returns:
        True if file exists
    """
    logger = _get_logger()

    s3 = _get_s3_client()
    if s3:
        try:
            s3.head_object(Bucket=R2_BUCKET_NAME, Key=key)
            return True
        except Exception:
            return False

    return False


def list_r2_files(prefix: str, max_keys: int = 1000) -> List[Dict]:
    """
    List files in R2 bucket with prefix.

    Args:
        prefix: Key prefix to filter
        max_keys: Maximum number of keys to return

    Returns:
        List of dicts with 'key', 'size', 'last_modified'
    """
    logger = _get_logger()

    s3 = _get_s3_client()
    if not s3:
        return []

    try:
        response = s3.list_objects_v2(
            Bucket=R2_BUCKET_NAME,
            Prefix=prefix,
            MaxKeys=max_keys
        )

        files = []
        for obj in response.get("Contents", []):
            files.append({
                "key": obj["Key"],
                "size": obj["Size"],
                "last_modified": obj["LastModified"].isoformat()
            })
        return files

    except Exception as e:
        logger.error(f"R2 list failed: {e}")
        return []


def get_r2_public_url(key: str) -> str:
    """
    Get public URL for R2 object (if bucket is public).

    Args:
        key: Object key

    Returns:
        Public URL string
    """
    # This assumes a public R2 bucket with custom domain or r2.dev URL
    # Adjust based on your actual setup
    return f"https://pub-{R2_ACCOUNT_ID}.r2.dev/{key}"


def compute_content_hash(content: str) -> str:
    """Compute MD5 hash for content deduplication."""
    return hashlib.md5(content.encode("utf-8")).hexdigest()

#!/usr/bin/env python3
"""
Generate static sitemap XML files and upload to R2.

Usage:
    python generate_sitemaps.py              # Generate and upload all sitemaps
    python generate_sitemaps.py --dry-run    # Generate locally without upload
    python generate_sitemaps.py --local      # Save to local files only
"""

import os
import sys
import json
import argparse
import requests
from datetime import datetime
from pathlib import Path

# Load environment variables
from dotenv import load_dotenv
load_dotenv(Path(__file__).parent.parent / '.env')

# Cloudflare config
CLOUDFLARE_ACCOUNT_ID = os.getenv('CLOUDFLARE_ACCOUNT_ID')
CLOUDFLARE_D1_DATABASE_ID = os.getenv('CLOUDFLARE_D1_DATABASE_ID')
CLOUDFLARE_API_TOKEN = os.getenv('CLOUDFLARE_API_TOKEN')
R2_ACCESS_KEY_ID = os.getenv('CLOUDFLARE_R2_ACCESS_KEY_ID')
R2_SECRET_ACCESS_KEY = os.getenv('CLOUDFLARE_R2_SECRET_ACCESS_KEY')
R2_BUCKET_NAME = os.getenv('CLOUDFLARE_R2_BUCKET_NAME', 'bevalc-reports')

BASE_URL = 'https://bevalcintel.com'
BRANDS_PER_SITEMAP = 45000  # Stay under Google's 50k limit

def query_d1(sql, params=None):
    """Execute a query against D1."""
    url = f"https://api.cloudflare.com/client/v4/accounts/{CLOUDFLARE_ACCOUNT_ID}/d1/database/{CLOUDFLARE_D1_DATABASE_ID}/query"
    headers = {
        "Authorization": f"Bearer {CLOUDFLARE_API_TOKEN}",
        "Content-Type": "application/json"
    }
    payload = {"sql": sql}
    if params:
        payload["params"] = params

    response = requests.post(url, headers=headers, json=payload)
    data = response.json()

    if not data.get('success'):
        raise Exception(f"D1 query failed: {data.get('errors', 'Unknown error')}")

    return data['result'][0]['results'] if data.get('result') else []

def generate_urlset_xml(urls):
    """Generate a urlset XML sitemap."""
    today = datetime.now().strftime('%Y-%m-%d')
    url_entries = '\n'.join([
        f'''  <url>
    <loc>{u['loc']}</loc>
    <lastmod>{today}</lastmod>
    <priority>{u['priority']}</priority>
  </url>''' for u in urls
    ])
    return f'''<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
{url_entries}
</urlset>'''

def generate_sitemap_index(sitemap_urls):
    """Generate a sitemap index XML."""
    today = datetime.now().strftime('%Y-%m-%d')
    sitemap_entries = '\n'.join([
        f'''  <sitemap>
    <loc>{url}</loc>
    <lastmod>{today}</lastmod>
  </sitemap>''' for url in sitemap_urls
    ])
    return f'''<?xml version="1.0" encoding="UTF-8"?>
<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
{sitemap_entries}
</sitemapindex>'''

def generate_static_sitemap():
    """Generate sitemap for static pages and categories."""
    print("  Generating sitemap-static.xml...")
    urls = [
        {'loc': BASE_URL, 'priority': '1.0'},
        {'loc': f'{BASE_URL}/database.html', 'priority': '0.9'},
    ]

    categories = ['whiskey', 'vodka', 'tequila', 'rum', 'gin', 'brandy', 'wine', 'beer', 'liqueur', 'cocktails']
    years = [2026, 2025, 2024, 2023, 2022, 2021]

    for cat in categories:
        for year in years:
            urls.append({'loc': f'{BASE_URL}/category/{cat}/{year}', 'priority': '0.8'})

    print(f"    {len(urls)} URLs")
    return generate_urlset_xml(urls)

def generate_companies_sitemap():
    """Generate sitemap for company pages."""
    print("  Generating sitemap-companies.xml...")

    results = query_d1("SELECT slug FROM companies WHERE total_filings >= 3 ORDER BY total_filings DESC")
    urls = [{'loc': f'{BASE_URL}/company/{r["slug"]}', 'priority': '0.7'} for r in results]

    print(f"    {len(urls)} companies")
    return generate_urlset_xml(urls)

def generate_brand_sitemaps():
    """Generate paginated sitemaps for brand pages."""
    print("  Generating brand sitemaps...")

    # Get total brand count
    count_result = query_d1("SELECT COUNT(*) as cnt FROM brand_slugs")
    total_brands = count_result[0]['cnt'] if count_result else 0
    num_sitemaps = (total_brands + BRANDS_PER_SITEMAP - 1) // BRANDS_PER_SITEMAP

    print(f"    {total_brands} brands -> {num_sitemaps} sitemap files")

    sitemaps = {}
    for i in range(1, num_sitemaps + 1):
        offset = (i - 1) * BRANDS_PER_SITEMAP
        print(f"    Fetching brands {offset + 1} to {min(offset + BRANDS_PER_SITEMAP, total_brands)}...")

        results = query_d1(
            f"SELECT slug FROM brand_slugs ORDER BY filing_count DESC LIMIT {BRANDS_PER_SITEMAP} OFFSET {offset}"
        )
        urls = [{'loc': f'{BASE_URL}/brand/{r["slug"]}', 'priority': '0.6'} for r in results]
        sitemaps[f'sitemap-brands-{i}.xml'] = generate_urlset_xml(urls)
        print(f"      sitemap-brands-{i}.xml: {len(urls)} URLs")

    return sitemaps

def upload_to_r2(filename, content):
    """Upload a file to R2."""
    import boto3
    from botocore.config import Config

    s3 = boto3.client(
        's3',
        endpoint_url=f'https://{CLOUDFLARE_ACCOUNT_ID}.r2.cloudflarestorage.com',
        aws_access_key_id=R2_ACCESS_KEY_ID,
        aws_secret_access_key=R2_SECRET_ACCESS_KEY,
        config=Config(signature_version='s3v4'),
        region_name='auto'
    )

    s3.put_object(
        Bucket=R2_BUCKET_NAME,
        Key=f'sitemaps/{filename}',
        Body=content.encode('utf-8'),
        ContentType='application/xml',
        CacheControl='public, max-age=86400'  # 24h cache
    )
    print(f"    Uploaded {filename} to R2")

def main():
    parser = argparse.ArgumentParser(description='Generate and upload sitemaps')
    parser.add_argument('--dry-run', action='store_true', help='Generate but do not upload')
    parser.add_argument('--local', action='store_true', help='Save to local files')
    args = parser.parse_args()

    print("Generating sitemaps...")

    sitemaps = {}

    # Generate individual sitemaps
    sitemaps['sitemap-static.xml'] = generate_static_sitemap()
    sitemaps['sitemap-companies.xml'] = generate_companies_sitemap()
    sitemaps.update(generate_brand_sitemaps())

    # Generate sitemap index
    print("  Generating sitemap.xml (index)...")
    sitemap_urls = [f'{BASE_URL}/sitemap-static.xml', f'{BASE_URL}/sitemap-companies.xml']
    brand_sitemaps = sorted([k for k in sitemaps.keys() if k.startswith('sitemap-brands-')])
    sitemap_urls.extend([f'{BASE_URL}/{s}' for s in brand_sitemaps])
    sitemaps['sitemap.xml'] = generate_sitemap_index(sitemap_urls)

    print(f"\nGenerated {len(sitemaps)} sitemap files")

    # Save locally if requested
    if args.local or args.dry_run:
        output_dir = Path(__file__).parent.parent / 'data' / 'sitemaps'
        output_dir.mkdir(parents=True, exist_ok=True)
        for filename, content in sitemaps.items():
            filepath = output_dir / filename
            filepath.write_text(content, encoding='utf-8')
            print(f"  Saved {filepath}")

    # Upload to R2
    if not args.dry_run and not args.local:
        print("\nUploading to R2...")
        for filename, content in sitemaps.items():
            upload_to_r2(filename, content)
        print("\nDone! Sitemaps uploaded to R2.")
        print(f"Access via: https://{os.getenv('CLOUDFLARE_R2_PUBLIC_URL', 'your-r2-url')}/sitemaps/sitemap.xml")
    elif args.dry_run:
        print("\nDry run - no upload performed")

if __name__ == '__main__':
    main()

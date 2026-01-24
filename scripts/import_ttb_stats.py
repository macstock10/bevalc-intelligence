#!/usr/bin/env python3
"""Import TTB stats CSVs to D1 via wrangler"""
import csv
import subprocess
import os
import tempfile

def escape_sql(value):
    if value is None or value == '':
        return "NULL"
    if isinstance(value, (int, float)):
        return str(value)
    s = str(value).replace("'", "''")
    return f"'{s}'"

def run_sql(sql, worker_dir):
    """Run SQL via wrangler using a temp file"""
    with tempfile.NamedTemporaryFile(mode='w', suffix='.sql', delete=False, encoding='utf-8') as f:
        f.write(sql)
        sql_file = f.name

    try:
        cmd = f'npx wrangler d1 execute bevalc-colas --remote --file="{sql_file}"'
        result = subprocess.run(cmd, capture_output=True, text=True, cwd=worker_dir, shell=True)
        return 'success' in result.stdout.lower() or result.returncode == 0
    finally:
        os.unlink(sql_file)

def import_yearly():
    csv_path = os.path.join(os.path.dirname(__file__), '..', 'data', 'ttb_yearly.csv')
    worker_dir = os.path.join(os.path.dirname(__file__), '..', 'worker')

    with open(csv_path, 'r', encoding='utf-8') as f:
        reader = csv.DictReader(f)
        rows = list(reader)

    print(f"Processing {len(rows)} yearly records...")

    batch_size = 100
    total = 0

    for i in range(0, len(rows), batch_size):
        batch = rows[i:i+batch_size]
        values = []

        for row in batch:
            year = int(row['Year'])
            statistical_group = escape_sql(row['Statistical_Group'])
            statistical_category = escape_sql(row['Statistical_Category'])
            statistical_detail = escape_sql(row['Statistical_Detail'])
            count_ims = int(row['Count_IMs']) if row['Count_IMs'].isdigit() else 'NULL'
            value = int(row['Value']) if row['Value'].isdigit() else 'NULL'
            is_redacted = 1 if row.get('Stat_Redaction', '').upper() == 'TRUE' else 0

            values.append(f"({year}, NULL, {statistical_group}, {statistical_category}, {statistical_detail}, {count_ims}, {value}, {is_redacted})")

        sql = f"INSERT OR REPLACE INTO ttb_spirits_stats (year, month, statistical_group, statistical_category, statistical_detail, count_ims, value, is_redacted) VALUES {','.join(values)};"

        if run_sql(sql, worker_dir):
            total += len(batch)
            print(f"  Inserted {total}/{len(rows)} yearly records")
        else:
            print(f"  Error at batch starting {i}")

    print(f"Yearly import complete: {total} records")
    return total

def import_monthly():
    csv_path = os.path.join(os.path.dirname(__file__), '..', 'data', 'ttb_monthly.csv')
    worker_dir = os.path.join(os.path.dirname(__file__), '..', 'worker')

    with open(csv_path, 'r', encoding='utf-8') as f:
        reader = csv.DictReader(f)
        rows = list(reader)

    print(f"Processing {len(rows)} monthly records...")

    batch_size = 100
    total = 0

    for i in range(0, len(rows), batch_size):
        batch = rows[i:i+batch_size]
        values = []

        for row in batch:
            year = int(row['Year'])
            month = int(row['CY_Month_Number']) if row.get('CY_Month_Number', '').isdigit() else 'NULL'
            statistical_group = escape_sql(row['Statistical_Group'])
            statistical_category = escape_sql(row['Statistical_Category'])
            statistical_detail = escape_sql(row['Statistical_Detail'])
            count_ims = int(row['Count_IMs']) if row['Count_IMs'].isdigit() else 'NULL'
            value = int(row['Value']) if row['Value'].isdigit() else 'NULL'
            is_redacted = 1 if row.get('Stat_Redaction', '').upper() == 'TRUE' else 0

            values.append(f"({year}, {month}, {statistical_group}, {statistical_category}, {statistical_detail}, {count_ims}, {value}, {is_redacted})")

        sql = f"INSERT OR REPLACE INTO ttb_spirits_stats (year, month, statistical_group, statistical_category, statistical_detail, count_ims, value, is_redacted) VALUES {','.join(values)};"

        if run_sql(sql, worker_dir):
            total += len(batch)
            if total % 500 == 0 or total == len(rows):
                print(f"  Inserted {total}/{len(rows)} monthly records")
        else:
            print(f"  Error at batch starting {i}")

    print(f"Monthly import complete: {total} records")
    return total

if __name__ == '__main__':
    yearly = import_yearly()
    monthly = import_monthly()
    print(f"\nTotal: {yearly + monthly} records imported")

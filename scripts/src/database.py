"""
database.py - SQLite database management for BevAlc Intelligence

Handles schema creation, connections, and common queries.
"""

import sqlite3
import json
import os
from datetime import datetime
from typing import Optional, List, Dict, Any, Tuple
from contextlib import contextmanager

# Default database path
DEFAULT_DB_PATH = os.path.join(os.path.dirname(os.path.dirname(__file__)), "data", "bevalc.db")


SCHEMA = """
-- Main COLA records table
CREATE TABLE IF NOT EXISTS colas (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    ttb_id TEXT UNIQUE NOT NULL,
    status TEXT,
    vendor_code TEXT,
    serial_number TEXT,
    class_type_code TEXT,
    origin_code TEXT,
    brand_name TEXT,
    fanciful_name TEXT,
    type_of_application TEXT,
    for_sale_in TEXT,
    total_bottle_capacity TEXT,
    formula TEXT,
    approval_date TEXT,
    qualifications TEXT,
    plant_registry TEXT,
    company_name TEXT,
    street TEXT,
    state TEXT,
    contact_person TEXT,
    phone_number TEXT,
    
    -- Type-specific fields stored as JSON
    extra_fields TEXT,
    
    -- Image tracking
    image_count INTEGER DEFAULT 0,
    images_downloaded INTEGER DEFAULT 0,
    image_paths TEXT,  -- JSON array of local paths
    
    -- Metadata
    first_scraped_at TEXT,
    last_updated_at TEXT,
    scrape_source_url TEXT
);

-- History table for tracking changes over time
CREATE TABLE IF NOT EXISTS cola_history (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    ttb_id TEXT NOT NULL,
    field_name TEXT NOT NULL,
    old_value TEXT,
    new_value TEXT,
    changed_at TEXT DEFAULT CURRENT_TIMESTAMP
);

-- Scrape job tracking for resumability
CREATE TABLE IF NOT EXISTS scrape_jobs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    job_type TEXT NOT NULL,
    date_from TEXT,
    date_to TEXT,
    class_type_from TEXT,
    class_type_to TEXT,
    status TEXT DEFAULT 'pending',
    total_items INTEGER DEFAULT 0,
    processed_items INTEGER DEFAULT 0,
    started_at TEXT,
    completed_at TEXT,
    last_checkpoint TEXT,
    error_message TEXT
);

-- Work queue for resumable scraping
CREATE TABLE IF NOT EXISTS scrape_queue (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    job_id INTEGER,
    item_type TEXT NOT NULL,
    ttb_id TEXT,
    url TEXT,
    priority INTEGER DEFAULT 0,
    attempts INTEGER DEFAULT 0,
    max_attempts INTEGER DEFAULT 3,
    last_attempt_at TEXT,
    status TEXT DEFAULT 'pending',
    error_message TEXT,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

-- Indexes for fast filtering on the website
CREATE INDEX IF NOT EXISTS idx_colas_ttb_id ON colas(ttb_id);
CREATE INDEX IF NOT EXISTS idx_colas_class_type ON colas(class_type_code);
CREATE INDEX IF NOT EXISTS idx_colas_state ON colas(state);
CREATE INDEX IF NOT EXISTS idx_colas_approval_date ON colas(approval_date);
CREATE INDEX IF NOT EXISTS idx_colas_origin ON colas(origin_code);
CREATE INDEX IF NOT EXISTS idx_colas_status ON colas(status);
CREATE INDEX IF NOT EXISTS idx_colas_brand ON colas(brand_name);
CREATE INDEX IF NOT EXISTS idx_colas_company ON colas(company_name);

CREATE INDEX IF NOT EXISTS idx_queue_status ON scrape_queue(status);
CREATE INDEX IF NOT EXISTS idx_queue_type_status ON scrape_queue(item_type, status);
CREATE INDEX IF NOT EXISTS idx_queue_job ON scrape_queue(job_id);

CREATE INDEX IF NOT EXISTS idx_history_ttb_id ON cola_history(ttb_id);
"""


class Database:
    """SQLite database wrapper for BevAlc Intelligence."""
    
    def __init__(self, db_path: str = None):
        self.db_path = db_path or DEFAULT_DB_PATH
        os.makedirs(os.path.dirname(self.db_path), exist_ok=True)
        self._init_schema()
    
    def _init_schema(self):
        """Initialize database schema."""
        with self.connect() as conn:
            conn.executescript(SCHEMA)
            conn.commit()
    
    @contextmanager
    def connect(self):
        """Context manager for database connections."""
        conn = sqlite3.connect(self.db_path)
        conn.row_factory = sqlite3.Row
        try:
            yield conn
        finally:
            conn.close()
    
    # ─────────────────────────────────────────────────────────────────
    # COLA Records
    # ─────────────────────────────────────────────────────────────────
    
    def get_cola(self, ttb_id: str) -> Optional[Dict]:
        """Get a COLA record by TTB ID."""
        with self.connect() as conn:
            row = conn.execute(
                "SELECT * FROM colas WHERE ttb_id = ?", (ttb_id,)
            ).fetchone()
            return dict(row) if row else None
    
    def cola_exists(self, ttb_id: str) -> bool:
        """Check if a COLA exists in the database."""
        with self.connect() as conn:
            result = conn.execute(
                "SELECT 1 FROM colas WHERE ttb_id = ? LIMIT 1", (ttb_id,)
            ).fetchone()
            return result is not None
    
    def upsert_cola(self, data: Dict[str, Any], source_url: str = None) -> Tuple[bool, List[str]]:
        """
        Insert or update a COLA record.
        Returns (is_new, changed_fields).
        
        If the record exists, compares fields and logs changes to history.
        """
        ttb_id = data.get('ttb_id')
        if not ttb_id:
            raise ValueError("ttb_id is required")
        
        now = datetime.now().isoformat()
        existing = self.get_cola(ttb_id)
        changed_fields = []
        
        # Fields to track for changes
        tracked_fields = [
            'status', 'vendor_code', 'serial_number', 'class_type_code',
            'origin_code', 'brand_name', 'fanciful_name', 'type_of_application',
            'for_sale_in', 'total_bottle_capacity', 'formula', 'approval_date',
            'qualifications', 'plant_registry', 'company_name', 'street',
            'state', 'contact_person', 'phone_number'
        ]
        
        with self.connect() as conn:
            if existing:
                # Update existing record, track changes
                for field in tracked_fields:
                    old_val = existing.get(field)
                    new_val = data.get(field)
                    if old_val != new_val and new_val is not None:
                        changed_fields.append(field)
                        # Log to history
                        conn.execute("""
                            INSERT INTO cola_history (ttb_id, field_name, old_value, new_value, changed_at)
                            VALUES (?, ?, ?, ?, ?)
                        """, (ttb_id, field, old_val, new_val, now))
                
                if changed_fields or source_url:
                    # Build update query for changed fields
                    updates = ["last_updated_at = ?"]
                    values = [now]
                    
                    for field in changed_fields:
                        updates.append(f"{field} = ?")
                        values.append(data.get(field))
                    
                    if source_url:
                        updates.append("scrape_source_url = ?")
                        values.append(source_url)
                    
                    # Handle extra_fields JSON
                    if 'extra_fields' in data:
                        updates.append("extra_fields = ?")
                        values.append(json.dumps(data['extra_fields']) if isinstance(data['extra_fields'], dict) else data['extra_fields'])
                    
                    values.append(ttb_id)
                    conn.execute(f"""
                        UPDATE colas SET {', '.join(updates)} WHERE ttb_id = ?
                    """, values)
                
                conn.commit()
                return False, changed_fields
            else:
                # Insert new record
                extra_fields_json = None
                if 'extra_fields' in data and data['extra_fields']:
                    extra_fields_json = json.dumps(data['extra_fields']) if isinstance(data['extra_fields'], dict) else data['extra_fields']
                
                conn.execute("""
                    INSERT INTO colas (
                        ttb_id, status, vendor_code, serial_number, class_type_code,
                        origin_code, brand_name, fanciful_name, type_of_application,
                        for_sale_in, total_bottle_capacity, formula, approval_date,
                        qualifications, plant_registry, company_name, street, state,
                        contact_person, phone_number, extra_fields, image_count,
                        first_scraped_at, last_updated_at, scrape_source_url
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """, (
                    ttb_id,
                    data.get('status'),
                    data.get('vendor_code'),
                    data.get('serial_number'),
                    data.get('class_type_code'),
                    data.get('origin_code'),
                    data.get('brand_name'),
                    data.get('fanciful_name'),
                    data.get('type_of_application'),
                    data.get('for_sale_in'),
                    data.get('total_bottle_capacity'),
                    data.get('formula'),
                    data.get('approval_date'),
                    data.get('qualifications'),
                    data.get('plant_registry'),
                    data.get('company_name'),
                    data.get('street'),
                    data.get('state'),
                    data.get('contact_person'),
                    data.get('phone_number'),
                    extra_fields_json,
                    data.get('image_count', 0),
                    now,
                    now,
                    source_url
                ))
                conn.commit()
                return True, []
    
    def update_cola_images(self, ttb_id: str, image_count: int, images_downloaded: int, image_paths: List[str]):
        """Update image tracking for a COLA."""
        with self.connect() as conn:
            conn.execute("""
                UPDATE colas 
                SET image_count = ?, images_downloaded = ?, image_paths = ?, last_updated_at = ?
                WHERE ttb_id = ?
            """, (image_count, images_downloaded, json.dumps(image_paths), datetime.now().isoformat(), ttb_id))
            conn.commit()
    
    def get_colas_needing_images(self, limit: int = 100) -> List[Dict]:
        """Get COLAs that need image downloading."""
        with self.connect() as conn:
            rows = conn.execute("""
                SELECT ttb_id, scrape_source_url 
                FROM colas 
                WHERE images_downloaded = 0 OR images_downloaded IS NULL
                ORDER BY first_scraped_at DESC
                LIMIT ?
            """, (limit,)).fetchall()
            return [dict(row) for row in rows]
    
    def get_cola_count(self) -> int:
        """Get total number of COLAs in database."""
        with self.connect() as conn:
            result = conn.execute("SELECT COUNT(*) FROM colas").fetchone()
            return result[0]
    
    def search_colas(self, 
                     class_type: str = None,
                     state: str = None,
                     status: str = None,
                     brand_name: str = None,
                     date_from: str = None,
                     date_to: str = None,
                     limit: int = 100,
                     offset: int = 0) -> List[Dict]:
        """Search COLAs with filters."""
        conditions = []
        params = []
        
        if class_type:
            conditions.append("class_type_code LIKE ?")
            params.append(f"%{class_type}%")
        if state:
            conditions.append("state = ?")
            params.append(state)
        if status:
            conditions.append("status = ?")
            params.append(status)
        if brand_name:
            conditions.append("brand_name LIKE ?")
            params.append(f"%{brand_name}%")
        if date_from:
            conditions.append("approval_date >= ?")
            params.append(date_from)
        if date_to:
            conditions.append("approval_date <= ?")
            params.append(date_to)
        
        where_clause = " AND ".join(conditions) if conditions else "1=1"
        
        with self.connect() as conn:
            rows = conn.execute(f"""
                SELECT * FROM colas 
                WHERE {where_clause}
                ORDER BY approval_date DESC
                LIMIT ? OFFSET ?
            """, params + [limit, offset]).fetchall()
            return [dict(row) for row in rows]
    
    def get_distinct_values(self, column: str) -> List[str]:
        """Get distinct values for a column (for filter dropdowns)."""
        allowed_columns = ['state', 'status', 'class_type_code', 'origin_code', 'type_of_application']
        if column not in allowed_columns:
            raise ValueError(f"Column {column} not allowed for distinct query")
        
        with self.connect() as conn:
            rows = conn.execute(f"""
                SELECT DISTINCT {column} FROM colas 
                WHERE {column} IS NOT NULL AND {column} != ''
                ORDER BY {column}
            """).fetchall()
            return [row[0] for row in rows]
    
    # ─────────────────────────────────────────────────────────────────
    # Scrape Jobs
    # ─────────────────────────────────────────────────────────────────
    
    def create_job(self, job_type: str, date_from: str = None, date_to: str = None,
                   class_type_from: str = None, class_type_to: str = None) -> int:
        """Create a new scrape job."""
        with self.connect() as conn:
            cursor = conn.execute("""
                INSERT INTO scrape_jobs (job_type, date_from, date_to, class_type_from, class_type_to, 
                                        status, started_at)
                VALUES (?, ?, ?, ?, ?, 'running', ?)
            """, (job_type, date_from, date_to, class_type_from, class_type_to, datetime.now().isoformat()))
            conn.commit()
            return cursor.lastrowid
    
    def update_job_progress(self, job_id: int, processed: int, total: int = None, checkpoint: str = None):
        """Update job progress."""
        with self.connect() as conn:
            updates = ["processed_items = ?"]
            params = [processed]
            
            if total is not None:
                updates.append("total_items = ?")
                params.append(total)
            if checkpoint:
                updates.append("last_checkpoint = ?")
                params.append(checkpoint)
            
            params.append(job_id)
            conn.execute(f"UPDATE scrape_jobs SET {', '.join(updates)} WHERE id = ?", params)
            conn.commit()
    
    def complete_job(self, job_id: int, status: str = 'completed', error: str = None):
        """Mark a job as completed or failed."""
        with self.connect() as conn:
            conn.execute("""
                UPDATE scrape_jobs 
                SET status = ?, completed_at = ?, error_message = ?
                WHERE id = ?
            """, (status, datetime.now().isoformat(), error, job_id))
            conn.commit()
    
    def get_incomplete_job(self, job_type: str) -> Optional[Dict]:
        """Get the most recent incomplete job of a given type."""
        with self.connect() as conn:
            row = conn.execute("""
                SELECT * FROM scrape_jobs 
                WHERE job_type = ? AND status IN ('pending', 'running')
                ORDER BY id DESC LIMIT 1
            """, (job_type,)).fetchone()
            return dict(row) if row else None
    
    def get_job(self, job_id: int) -> Optional[Dict]:
        """Get a job by ID."""
        with self.connect() as conn:
            row = conn.execute("SELECT * FROM scrape_jobs WHERE id = ?", (job_id,)).fetchone()
            return dict(row) if row else None
    
    # ─────────────────────────────────────────────────────────────────
    # Scrape Queue
    # ─────────────────────────────────────────────────────────────────
    
    def add_to_queue(self, job_id: int, item_type: str, url: str, ttb_id: str = None, priority: int = 0):
        """Add an item to the scrape queue."""
        with self.connect() as conn:
            # Check if already in queue for this job
            existing = conn.execute("""
                SELECT id FROM scrape_queue 
                WHERE job_id = ? AND url = ?
            """, (job_id, url)).fetchone()
            
            if not existing:
                conn.execute("""
                    INSERT INTO scrape_queue (job_id, item_type, url, ttb_id, priority, status)
                    VALUES (?, ?, ?, ?, ?, 'pending')
                """, (job_id, item_type, url, ttb_id, priority))
                conn.commit()
    
    def add_many_to_queue(self, items: List[Tuple[int, str, str, str, int]]):
        """Bulk add items to queue: (job_id, item_type, url, ttb_id, priority)"""
        with self.connect() as conn:
            conn.executemany("""
                INSERT OR IGNORE INTO scrape_queue (job_id, item_type, url, ttb_id, priority, status)
                VALUES (?, ?, ?, ?, ?, 'pending')
            """, items)
            conn.commit()
    
    def get_pending_queue_items(self, job_id: int = None, item_type: str = None, limit: int = 100) -> List[Dict]:
        """Get pending items from the queue."""
        conditions = ["status = 'pending'", "attempts < max_attempts"]
        params = []
        
        if job_id:
            conditions.append("job_id = ?")
            params.append(job_id)
        if item_type:
            conditions.append("item_type = ?")
            params.append(item_type)
        
        with self.connect() as conn:
            rows = conn.execute(f"""
                SELECT * FROM scrape_queue 
                WHERE {' AND '.join(conditions)}
                ORDER BY priority DESC, id ASC
                LIMIT ?
            """, params + [limit]).fetchall()
            return [dict(row) for row in rows]
    
    def get_queue_stats(self, job_id: int = None) -> Dict[str, int]:
        """Get queue statistics."""
        condition = "WHERE job_id = ?" if job_id else ""
        params = [job_id] if job_id else []
        
        with self.connect() as conn:
            stats = {}
            for status in ['pending', 'completed', 'failed']:
                where = f"{condition} {'AND' if condition else 'WHERE'} status = ?"
                result = conn.execute(f"SELECT COUNT(*) FROM scrape_queue {where}", params + [status]).fetchone()
                stats[status] = result[0]
            return stats
    
    def update_queue_item(self, item_id: int, status: str, error: str = None):
        """Update a queue item's status."""
        with self.connect() as conn:
            conn.execute("""
                UPDATE scrape_queue 
                SET status = ?, attempts = attempts + 1, last_attempt_at = ?, error_message = ?
                WHERE id = ?
            """, (status, datetime.now().isoformat(), error, item_id))
            conn.commit()
    
    def retry_failed_items(self, job_id: int = None):
        """Reset failed items to pending for retry."""
        condition = "AND job_id = ?" if job_id else ""
        params = [job_id] if job_id else []
        
        with self.connect() as conn:
            conn.execute(f"""
                UPDATE scrape_queue 
                SET status = 'pending', attempts = 0, error_message = NULL
                WHERE status = 'failed' AND attempts < max_attempts {condition}
            """, params)
            conn.commit()
    
    # ─────────────────────────────────────────────────────────────────
    # Export
    # ─────────────────────────────────────────────────────────────────
    
    def export_to_json(self, output_path: str, filters: Dict = None):
        """Export COLAs to JSON for the static website."""
        with self.connect() as conn:
            rows = conn.execute("SELECT * FROM colas ORDER BY approval_date DESC").fetchall()
            
            data = {
                'generated_at': datetime.now().isoformat(),
                'total_count': len(rows),
                'colas': [dict(row) for row in rows],
                'filters': {
                    'states': self.get_distinct_values('state'),
                    'statuses': self.get_distinct_values('status'),
                    'class_types': self.get_distinct_values('class_type_code'),
                    'origins': self.get_distinct_values('origin_code'),
                }
            }
            
            with open(output_path, 'w', encoding='utf-8') as f:
                json.dump(data, f, indent=2, ensure_ascii=False)
            
            return len(rows)


# Convenience function
def get_database(db_path: str = None) -> Database:
    """Get a database instance."""
    return Database(db_path)

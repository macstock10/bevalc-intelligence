"""
logging_utils.py - Structured Logging Utilities

Provides JSON-structured logging for pipeline monitoring and debugging.
Integrates with common observability platforms.

Features:
- JSON-formatted log output
- Context propagation
- Performance timing
- Error tracking with stack traces
"""

import os
import sys
import json
import time
import logging
import traceback
import functools
from typing import Dict, Any, Optional, Callable
from datetime import datetime
from contextlib import contextmanager
from dataclasses import dataclass, asdict


class JSONFormatter(logging.Formatter):
    """JSON formatter for structured logging."""

    def __init__(self, include_timestamp: bool = True, include_level: bool = True):
        super().__init__()
        self.include_timestamp = include_timestamp
        self.include_level = include_level

    def format(self, record: logging.LogRecord) -> str:
        log_data = {
            "message": record.getMessage(),
            "logger": record.name,
        }

        if self.include_timestamp:
            log_data["timestamp"] = datetime.utcnow().isoformat() + "Z"

        if self.include_level:
            log_data["level"] = record.levelname

        # Add extra fields from record
        if hasattr(record, "extra_fields"):
            log_data.update(record.extra_fields)

        # Add exception info if present
        if record.exc_info:
            log_data["exception"] = {
                "type": record.exc_info[0].__name__ if record.exc_info[0] else None,
                "message": str(record.exc_info[1]) if record.exc_info[1] else None,
                "traceback": traceback.format_exception(*record.exc_info) if record.exc_info[0] else None
            }

        return json.dumps(log_data, default=str)


class ContextAdapter(logging.LoggerAdapter):
    """Logger adapter that adds context fields to all log records."""

    def process(self, msg, kwargs):
        extra = kwargs.get("extra", {})
        extra["extra_fields"] = {**self.extra, **extra.get("extra_fields", {})}
        kwargs["extra"] = extra
        return msg, kwargs


def get_structured_logger(
    name: str,
    level: int = logging.INFO,
    json_output: bool = None,
    context: Dict = None
) -> logging.Logger:
    """
    Get a logger configured for structured output.

    Args:
        name: Logger name
        level: Log level
        json_output: Force JSON output (auto-detects if None)
        context: Context fields to include in all logs

    Returns:
        Configured logger
    """
    logger = logging.getLogger(name)
    logger.setLevel(level)

    # Auto-detect JSON mode (use JSON in CI/production, readable in terminal)
    if json_output is None:
        json_output = os.environ.get("LOG_FORMAT", "").lower() == "json" or \
                     os.environ.get("CI") == "true" or \
                     not sys.stdout.isatty()

    # Remove existing handlers
    logger.handlers = []

    # Create handler
    handler = logging.StreamHandler()
    handler.setLevel(level)

    if json_output:
        handler.setFormatter(JSONFormatter())
    else:
        handler.setFormatter(logging.Formatter(
            "%(asctime)s - %(levelname)s - %(name)s - %(message)s",
            datefmt="%Y-%m-%d %H:%M:%S"
        ))

    logger.addHandler(handler)

    # Wrap with context adapter if context provided
    if context:
        return ContextAdapter(logger, context)

    return logger


@dataclass
class PipelineMetrics:
    """Metrics for pipeline execution."""
    pipeline_name: str
    start_time: datetime
    end_time: Optional[datetime] = None
    duration_seconds: Optional[float] = None
    records_processed: int = 0
    records_failed: int = 0
    records_skipped: int = 0
    bytes_processed: int = 0
    api_calls: int = 0
    errors: list = None

    def __post_init__(self):
        if self.errors is None:
            self.errors = []

    def record_error(self, error: str, context: Dict = None):
        """Record an error with optional context."""
        self.errors.append({
            "error": error,
            "context": context or {},
            "timestamp": datetime.utcnow().isoformat()
        })

    def complete(self):
        """Mark pipeline as complete and calculate duration."""
        self.end_time = datetime.utcnow()
        self.duration_seconds = (self.end_time - self.start_time).total_seconds()

    def to_dict(self) -> Dict:
        """Convert to dict for logging."""
        data = asdict(self)
        data["start_time"] = self.start_time.isoformat()
        if self.end_time:
            data["end_time"] = self.end_time.isoformat()
        return data


class PipelineLogger:
    """
    Logger wrapper for pipeline execution with metrics tracking.

    Example:
        with PipelineLogger("sec_ingest") as pl:
            for filing in filings:
                try:
                    process(filing)
                    pl.record_success()
                except Exception as e:
                    pl.record_failure(str(e))
    """

    def __init__(
        self,
        pipeline_name: str,
        logger: logging.Logger = None,
        context: Dict = None
    ):
        self.pipeline_name = pipeline_name
        self.logger = logger or get_structured_logger(pipeline_name)
        self.context = context or {}
        self.metrics = None

    def __enter__(self):
        self.metrics = PipelineMetrics(
            pipeline_name=self.pipeline_name,
            start_time=datetime.utcnow()
        )
        self.logger.info(f"Starting pipeline: {self.pipeline_name}", extra={
            "extra_fields": {"event": "pipeline_start", **self.context}
        })
        return self

    def __exit__(self, exc_type, exc_val, exc_tb):
        self.metrics.complete()

        if exc_type:
            self.metrics.record_error(str(exc_val))
            self.logger.error(f"Pipeline failed: {exc_val}", extra={
                "extra_fields": {
                    "event": "pipeline_error",
                    "metrics": self.metrics.to_dict(),
                    **self.context
                }
            }, exc_info=True)
        else:
            self.logger.info(f"Pipeline completed: {self.pipeline_name}", extra={
                "extra_fields": {
                    "event": "pipeline_complete",
                    "metrics": self.metrics.to_dict(),
                    **self.context
                }
            })

        return False  # Don't suppress exceptions

    def record_success(self, count: int = 1, bytes_size: int = 0):
        """Record successful processing."""
        self.metrics.records_processed += count
        self.metrics.bytes_processed += bytes_size

    def record_failure(self, error: str, context: Dict = None):
        """Record processing failure."""
        self.metrics.records_failed += 1
        self.metrics.record_error(error, context)
        self.logger.warning(f"Processing failed: {error}", extra={
            "extra_fields": {"event": "record_failure", "error": error, **(context or {})}
        })

    def record_skip(self, reason: str = None):
        """Record skipped record."""
        self.metrics.records_skipped += 1
        if reason:
            self.logger.debug(f"Skipped: {reason}")

    def record_api_call(self):
        """Record an API call."""
        self.metrics.api_calls += 1

    def info(self, message: str, **kwargs):
        """Log info message with context."""
        self.logger.info(message, extra={"extra_fields": {**self.context, **kwargs}})

    def debug(self, message: str, **kwargs):
        """Log debug message with context."""
        self.logger.debug(message, extra={"extra_fields": {**self.context, **kwargs}})

    def warning(self, message: str, **kwargs):
        """Log warning message with context."""
        self.logger.warning(message, extra={"extra_fields": {**self.context, **kwargs}})

    def error(self, message: str, **kwargs):
        """Log error message with context."""
        self.logger.error(message, extra={"extra_fields": {**self.context, **kwargs}})


@contextmanager
def log_timing(logger: logging.Logger, operation: str, **context):
    """
    Context manager for timing operations.

    Example:
        with log_timing(logger, "parse_filing", filing_id=123):
            parse_filing(content)
    """
    start = time.perf_counter()
    try:
        yield
    finally:
        duration = time.perf_counter() - start
        logger.info(f"{operation} completed", extra={
            "extra_fields": {
                "event": "timing",
                "operation": operation,
                "duration_ms": round(duration * 1000, 2),
                **context
            }
        })


def log_function_call(logger: logging.Logger = None):
    """
    Decorator to log function calls with timing.

    Example:
        @log_function_call(logger)
        def process_filing(filing_id):
            ...
    """
    def decorator(func: Callable) -> Callable:
        nonlocal logger
        if logger is None:
            logger = logging.getLogger(func.__module__)

        @functools.wraps(func)
        def wrapper(*args, **kwargs):
            start = time.perf_counter()
            try:
                result = func(*args, **kwargs)
                duration = time.perf_counter() - start
                logger.debug(f"{func.__name__} completed", extra={
                    "extra_fields": {
                        "event": "function_call",
                        "function": func.__name__,
                        "duration_ms": round(duration * 1000, 2),
                        "success": True
                    }
                })
                return result
            except Exception as e:
                duration = time.perf_counter() - start
                logger.error(f"{func.__name__} failed: {e}", extra={
                    "extra_fields": {
                        "event": "function_call",
                        "function": func.__name__,
                        "duration_ms": round(duration * 1000, 2),
                        "success": False,
                        "error": str(e)
                    }
                })
                raise

        return wrapper
    return decorator

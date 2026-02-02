"""
retry_utils.py - Robust Retry Logic

Provides decorators and utilities for handling transient failures
with exponential backoff and jitter.

Functions:
- retry_with_backoff: Decorator for automatic retries
- RetryConfig: Configuration class for retry behavior
"""

import time
import random
import logging
import functools
from typing import Callable, Type, Tuple, Optional, Any
from dataclasses import dataclass

import requests


@dataclass
class RetryConfig:
    """Configuration for retry behavior."""
    max_attempts: int = 3
    base_delay: float = 1.0  # seconds
    max_delay: float = 60.0  # seconds
    exponential_base: float = 2.0
    jitter: bool = True
    retryable_exceptions: Tuple[Type[Exception], ...] = (
        requests.exceptions.RequestException,
        requests.exceptions.Timeout,
        requests.exceptions.ConnectionError,
        ConnectionError,
        TimeoutError,
    )
    retryable_status_codes: Tuple[int, ...] = (429, 500, 502, 503, 504)


def calculate_delay(attempt: int, config: RetryConfig) -> float:
    """
    Calculate delay for next retry attempt using exponential backoff.

    Args:
        attempt: Current attempt number (0-indexed)
        config: Retry configuration

    Returns:
        Delay in seconds
    """
    delay = config.base_delay * (config.exponential_base ** attempt)
    delay = min(delay, config.max_delay)

    if config.jitter:
        # Add random jitter (0-25% of delay)
        jitter = delay * random.uniform(0, 0.25)
        delay += jitter

    return delay


def retry_with_backoff(
    config: RetryConfig = None,
    logger: logging.Logger = None
):
    """
    Decorator for retrying functions with exponential backoff.

    Args:
        config: Retry configuration (uses defaults if None)
        logger: Logger for retry messages

    Example:
        @retry_with_backoff(RetryConfig(max_attempts=5))
        def fetch_data():
            return requests.get(url)
    """
    if config is None:
        config = RetryConfig()

    if logger is None:
        logger = logging.getLogger(__name__)

    def decorator(func: Callable) -> Callable:
        @functools.wraps(func)
        def wrapper(*args, **kwargs) -> Any:
            last_exception = None

            for attempt in range(config.max_attempts):
                try:
                    result = func(*args, **kwargs)

                    # Check for retryable HTTP status codes
                    if isinstance(result, requests.Response):
                        if result.status_code in config.retryable_status_codes:
                            if attempt < config.max_attempts - 1:
                                delay = calculate_delay(attempt, config)

                                # Handle rate limiting with Retry-After header
                                retry_after = result.headers.get("Retry-After")
                                if retry_after:
                                    try:
                                        delay = max(delay, float(retry_after))
                                    except ValueError:
                                        pass

                                logger.warning(
                                    f"{func.__name__} returned {result.status_code}, "
                                    f"retrying in {delay:.1f}s (attempt {attempt + 1}/{config.max_attempts})"
                                )
                                time.sleep(delay)
                                continue

                    return result

                except config.retryable_exceptions as e:
                    last_exception = e

                    if attempt < config.max_attempts - 1:
                        delay = calculate_delay(attempt, config)
                        logger.warning(
                            f"{func.__name__} failed with {type(e).__name__}: {e}, "
                            f"retrying in {delay:.1f}s (attempt {attempt + 1}/{config.max_attempts})"
                        )
                        time.sleep(delay)
                    else:
                        logger.error(
                            f"{func.__name__} failed after {config.max_attempts} attempts: {e}"
                        )
                        raise

            # If we get here, all retries exhausted
            if last_exception:
                raise last_exception

        return wrapper
    return decorator


class RateLimiter:
    """
    Token bucket rate limiter for API calls.

    Example:
        limiter = RateLimiter(rate=10, per=1.0)  # 10 requests per second
        limiter.wait()  # Blocks if rate exceeded
        make_request()
    """

    def __init__(self, rate: float, per: float = 1.0):
        """
        Args:
            rate: Number of tokens (requests)
            per: Time period in seconds
        """
        self.rate = rate
        self.per = per
        self.tokens = rate
        self.last_update = time.monotonic()
        self._lock_time = 0

    def wait(self) -> float:
        """
        Wait until a token is available.

        Returns:
            Time waited in seconds
        """
        now = time.monotonic()
        time_passed = now - self.last_update
        self.tokens = min(self.rate, self.tokens + time_passed * (self.rate / self.per))
        self.last_update = now

        if self.tokens < 1:
            wait_time = (1 - self.tokens) * (self.per / self.rate)
            time.sleep(wait_time)
            self.tokens = 0
            return wait_time
        else:
            self.tokens -= 1
            return 0


class CircuitBreaker:
    """
    Circuit breaker pattern for failing fast on persistent errors.

    States:
    - CLOSED: Normal operation, requests allowed
    - OPEN: Too many failures, requests blocked
    - HALF_OPEN: Testing if service recovered
    """

    CLOSED = "closed"
    OPEN = "open"
    HALF_OPEN = "half_open"

    def __init__(
        self,
        failure_threshold: int = 5,
        recovery_timeout: float = 60.0,
        logger: logging.Logger = None
    ):
        self.failure_threshold = failure_threshold
        self.recovery_timeout = recovery_timeout
        self.logger = logger or logging.getLogger(__name__)
        self.state = self.CLOSED
        self.failures = 0
        self.last_failure_time = 0

    def can_execute(self) -> bool:
        """Check if request should be allowed."""
        if self.state == self.CLOSED:
            return True

        if self.state == self.OPEN:
            # Check if recovery timeout has passed
            if time.monotonic() - self.last_failure_time >= self.recovery_timeout:
                self.state = self.HALF_OPEN
                self.logger.info("Circuit breaker entering half-open state")
                return True
            return False

        # HALF_OPEN: allow one request to test
        return True

    def record_success(self):
        """Record successful request."""
        if self.state == self.HALF_OPEN:
            self.state = self.CLOSED
            self.failures = 0
            self.logger.info("Circuit breaker closed after successful request")
        elif self.state == self.CLOSED:
            self.failures = 0

    def record_failure(self):
        """Record failed request."""
        self.failures += 1
        self.last_failure_time = time.monotonic()

        if self.state == self.HALF_OPEN:
            self.state = self.OPEN
            self.logger.warning("Circuit breaker opened after half-open failure")
        elif self.failures >= self.failure_threshold:
            self.state = self.OPEN
            self.logger.warning(
                f"Circuit breaker opened after {self.failures} failures"
            )


def with_circuit_breaker(breaker: CircuitBreaker, logger: logging.Logger = None):
    """
    Decorator to wrap function with circuit breaker.

    Args:
        breaker: CircuitBreaker instance
        logger: Logger for messages

    Raises:
        CircuitBreakerOpen: If circuit is open
    """
    if logger is None:
        logger = logging.getLogger(__name__)

    def decorator(func: Callable) -> Callable:
        @functools.wraps(func)
        def wrapper(*args, **kwargs) -> Any:
            if not breaker.can_execute():
                raise CircuitBreakerOpen(
                    f"Circuit breaker is open for {func.__name__}"
                )

            try:
                result = func(*args, **kwargs)
                breaker.record_success()
                return result
            except Exception as e:
                breaker.record_failure()
                raise

        return wrapper
    return decorator


class CircuitBreakerOpen(Exception):
    """Raised when circuit breaker is open."""
    pass

"""
captcha.py - CAPTCHA detection and handling for BevAlc Intelligence

Detects CAPTCHAs on TTB pages and provides mechanisms for manual solving.
"""

import time
import sys
import os
from typing import Callable, Optional

# Try to import sound notification library
try:
    import winsound
    HAS_WINSOUND = True
except ImportError:
    HAS_WINSOUND = False


def detect_captcha(html: str) -> bool:
    """
    Detect if a page contains a CAPTCHA.
    
    Based on observed TTB CAPTCHA patterns:
    - Text-based visual CAPTCHA with "What code is in the image?"
    - May contain "captcha" in page source
    - May contain "access denied" for blocked requests
    """
    if not html:
        return False
    
    lower = html.lower()
    
    # Known CAPTCHA indicators from TTB site
    captcha_indicators = [
        'captcha',
        'what code is in the image',
        'g-recaptcha',
        'recaptcha',
        'access denied',
        'automated spam submission',
        'human visitor',
        'support id',  # TTB shows "Your support ID is:" on CAPTCHA page
    ]
    
    return any(indicator in lower for indicator in captcha_indicators)


def detect_captcha_selenium(driver) -> bool:
    """
    Detect CAPTCHA using a Selenium WebDriver instance.
    """
    try:
        html = driver.page_source
        return detect_captcha(html)
    except Exception:
        return False


def play_alert_sound():
    """Play an alert sound to notify user of CAPTCHA."""
    if HAS_WINSOUND:
        try:
            # Play system asterisk sound
            winsound.MessageBeep(winsound.MB_ICONEXCLAMATION)
            time.sleep(0.3)
            winsound.MessageBeep(winsound.MB_ICONEXCLAMATION)
        except Exception:
            pass
    else:
        # Terminal bell for non-Windows systems
        print('\a', end='', flush=True)
        time.sleep(0.3)
        print('\a', end='', flush=True)


def wait_for_captcha_solve(
    driver,
    check_interval: float = 2.0,
    max_wait: float = 300.0,  # 5 minutes
    on_waiting: Callable = None
) -> bool:
    """
    Wait for user to solve CAPTCHA manually.
    
    Args:
        driver: Selenium WebDriver instance
        check_interval: How often to check if CAPTCHA is solved (seconds)
        max_wait: Maximum time to wait before giving up (seconds)
        on_waiting: Optional callback called while waiting
    
    Returns:
        True if CAPTCHA was solved, False if timeout
    """
    start_time = time.time()
    
    print("\n" + "=" * 60)
    print("🛑 CAPTCHA DETECTED!")
    print("=" * 60)
    print("\nPlease solve the CAPTCHA in the browser window.")
    print("The scraper will automatically resume once solved.")
    print(f"\nTimeout in {int(max_wait)} seconds...")
    print("=" * 60 + "\n")
    
    # Play alert sound
    play_alert_sound()
    
    while time.time() - start_time < max_wait:
        if on_waiting:
            on_waiting()
        
        # Check if CAPTCHA is still present
        if not detect_captcha_selenium(driver):
            elapsed = time.time() - start_time
            print(f"\n✅ CAPTCHA solved! Resuming after {elapsed:.1f} seconds.\n")
            return True
        
        # Show countdown
        remaining = int(max_wait - (time.time() - start_time))
        print(f"\r⏳ Waiting for CAPTCHA solve... ({remaining}s remaining)", end='', flush=True)
        
        time.sleep(check_interval)
    
    print(f"\n\n❌ CAPTCHA timeout after {max_wait} seconds.\n")
    return False


def handle_captcha_interactive(
    driver,
    page_url: str = None,
    auto_refresh: bool = True
) -> bool:
    """
    Interactive CAPTCHA handling with user prompt.
    
    If running in an interactive terminal, shows the browser and waits for user input.
    Otherwise, waits for CAPTCHA to be solved by checking page state.
    
    Args:
        driver: Selenium WebDriver instance  
        page_url: URL to refresh after CAPTCHA solve (optional)
        auto_refresh: Whether to refresh the page after solve
        
    Returns:
        True if CAPTCHA was solved and we can proceed
    """
    # Make sure browser window is visible and focused
    try:
        driver.maximize_window()
    except Exception:
        pass
    
    # Check if we're in an interactive terminal
    if sys.stdin.isatty():
        print("\n" + "=" * 60)
        print("🛑 CAPTCHA DETECTED!")
        print("=" * 60)
        print("\n1. Solve the CAPTCHA in the browser window")
        print("2. Press ENTER here when done")
        print("\n(Or type 'skip' to skip this item, 'quit' to stop scraping)")
        print("=" * 60)
        
        play_alert_sound()
        
        try:
            response = input("\n> ").strip().lower()
            
            if response == 'quit':
                print("\n⏹️ Stopping scraper...")
                return False
            elif response == 'skip':
                print("\n⏭️ Skipping this item...")
                return False
            else:
                # User pressed enter, verify CAPTCHA is solved
                if detect_captcha_selenium(driver):
                    print("\n⚠️ CAPTCHA still detected. Please solve it completely.")
                    return handle_captcha_interactive(driver, page_url, auto_refresh)
                
                print("\n✅ CAPTCHA solved! Resuming...")
                
                # Optionally refresh to get clean page
                if auto_refresh and page_url:
                    time.sleep(1)
                    driver.get(page_url)
                    time.sleep(2)
                
                return True
                
        except EOFError:
            # Non-interactive, fall back to polling
            return wait_for_captcha_solve(driver)
    else:
        # Non-interactive mode, just poll
        return wait_for_captcha_solve(driver)


class CaptchaHandler:
    """
    Stateful CAPTCHA handler that tracks solve history and adapts behavior.
    """
    
    def __init__(self, 
                 max_captchas_per_session: int = 10,
                 cooldown_after_solve: float = 5.0):
        """
        Args:
            max_captchas_per_session: Stop scraping if too many CAPTCHAs
            cooldown_after_solve: Extra delay after solving CAPTCHA
        """
        self.max_captchas = max_captchas_per_session
        self.cooldown = cooldown_after_solve
        self.captcha_count = 0
        self.last_captcha_time = None
        self.total_solve_time = 0
    
    def reset(self):
        """Reset CAPTCHA counter (e.g., for new session)."""
        self.captcha_count = 0
        self.last_captcha_time = None
        self.total_solve_time = 0
    
    def handle(self, driver, page_url: str = None) -> bool:
        """
        Handle a detected CAPTCHA.
        
        Returns:
            True if we should continue scraping
            False if we should stop (too many CAPTCHAs or user quit)
        """
        self.captcha_count += 1
        start_time = time.time()
        
        print(f"\n📊 CAPTCHA #{self.captcha_count} this session")
        
        if self.captcha_count > self.max_captchas:
            print(f"\n❌ Too many CAPTCHAs ({self.captcha_count}). Stopping to avoid IP block.")
            print("Try again later or from a different IP.")
            return False
        
        # Handle the CAPTCHA
        solved = handle_captcha_interactive(driver, page_url, auto_refresh=False)
        
        if solved:
            solve_time = time.time() - start_time
            self.total_solve_time += solve_time
            self.last_captcha_time = time.time()
            
            # Apply cooldown
            print(f"⏸️ Cooling down for {self.cooldown}s after CAPTCHA...")
            time.sleep(self.cooldown)
            
            return True
        
        return False
    
    def get_stats(self) -> dict:
        """Get CAPTCHA handling statistics."""
        return {
            'captcha_count': self.captcha_count,
            'total_solve_time': self.total_solve_time,
            'avg_solve_time': self.total_solve_time / self.captcha_count if self.captcha_count > 0 else 0,
            'last_captcha_time': self.last_captcha_time,
        }

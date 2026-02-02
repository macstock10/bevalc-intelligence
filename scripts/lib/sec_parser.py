"""
sec_parser.py - SEC Filing Section Parser

Parses HTML/SGML SEC filings to extract specific sections:
- MD&A (Management's Discussion and Analysis)
- Risk Factors
- Business Description
- Financial Statements
- 8-K Item parsing

Functions:
- parse_10k_sections: Extract sections from 10-K annual report
- parse_10q_sections: Extract sections from 10-Q quarterly report
- parse_8k_items: Extract items from 8-K current report
- chunk_text: Split section text into chunks for embedding
"""

import re
import hashlib
import logging
from typing import List, Dict, Optional, Tuple
from html.parser import HTMLParser
from io import StringIO

# Section identifiers for 10-K/10-Q
SECTION_PATTERNS = {
    "mda": [
        r"Item\s*7[A]?\.\s*Management['']?s\s+Discussion",
        r"MANAGEMENT['']?S\s+DISCUSSION\s+AND\s+ANALYSIS",
        r"Item\s*2\.\s*Management['']?s\s+Discussion",  # 10-Q uses Item 2
    ],
    "risk_factors": [
        r"Item\s*1A\.\s*Risk\s+Factors",
        r"RISK\s+FACTORS",
    ],
    "business": [
        r"Item\s*1\.\s*Business",
        r"DESCRIPTION\s+OF\s+BUSINESS",
    ],
    "financial_statements": [
        r"Item\s*8\.\s*Financial\s+Statements",
        r"FINANCIAL\s+STATEMENTS\s+AND\s+SUPPLEMENTARY\s+DATA",
        r"Item\s*1\.\s*Financial\s+Statements",  # 10-Q
    ],
    "controls": [
        r"Item\s*9A\.\s*Controls",
        r"CONTROLS\s+AND\s+PROCEDURES",
        r"Item\s*4\.\s*Controls",  # 10-Q
    ],
    "legal_proceedings": [
        r"Item\s*3\.\s*Legal\s+Proceedings",
        r"LEGAL\s+PROCEEDINGS",
    ],
    "executive_compensation": [
        r"Item\s*11\.\s*Executive\s+Compensation",
        r"EXECUTIVE\s+COMPENSATION",
    ],
}

# 8-K Item definitions with priority classification
ITEM_8K_DEFINITIONS = {
    "1.01": {"title": "Entry into a Material Definitive Agreement", "priority": "high"},
    "1.02": {"title": "Termination of a Material Definitive Agreement", "priority": "high"},
    "1.03": {"title": "Bankruptcy or Receivership", "priority": "high"},
    "1.04": {"title": "Mine Safety", "priority": "low"},
    "2.01": {"title": "Completion of Acquisition or Disposition of Assets", "priority": "high"},
    "2.02": {"title": "Results of Operations and Financial Condition", "priority": "normal"},
    "2.03": {"title": "Creation of Direct Financial Obligation", "priority": "normal"},
    "2.04": {"title": "Triggering Events That Accelerate or Increase Obligation", "priority": "normal"},
    "2.05": {"title": "Costs Associated with Exit or Disposal Activities", "priority": "normal"},
    "2.06": {"title": "Material Impairments", "priority": "high"},
    "3.01": {"title": "Notice of Delisting or Transfer", "priority": "high"},
    "3.02": {"title": "Unregistered Sales of Equity Securities", "priority": "normal"},
    "3.03": {"title": "Material Modification to Rights of Security Holders", "priority": "high"},
    "4.01": {"title": "Changes in Registrant's Certifying Accountant", "priority": "high"},
    "4.02": {"title": "Non-Reliance on Previously Issued Financial Statements", "priority": "high"},
    "5.01": {"title": "Changes in Control of Registrant", "priority": "high"},
    "5.02": {"title": "Departure/Appointment of Directors or Officers", "priority": "high"},
    "5.03": {"title": "Amendments to Articles of Incorporation or Bylaws", "priority": "normal"},
    "5.04": {"title": "Temporary Suspension of Trading Under Employee Benefit Plans", "priority": "normal"},
    "5.05": {"title": "Amendments to Code of Ethics", "priority": "low"},
    "5.06": {"title": "Change in Shell Company Status", "priority": "normal"},
    "5.07": {"title": "Submission of Matters to a Vote of Security Holders", "priority": "low"},
    "5.08": {"title": "Shareholder Nominations", "priority": "low"},
    "6.01": {"title": "ABS Informational and Computational Material", "priority": "low"},
    "6.02": {"title": "Change of Servicer or Trustee", "priority": "low"},
    "6.03": {"title": "Change in Credit Enhancement", "priority": "low"},
    "6.04": {"title": "Failure to Make Distribution", "priority": "normal"},
    "6.05": {"title": "Securities Act Updating Disclosure", "priority": "low"},
    "7.01": {"title": "Regulation FD Disclosure", "priority": "normal"},
    "8.01": {"title": "Other Events", "priority": "normal"},
    "9.01": {"title": "Financial Statements and Exhibits", "priority": "low"},
}

_logger = None


def init_parser(logger: logging.Logger = None):
    """Initialize the parser with optional logger."""
    global _logger
    _logger = logger or logging.getLogger(__name__)


def _get_logger():
    """Get configured logger or default."""
    return _logger or logging.getLogger(__name__)


class HTMLTextExtractor(HTMLParser):
    """Extract text content from HTML, preserving some structure."""

    def __init__(self):
        super().__init__()
        self.result = []
        self.in_script = False
        self.in_style = False

    def handle_starttag(self, tag, attrs):
        if tag in ("script", "style"):
            self.in_script = tag == "script"
            self.in_style = tag == "style"
        elif tag in ("p", "div", "br", "tr", "li"):
            self.result.append("\n")
        elif tag == "td":
            self.result.append("\t")

    def handle_endtag(self, tag):
        if tag == "script":
            self.in_script = False
        elif tag == "style":
            self.in_style = False
        elif tag in ("p", "div", "table", "ul", "ol"):
            self.result.append("\n")

    def handle_data(self, data):
        if not self.in_script and not self.in_style:
            self.result.append(data)

    def get_text(self):
        return "".join(self.result)


def html_to_text(html: str) -> str:
    """Convert HTML to plain text, preserving basic structure."""
    parser = HTMLTextExtractor()
    try:
        parser.feed(html)
        text = parser.get_text()
    except Exception:
        # Fallback: simple regex strip
        text = re.sub(r"<[^>]+>", " ", html)

    # Clean up whitespace
    text = re.sub(r"[ \t]+", " ", text)
    text = re.sub(r"\n{3,}", "\n\n", text)
    return text.strip()


def _find_section_boundaries(text: str, patterns: List[str]) -> List[Tuple[int, int]]:
    """
    Find start positions of sections matching any pattern.

    Returns list of (start_pos, end_pos) tuples.
    """
    positions = []

    for pattern in patterns:
        for match in re.finditer(pattern, text, re.IGNORECASE | re.MULTILINE):
            positions.append((match.start(), match.end()))

    return sorted(positions, key=lambda x: x[0])


def _extract_section_content(text: str, start_pos: int, next_section_patterns: List[str], max_length: int = 500000) -> str:
    """
    Extract section content from start position until next section or max length.
    """
    # Build combined pattern for any next section
    all_patterns = []
    for patterns in SECTION_PATTERNS.values():
        all_patterns.extend(patterns)

    # Find where next section starts
    end_pos = len(text)
    remaining_text = text[start_pos:]

    for pattern in all_patterns:
        match = re.search(pattern, remaining_text[100:], re.IGNORECASE)  # Skip first 100 chars (current section header)
        if match:
            end_pos = min(end_pos, start_pos + 100 + match.start())

    # Apply max length limit
    end_pos = min(end_pos, start_pos + max_length)

    return text[start_pos:end_pos].strip()


def parse_10k_sections(html_content: str) -> Dict[str, Dict]:
    """
    Parse 10-K annual report and extract key sections.

    Args:
        html_content: Raw HTML content of the filing

    Returns:
        Dict mapping section_type to {content, content_hash, section_title}
    """
    logger = _get_logger()
    text = html_to_text(html_content)
    sections = {}

    for section_type, patterns in SECTION_PATTERNS.items():
        boundaries = _find_section_boundaries(text, patterns)

        if boundaries:
            start_pos, header_end = boundaries[0]
            content = _extract_section_content(text, start_pos, patterns)

            if len(content) > 500:  # Minimum viable section
                # Extract section title from header
                title_match = re.search(patterns[0], content[:500], re.IGNORECASE)
                title = title_match.group(0) if title_match else section_type.replace("_", " ").title()

                sections[section_type] = {
                    "content": content,
                    "content_hash": hashlib.md5(content.encode()).hexdigest(),
                    "section_title": title.strip(),
                }
                logger.debug(f"Extracted {section_type}: {len(content)} chars")

    return sections


def parse_10q_sections(html_content: str) -> Dict[str, Dict]:
    """
    Parse 10-Q quarterly report and extract key sections.

    Args:
        html_content: Raw HTML content of the filing

    Returns:
        Dict mapping section_type to {content, content_hash, section_title}
    """
    # 10-Q has similar structure to 10-K but uses different item numbers
    return parse_10k_sections(html_content)


def parse_8k_items(html_content: str) -> List[Dict]:
    """
    Parse 8-K current report and extract individual items.

    Args:
        html_content: Raw HTML content of the filing

    Returns:
        List of item dicts with item_number, item_title, content, priority
    """
    logger = _get_logger()
    text = html_to_text(html_content)
    items = []

    # Pattern to match 8-K item headers
    item_pattern = r"Item\s*(\d+\.\d+)\s*[\.\-\:\s]*([^\n]+)?"

    matches = list(re.finditer(item_pattern, text, re.IGNORECASE))

    for i, match in enumerate(matches):
        item_number = match.group(1)

        # Skip if item number not recognized
        if item_number not in ITEM_8K_DEFINITIONS:
            continue

        item_def = ITEM_8K_DEFINITIONS[item_number]

        # Extract content until next item or end
        start_pos = match.end()
        if i + 1 < len(matches):
            end_pos = matches[i + 1].start()
        else:
            end_pos = len(text)

        content = text[start_pos:end_pos].strip()

        # Skip if no meaningful content (just exhibits reference)
        if len(content) < 100 and "exhibit" in content.lower():
            continue

        # Skip item 9.01 if it's just exhibits
        if item_number == "9.01" and len(content) < 500:
            continue

        items.append({
            "item_number": item_number,
            "item_title": item_def["title"],
            "priority": item_def["priority"],
            "raw_content": content[:50000],  # Limit content size
        })
        logger.debug(f"Extracted 8-K Item {item_number}: {len(content)} chars")

    return items


def chunk_text(text: str, chunk_size: int = 1000, overlap: int = 200) -> List[Dict]:
    """
    Split text into overlapping chunks for embedding.

    Args:
        text: Full text to chunk
        chunk_size: Target size of each chunk in characters
        overlap: Overlap between consecutive chunks

    Returns:
        List of dicts with chunk_index, content, token_count (estimated)
    """
    if not text:
        return []

    chunks = []
    start = 0
    chunk_index = 0

    while start < len(text):
        end = start + chunk_size

        # Try to break at sentence boundary
        if end < len(text):
            # Look for sentence end near chunk boundary
            for punct in [". ", ".\n", "! ", "? "]:
                last_sent = text[start:end].rfind(punct)
                if last_sent > chunk_size * 0.5:  # Only use if > 50% through chunk
                    end = start + last_sent + 1
                    break

        chunk_content = text[start:end].strip()

        if chunk_content:
            # Estimate tokens (rough: ~4 chars per token for English)
            token_count = len(chunk_content) // 4

            chunks.append({
                "chunk_index": chunk_index,
                "content": chunk_content,
                "token_count": token_count,
            })
            chunk_index += 1

        start = end - overlap

    return chunks


def compute_content_hash(content: str) -> str:
    """Compute MD5 hash of content for change detection."""
    return hashlib.md5(content.encode("utf-8")).hexdigest()


def detect_boilerplate(current_content: str, historical_contents: List[str], threshold: float = 0.8) -> List[str]:
    """
    Detect boilerplate sentences that appear in multiple filings.

    Args:
        current_content: Content from current filing
        historical_contents: Content from previous filings
        threshold: Fraction of filings a sentence must appear in to be considered boilerplate

    Returns:
        List of sentences identified as boilerplate
    """
    # Split current content into sentences
    sentences = re.split(r"(?<=[.!?])\s+", current_content)
    sentences = [s.strip() for s in sentences if len(s.strip()) > 50]

    boilerplate = []
    min_appearances = int(len(historical_contents) * threshold)

    for sentence in sentences:
        # Normalize for comparison
        normalized = re.sub(r"\s+", " ", sentence.lower())
        appearances = sum(1 for hist in historical_contents if normalized in hist.lower())

        if appearances >= min_appearances:
            boilerplate.append(sentence)

    return boilerplate


def extract_key_metrics(mda_content: str) -> Dict[str, str]:
    """
    Extract key financial metrics mentioned in MD&A.

    Returns dict with metric names and values/context.
    """
    metrics = {}

    # Revenue patterns
    revenue_pattern = r"(?:net\s+)?(?:revenue|sales)[^\d]*\$?([\d,]+(?:\.\d+)?)\s*(?:million|billion)?"
    match = re.search(revenue_pattern, mda_content, re.IGNORECASE)
    if match:
        metrics["revenue_mention"] = match.group(0)

    # Growth patterns
    growth_pattern = r"(?:grew|increased|declined|decreased)[^\d]*(\d+(?:\.\d+)?)\s*%"
    match = re.search(growth_pattern, mda_content, re.IGNORECASE)
    if match:
        metrics["growth_mention"] = match.group(0)

    # Volume patterns (beverage specific)
    volume_pattern = r"(?:volume|shipments|cases)[^\d]*(\d+(?:\.\d+)?)\s*(?:million|thousand)?"
    match = re.search(volume_pattern, mda_content, re.IGNORECASE)
    if match:
        metrics["volume_mention"] = match.group(0)

    return metrics

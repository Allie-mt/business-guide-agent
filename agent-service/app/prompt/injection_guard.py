import re

INJECTION_PATTERNS = [
    re.compile(r"ignore\s+(all\s+)?previous\s+(instructions|prompts)", re.IGNORECASE),
    re.compile(r"forget\s+(all\s+)?previous", re.IGNORECASE),
    re.compile(r"you\s+are\s+now\s+a", re.IGNORECASE),
    re.compile(r"system\s*:\s*", re.IGNORECASE),
    re.compile(r"<\s*/?\s*(system|instruction|prompt)\s*>", re.IGNORECASE),
    re.compile(r"jailbreak", re.IGNORECASE),
    re.compile(r"sudo\s+", re.IGNORECASE),
    re.compile(r"rm\s+-rf", re.IGNORECASE),
    re.compile(r"DROP\s+TABLE", re.IGNORECASE),
    re.compile(r";\s*--", re.IGNORECASE),
]


def check_injection(text: str) -> tuple[bool, str | None]:
    for pattern in INJECTION_PATTERNS:
        match = pattern.search(text)
        if match:
            return True, f"检测到可疑模式: {match.group()}"
    return False, None


def sanitize_input(text: str) -> str:
    text = re.sub(r"<[^>]+>", "", text)
    text = re.sub(r"[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]", "", text)
    return text.strip()
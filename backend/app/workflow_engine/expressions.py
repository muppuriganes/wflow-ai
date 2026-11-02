"""Safe templating and condition evaluation.

Templates only substitute values ({{contact.name}}); conditions only compare values with a fixed
set of operators. Nothing is ever evaluated as code.
"""

import re
from datetime import datetime
from decimal import Decimal, InvalidOperation
from typing import Any
from zoneinfo import ZoneInfo

_TOKEN = re.compile(r"\{\{\s*([a-zA-Z_][\w.]{0,80})\s*\}\}")
_DAY_KEYS = ("mon", "tue", "wed", "thu", "fri", "sat", "sun")


def resolve(context: dict[str, Any], path: str) -> Any:
    value: Any = context
    for part in path.split("."):
        if not isinstance(value, dict):
            return None
        value = value.get(part)
    return value


def render(template: str, context: dict[str, Any], max_length: int = 4096) -> str:
    def replace(match: re.Match[str]) -> str:
        value = resolve(context, match.group(1))
        if value is None or isinstance(value, (dict, list)):
            return ""
        return str(value)

    return _TOKEN.sub(replace, template)[:max_length]


def _number(value: Any) -> Decimal | None:
    try:
        return Decimal(str(value).strip())
    except (InvalidOperation, ValueError):
        return None


def compare(left: Any, operator: str, right: str | None) -> bool:
    text = "" if left is None else str(left)
    target = right or ""
    match operator:
        case "equals":
            return text.strip().casefold() == target.strip().casefold()
        case "not_equals":
            return text.strip().casefold() != target.strip().casefold()
        case "contains":
            return target.casefold() in text.casefold()
        case "not_contains":
            return target.casefold() not in text.casefold()
        case "starts_with":
            return text.strip().casefold().startswith(target.strip().casefold())
        case "is_empty":
            return not text.strip()
        case "is_not_empty":
            return bool(text.strip())
        case "greater_than" | "less_than":
            a, b = _number(text), _number(target)
            if a is None or b is None:
                return False
            return a > b if operator == "greater_than" else a < b
    return False


def _words(text: str) -> set[str]:
    return set(re.findall(r"[\w']+", text.casefold()))


def keywords_match(text: str | None, keywords: list[str], mode: str = "any") -> bool:
    """Whole-word (or whole-phrase) matching, case-insensitive."""
    if not keywords:
        return True
    body = (text or "").casefold()
    words = _words(body)

    def hit(keyword: str) -> bool:
        k = keyword.casefold().strip()
        return (f" {k} " in f" {' '.join(re.findall(r'[\w]+', body))} ") if " " in k else k in words

    if mode == "all":
        return all(hit(k) for k in keywords)
    if mode == "exact":
        return body.strip(" .!?") in {k.casefold().strip() for k in keywords}
    return any(hit(k) for k in keywords)


def within_business_hours(now_utc: datetime, timezone: str, days: list[str], start: str, end: str) -> bool:
    local = now_utc.astimezone(ZoneInfo(timezone))
    if _DAY_KEYS[local.weekday()] not in days:
        return False
    current = local.strftime("%H:%M")
    if start <= end:
        return start <= current < end
    return current >= start or current < end  # overnight hours, e.g. 22:00–06:00

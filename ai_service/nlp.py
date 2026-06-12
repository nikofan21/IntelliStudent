import re
from typing import Dict, Any

DATE_RE = re.compile(r"\b(\d{1,2}[./-]\d{1,2}[./-]\d{2,4}|\d{4}-\d{2}-\d{2})\b")
EMAIL_RE = re.compile(r"\b[\w\.-]+@[\w\.-]+\.\w+\b")

FIO_LINE_RE = re.compile(r"^\s*ФИО\s*:\s*(.+?)\s*$", re.IGNORECASE | re.MULTILINE)
GROUP_LINE_RE = re.compile(r"^\s*Группа\s*:\s*(.+?)\s*$", re.IGNORECASE | re.MULTILINE)

FIO_RE_3 = re.compile(r"\b([А-ЯЁ][а-яё]+)\s+([А-ЯЁ][а-яё]+)\s+([А-ЯЁ][а-яё]+)\b")
FIO_RE_2 = re.compile(r"\b([А-ЯЁ][а-яё]+)\s+([А-ЯЁ][а-яё]+)\b")

DOC_RULES = [
    ("grade_report", ["оцен", "успеваем", "ведомост", "зачет", "экзамен"]),
    ("application", ["заявлен", "прошу", "ходатайств", "декан"]),
    ("certificate", ["справк", "подтвержда", "выдан"]),
    ("contract", ["договор", "контракт", "оплат"]),
]


def classify_doc(text: str) -> str:
    t = (text or "").lower()
    for label, keys in DOC_RULES:
        if any(k in t for k in keys):
            return label
    return "unknown"


def cleanup_spaces(value: str) -> str:
    value = value.replace("\n", " ").replace("\r", " ")
    value = re.sub(r"\s+", " ", value).strip()
    return value


def cleanup_fio(value: str) -> str:
    value = cleanup_spaces(value)
    stop_words = {"группа", "фио", "документ"}

    parts = value.split()
    cleaned = []

    for p in parts:
        if p.lower() in stop_words:
            break
        cleaned.append(p)

    return " ".join(cleaned).strip()


def normalize_group(value: str) -> str:
    value = cleanup_spaces(value)
    value = value.replace("—", "-").replace("–", "-").replace("_", "-")
    value = value.replace(" / ", "/").replace(" /", "/").replace("/ ", "/")
    value = re.sub(r"\s*-\s*", "-", value)
    return value.strip()


def extract_fio(text: str) -> str | None:
    if not text:
        return None

    m_line = FIO_LINE_RE.search(text)
    if m_line:
        fio = cleanup_fio(m_line.group(1))
        if fio:
            return fio

    for line in text.splitlines():
        line = line.strip()
        if not line:
            continue

        m3 = FIO_RE_3.search(line)
        if m3:
            return f"{m3.group(1)} {m3.group(2)} {m3.group(3)}".strip()

        m2 = FIO_RE_2.search(line)
        if m2:
            return f"{m2.group(1)} {m2.group(2)}".strip()

    m3 = FIO_RE_3.search(text)
    if m3:
        return f"{m3.group(1)} {m3.group(2)} {m3.group(3)}".strip()

    m2 = FIO_RE_2.search(text)
    if m2:
        return f"{m2.group(1)} {m2.group(2)}".strip()

    return None


def extract_group(text: str) -> str | None:
    if not text:
        return None

    m_line = GROUP_LINE_RE.search(text)
    if m_line:
        group_value = normalize_group(m_line.group(1))
        if group_value:
            return group_value

    for line in text.splitlines():
        line = line.strip()
        if not line:
            continue

        lower_line = line.lower()
        if lower_line.startswith("группа"):
            parts = line.split(":", 1)
            if len(parts) == 2:
                group_value = normalize_group(parts[1])
                if group_value:
                    return group_value

    fallback_patterns = [
        r"\b([А-ЯA-Z]{1,5}\d{1,3}-\d{1,3}[А-ЯA-Z0-9]{0,5})\b",
        r"\b([А-ЯA-Z]{1,5}-\d{1,3}[А-ЯA-Z0-9]{0,5})\b",
        r"\b([А-ЯA-Z0-9]+[-/][А-ЯA-Z0-9]+)\b",
    ]

    for pattern in fallback_patterns:
        m = re.search(pattern, text, re.IGNORECASE)
        if m:
            group_value = normalize_group(m.group(1))
            if group_value:
                return group_value

    return None


def extract_entities(text: str) -> Dict[str, Any]:
    t = text or ""

    dates = DATE_RE.findall(t)
    emails = EMAIL_RE.findall(t)

    fio = extract_fio(t)
    group_name = extract_group(t)

    return {
        "fio": fio,
        "group_name": group_name,
        "dates": dates[:20],
        "emails": list(dict.fromkeys(emails))[:20],
    }
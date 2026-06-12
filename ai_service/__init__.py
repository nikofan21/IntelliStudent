import re
from typing import Dict, Any, List

DATE_RE = re.compile(r"\b(\d{1,2}[./-]\d{1,2}[./-]\d{2,4}|\d{4}-\d{2}-\d{2})\b")
EMAIL_RE = re.compile(r"\b[\w\.-]+@[\w\.-]+\.\w+\b")

# очень простой "классификатор" по ключевым словам (для MVP)
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

def extract_entities(text: str) -> Dict[str, Any]:
    t = text or ""
    dates = DATE_RE.findall(t)
    emails = EMAIL_RE.findall(t)

    # супер-упрощенно: пытаемся вытащить ФИО по "ФИО:" или "Фамилия Имя Отчество"
    fio = None
    m = re.search(r"ФИО[:\s]+([А-ЯЁ][а-яё]+\s+[А-ЯЁ][а-яё]+\s+[А-ЯЁ][а-яё]+)", t)
    if m:
        fio = m.group(1)

    return {
        "fio": fio,
        "dates": dates[:20],
        "emails": list(dict.fromkeys(emails))[:20],
    }
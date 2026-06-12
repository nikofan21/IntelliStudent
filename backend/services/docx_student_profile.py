import re
from typing import Any, Dict, List, Optional


def normalize_text(value: Optional[str]) -> str:
    if not value:
        return ""
    value = value.replace("\n", " ").replace("\t", " ")
    value = re.sub(r"\s+", " ", value).strip().lower()
    return value


def fio_variants(full_name: str) -> List[str]:
    full = normalize_text(full_name)
    if not full:
        return []

    parts = full.split()
    variants = {full}

    if len(parts) >= 2:
        variants.add(f"{parts[0]} {parts[1]}")

    return [v for v in variants if v]


def raw_cell_text(cell) -> str:
    value = cell.text or ""
    value = value.replace("\n", " ").replace("\t", " ")
    value = re.sub(r"\s+", " ", value).strip()
    return value


def extract_table_rows(table) -> List[List[str]]:
    rows = []
    for row in table.rows:
        row_values = [raw_cell_text(cell) for cell in row.cells]
        if any(v.strip() for v in row_values):
            rows.append(row_values)
    return rows


def is_probable_header_row(row: List[str]) -> bool:
    if not row:
        return False

    joined = normalize_text(" | ".join(row))

    header_keywords = [
        "фио",
        "ф.и.о",
        "студент",
        "№",
        "номер",
        "дата рождения",
        "год рождения",
        "жсн",
        "иин",
        "адрес",
        "телефон",
        "семья",
        "родители",
        "email",
        "почта",
        "курс",
        "группа",
        "проживание",
        "общежитие",
    ]

    return any(keyword in joined for keyword in header_keywords)


def make_headers(row: List[str]) -> List[str]:
    headers = []
    for index, value in enumerate(row):
        clean = value.strip() if value else ""
        headers.append(clean if clean else f"column_{index + 1}")
    return headers


def row_matches_student(row: List[str], student_full_name: str) -> bool:
    variants = fio_variants(student_full_name)
    normalized_cells = [normalize_text(cell) for cell in row]
    joined_row = normalize_text(" ".join(row))

    for variant in variants:
        if not variant:
            continue

        if variant in joined_row:
            return True

        for cell in normalized_cells:
            if variant in cell:
                return True

    return False


def build_row_dict(headers: List[str], row: List[str]) -> Dict[str, str]:
    result = {}
    max_len = max(len(headers), len(row))

    for i in range(max_len):
        key = headers[i] if i < len(headers) else f"column_{i + 1}"
        value = row[i] if i < len(row) else ""
        result[key] = value

    return result


def build_student_profile_from_docx(parsed_doc: Any, student_full_name: str) -> Dict[str, Any]:
    if parsed_doc is None:
        return {
            "found": False,
            "reason": "DOCX document is empty or not opened",
            "table_index": None,
            "row_index": None,
            "headers": [],
            "row_data": None,
        }

    tables = getattr(parsed_doc, "tables", [])
    if not tables:
        return {
            "found": False,
            "reason": "No tables found in DOCX",
            "table_index": None,
            "row_index": None,
            "headers": [],
            "row_data": None,
        }

    for table_index, table in enumerate(tables):
        rows = extract_table_rows(table)
        if not rows:
            continue

        if is_probable_header_row(rows[0]):
            headers = make_headers(rows[0])
            start_row_index = 1
        else:
            max_columns = max(len(r) for r in rows)
            headers = [f"column_{i + 1}" for i in range(max_columns)]
            start_row_index = 0

        for row_index in range(start_row_index, len(rows)):
            row = rows[row_index]

            if row_matches_student(row, student_full_name):
                row_data = build_row_dict(headers, row)

                return {
                    "found": True,
                    "match_type": "exact",
                    "reason": None,
                    "table_index": table_index,
                    "row_index": row_index,
                    "headers": headers,
                    "row_data": row_data,
                }

    return {
        "found": False,
        "reason": "Exact student row not found",
        "table_index": None,
        "row_index": None,
        "headers": [],
        "row_data": None,
    }
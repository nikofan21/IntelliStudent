import os
import re
from typing import Optional, Set, Dict, Any, List, Tuple

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from ..database import SessionLocal
from ..models.models import (
    Group,
    Student,
    Document,
    AIResult,
    User,
    DocumentStudent,
    UserGroup,
)
from ..auth.security import get_current_user, get_user_department_ids
from ..utils.text_extract import open_docx

router = APIRouter(prefix="/search", tags=["Search"])

ANALYTICS_VERSION = "analytics_rewrite_v6_real_structured_tables_2026_06_16"

BASE_DIR = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
STORAGE_DIR = os.path.join(BASE_DIR, "storage", "documents")


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


def get_user_group_ids(db: Session, user_id: int) -> Set[int]:
    links = db.query(UserGroup).filter(UserGroup.user_id == user_id).all()
    return {link.group_id for link in links}


def normalize_text(value: Optional[str]) -> str:
    if value is None:
        return ""

    value = str(value).lower()
    value = value.replace("ё", "е")
    value = value.replace("і", "и")
    value = value.replace("ї", "и")
    value = value.replace("ң", "н")
    value = value.replace("ғ", "г")
    value = value.replace("қ", "к")
    value = value.replace("ұ", "у")
    value = value.replace("ү", "у")
    value = value.replace("ө", "о")
    value = value.replace("ә", "а")
    value = value.replace("һ", "х")
    value = value.replace("\u00a0", " ")
    value = value.replace("\n", " ").replace("\r", " ").replace("\t", " ")
    value = re.sub(r"[^a-zа-я0-9]+", " ", value)
    value = re.sub(r"\s+", " ", value).strip()
    return value


def compact_text(value: Optional[str]) -> str:
    return re.sub(r"\s+", " ", str(value or "").replace("\n", " ").replace("\t", " ")).strip()


WORD_RE = re.compile(r"[a-zа-я0-9]+")


def tokenize(value: Optional[str]) -> List[str]:
    return WORD_RE.findall(normalize_text(value))


def raw_cell_text(cell) -> str:
    try:
        value = cell.text or ""
    except Exception:
        value = ""
    return compact_text(value)


def table_to_rows(table) -> List[List[str]]:
    rows: List[List[str]] = []
    for row in table.rows:
        values = [raw_cell_text(cell) for cell in row.cells]
        if any(v.strip() for v in values):
            rows.append(values)
    return rows


def is_header_row(row: List[str]) -> bool:
    joined = normalize_text(" | ".join(row))
    header_words = [
        "фио", "студент", "аты жони", "аты жони", "туган", "год", "дата",
        "иин", "жсн", "адрес", "телефон", "родител", "ата ана", "семья",
        "пол", "возраст", "национ", "сирот", "жетим", "опек", "камкор",
        "общежит", "жатакхана", "многодет", "коп балалы", "откуда", "кайдан",
    ]
    hits = sum(1 for word in header_words if word in joined)
    return hits >= 1


def make_headers(row: List[str]) -> List[str]:
    headers = []
    for index, value in enumerate(row):
        clean = compact_text(value)
        headers.append(clean if clean else f"column_{index + 1}")
    return headers


def build_row_dict(headers: List[str], row: List[str]) -> Dict[str, str]:
    result: Dict[str, str] = {}
    max_len = max(len(headers), len(row))
    for i in range(max_len):
        key = headers[i] if i < len(headers) else f"column_{i + 1}"
        value = row[i] if i < len(row) else ""
        result[key] = value
    return result


def name_parts(full_name: str) -> List[str]:
    return [p for p in tokenize(full_name) if p]


def student_name_variants(student: Student) -> List[str]:
    parts = name_parts(student.full_name)
    variants = {normalize_text(student.full_name)}

    if len(parts) >= 2:
        variants.add(f"{parts[0]} {parts[1]}")
        variants.add(f"{parts[1]} {parts[0]}")
    if len(parts) >= 3:
        variants.add(f"{parts[0]} {parts[1]} {parts[2]}")

    return [v for v in variants if len(v) >= 3]


def row_matches_student(row: List[str], student: Student) -> bool:
    joined = normalize_text(" ".join(row))
    if not joined:
        return False

    for variant in student_name_variants(student):
        if variant and variant in joined:
            return True

    # Если в ячейке указан только "Фамилия Имя", это тоже засчитываем.
    parts = name_parts(student.full_name)
    if len(parts) >= 2:
        surname, first_name = parts[0], parts[1]
        if surname in joined and first_name in joined:
            return True

    return False


def cell_contains_student_name(cell_text: str, student: Student) -> bool:
    text = normalize_text(cell_text)
    if not text:
        return False

    for variant in student_name_variants(student):
        if variant and variant in text:
            return True

    parts = name_parts(student.full_name)
    if len(parts) >= 2:
        return parts[0] in text and parts[1] in text

    return False


def is_empty_or_negative(value: Optional[str]) -> bool:
    v = normalize_text(value)
    if not v:
        return True

    negatives = {
        "нет", "жок", "жоқ", "no", "none", "не", "нет данных",
        "не указано", "отсутствует", "отсутствуют", "не имеется",
        "не имеет", "не является", "не проживает", "0", "ноль",
        "минус", "прочерк", "column",
    }
    if v in negatives:
        return True

    if set(v) <= {"-", "—", "_"}:
        return True

    if v.startswith("нет ") or v.startswith("не "):
        return True

    return False


def contains_any(text: Optional[str], needles: List[str]) -> bool:
    t = normalize_text(text)
    return any(normalize_text(n) in t for n in needles if n)


def parse_positive_int(value: Optional[str]) -> Optional[int]:
    v = normalize_text(value)
    match = re.search(r"\d+", v)
    if not match:
        return None
    try:
        return int(match.group(0))
    except Exception:
        return None


# ВАЖНО: порядок имеет значение. Например "не полная семья" проверяется раньше "полная семья".
CATEGORY_ALIASES: Dict[str, List[str]] = {
    "half_orphan": [
        "полусирота", "полусироты", "полу сирота", "полу сироты", "на половину сироты",
        "наполовину сироты", "жартылай жетим", "жартылай жетім",
    ],
    "single_parent": [
        "не полная семья", "неполная семья", "не полные семьи", "неполные семьи",
        "разведенные", "разведенные семьи", "развод", "ажырас", "одинокая мать",
        "одинокий отец", "один родитель",
    ],
    "full_family": [
        "полная семья", "полные семьи", "толык отбасы", "толық отбасы",
    ],
    "orphan": [
        "сирота", "сироты", "дети сироты", "дети сироты под опекой", "жетим", "жетім",
        "без попечения", "без попечения родителей", "оставшиеся без попечения",
    ],
    "guardian": [
        "опека", "опекун", "с опекуном", "попечитель", "камкор", "қамқор",
    ],
    "large_family": [
        "многодетные", "многодетная", "многодетная семья", "многодетные семьи",
        "коп балалы", "көп балалы", "3 и более детей", "трое детей",
    ],
    "low_income": [
        "малообеспеченные", "малообеспеченная семья", "малоимущие", "асп",
        "адресная социальная помощь", "социальная помощь", "жагдайы нашар",
    ],
    "bad_family": [
        "неблагополучные", "неблагополучная семья", "жагдайы нашар", "неблогополученные",
    ],
    "dormitory": [
        "общежитие", "общежитии", "общага", "общаге", "жатакхана", "жатақхана",
    ],
    "rent_home": [
        "съемная квартира", "съем", "аренда", "арендная квартира", "жалдамалы пәтер",
        "жалдамалы патер",
    ],
    "own_home": [
        "свой дом", "собственный дом", "өз үйі", "оз уйи", "оз уй", "свое жилье",
    ],
    "relatives_home": [
        "у родственников", "родственники", "родственников", "туыстарынын үйінде", "туыстарынын уйинде",
    ],
    "male": [
        "мальчики", "мальчик", "парни", "мужской", "муж", "ұл", "ул", "ер бала",
    ],
    "female": [
        "девочки", "девочка", "девушки", "женский", "жен", "қыз", "кыз",
    ],
}

NATIONALITY_ALIASES: Dict[str, List[str]] = {
    "казах": ["казах", "казахи", "казашка", "казахская"],
    "уйгур": ["уйгур", "уйгуры", "уйгурка", "уйгурская", "уигур"],
    "русский": ["русский", "русские", "русская"],
    "узбек": ["узбек", "узбеки", "узбечка"],
    "татар": ["татар", "татары", "татарка"],
}

LOCATION_CATEGORY_ALIASES: Dict[str, List[str]] = {
    "almaty_city": ["город алматы", "г алматы", "алматы қаласы", "алматы каласы"],
    "almaty_region": ["алматинская область", "алматы облысы", "алмат обл"],
    "zhetysu_region": ["жетысуская обл", "жетису", "жетысу"],
    "abai_region": ["абайская обл", "абайская область", "абай обл"],
    "uko_region": ["юко", "око", "оңтүстік", "онтустик", "шымкент"],
}


def detect_query(query: str) -> Dict[str, Any]:
    q = normalize_text(query)
    tokens = tokenize(query)

    result: Dict[str, Any] = {
        "raw": query,
        "normalized": q,
        "mode": "free_text",
        "category": None,
        "value": None,
    }

    if not q:
        return result

    # Возраст: "15 лет", "16 жас". Просто "15" не трогаем, чтобы не ловить ИИН/телефоны.
    age_match = re.search(r"\b(\d{1,2})\s*(лет|год|года|жас)\b", q)
    if age_match:
        result.update({"mode": "age", "value": int(age_match.group(1))})
        return result

    # Телефон / ИИН: точный числовой поиск.
    digits = re.sub(r"\D+", "", query or "")
    if len(digits) >= 9:
        result.update({"mode": "number", "value": digits})
        return result

    # Национальность.
    for normalized_value, aliases in NATIONALITY_ALIASES.items():
        if any(normalize_text(alias) == q or normalize_text(alias) in q for alias in aliases):
            result.update({"mode": "nationality", "value": normalized_value})
            return result

    # Локации из специальных таблиц + обычный адресный поиск.
    for location_key, aliases in LOCATION_CATEGORY_ALIASES.items():
        if any(normalize_text(alias) in q for alias in aliases):
            result.update({"mode": "location_category", "category": location_key})
            return result

    # Категории. Сначала длинные/опасные запросы, потом короткие.
    for category, aliases in CATEGORY_ALIASES.items():
        for alias in aliases:
            a = normalize_text(alias)
            if not a:
                continue
            if q == a or a in q:
                result.update({"mode": "category", "category": category})
                return result

    # Частые адресные запросы.
    if any(word in q for word in ["село", "аул", "поселок", "посёлок", "район", "область", "улица", "ул", "кв", "дом"]):
        result.update({"mode": "free_text"})
        return result

    # Если похоже на группу.
    if re.search(r"[а-яa-z]{1,6}\d{2}\s*[- ]\s*\d", q):
        result.update({"mode": "group"})
        return result

    return result


def header_category(header: str) -> Optional[str]:
    h = normalize_text(header)

    if not h:
        return None

    # Важно: "жартылай жетім" и "на половину сироты" должны быть НЕ сиротами, а полусиротами.
    if any(x in h for x in ["жартылай", "на половину", "наполовину", "полусир"]):
        return "half_orphan"

    if any(x in h for x in ["ажырас", "развед", "не полная", "неполная"]):
        return "single_parent"

    if any(x in h for x in ["толык отбасы", "толық отбасы", "полная семья"]):
        return "full_family"

    if any(x in h for x in ["дети сироты", "сирот", "жетим", "жетім"]):
        return "orphan"

    if any(x in h for x in ["камкор", "қамқор", "опек", "попеч"]):
        return "guardian"

    if any(x in h for x in ["коп балалы", "көп балалы", "многодет"]):
        return "large_family"

    if any(x in h for x in ["жагдайы нашар", "неблагополуч"]):
        return "bad_family"

    if any(x in h for x in ["малообеспеч", "малоимущ", "асп"]):
        return "low_income"

    if any(x in h for x in ["жатакхана", "общежит", "общага"]):
        return "dormitory"

    if any(x in h for x in ["жалдамалы", "съем", "аренд"]):
        return "rent_home"

    if any(x in h for x in ["өз үй", "оз уй", "свой дом", "собствен"]):
        return "own_home"

    if any(x in h for x in ["туыс", "родствен"]):
        return "relatives_home"

    return None


def header_location_category(header: str) -> Optional[str]:
    h = normalize_text(header)
    if any(x in h for x in ["город алматы", "алматы каласы", "алматы қаласы"]):
        return "almaty_city"
    if any(x in h for x in ["алматинская область", "алматы облысы", "алмат обл"]):
        return "almaty_region"
    if "жетыс" in h or "жетис" in h:
        return "zhetysu_region"
    if "абай" in h:
        return "abai_region"
    if "юко" in h or "око" in h or "онтустик" in h:
        return "uko_region"
    return None


def value_matches_full_family(value: str) -> bool:
    v = normalize_text(value)
    if not v or is_empty_or_negative(v):
        return False
    if "не полная" in v or "неполная" in v or "развод" in v or "ажырас" in v:
        return False
    return "полная семья" in v or "толык отбасы" in v or "толық отбасы" in v


def value_matches_single_parent(value: str) -> bool:
    v = normalize_text(value)
    if not v or is_empty_or_negative(v):
        return False
    return any(x in v for x in ["не полная", "неполная", "развод", "развед", "ажырас", "одинок"])


def row_value_for_headers(row_data: Dict[str, str], header_needles: List[str]) -> List[Tuple[str, str]]:
    result: List[Tuple[str, str]] = []
    for header, value in row_data.items():
        h = normalize_text(header)
        if any(needle in h for needle in header_needles):
            result.append((header, value))
    return result


def match_category_in_row(row_data: Dict[str, str], category: str) -> Optional[Dict[str, Any]]:
    # Социальное положение: важно проверять значение ячейки, а не заголовок.
    if category == "full_family":
        for header, value in row_data.items():
            h = normalize_text(header)
            if any(x in h for x in ["социаль", "семья", "отбасы"]):
                if value_matches_full_family(value):
                    return {"score": 100, "source": "structured_row_value", "fragment": f"{header}: {value}"}
        return None

    if category == "single_parent":
        for header, value in row_data.items():
            h = normalize_text(header)
            if any(x in h for x in ["социаль", "семья", "отбасы"]):
                if value_matches_single_parent(value):
                    return {"score": 100, "source": "structured_row_value", "fragment": f"{header}: {value}"}
        return None

    if category == "orphan":
        for header, value in row_data.items():
            h = normalize_text(header)
            v = normalize_text(value)
            if any(x in h for x in ["сирот", "жетим", "жетім"]):
                if not is_empty_or_negative(value):
                    return {"score": 100, "source": "structured_row_value", "fragment": f"{header}: {value}"}
            # Иногда статус записывают не в отдельную колонку, а в социальной колонке.
            if any(x in h for x in ["социаль", "семья", "отбасы"]):
                if any(x in v for x in ["сирот", "жетим", "жетім", "без попечения"]):
                    if not any(x in v for x in ["полусир", "жартылай", "на половину"]):
                        return {"score": 100, "source": "structured_row_value", "fragment": f"{header}: {value}"}
        return None

    if category == "half_orphan":
        for header, value in row_data.items():
            h = normalize_text(header)
            v = normalize_text(value)
            if any(x in h for x in ["полусир", "жартылай", "на половину"]):
                if not is_empty_or_negative(value):
                    return {"score": 100, "source": "structured_row_value", "fragment": f"{header}: {value}"}
            if any(x in h for x in ["социаль", "семья", "отбасы"]):
                if any(x in v for x in ["полусир", "жартылай", "на половину"]):
                    return {"score": 100, "source": "structured_row_value", "fragment": f"{header}: {value}"}
        return None

    if category == "guardian":
        for header, value in row_data.items():
            h = normalize_text(header)
            v = normalize_text(value)
            if any(x in h for x in ["опек", "камкор", "қамқор", "попеч"]):
                if not is_empty_or_negative(value):
                    return {"score": 100, "source": "structured_row_value", "fragment": f"{header}: {value}"}
            if any(x in v for x in ["опек", "попеч", "камкор", "қамқор"]):
                return {"score": 95, "source": "structured_row_value", "fragment": f"{header}: {value}"}
        return None

    if category == "large_family":
        for header, value in row_data.items():
            h = normalize_text(header)
            v = normalize_text(value)
            if any(x in h for x in ["многодет", "коп балалы", "көп балалы"]):
                if not is_empty_or_negative(value):
                    return {"score": 100, "source": "structured_row_value", "fragment": f"{header}: {value}"}
            if any(x in h for x in ["кол во детей", "количество детей", "детей семье", "дети семье"]):
                n = parse_positive_int(value)
                if n is not None and n >= 3:
                    return {"score": 96, "source": "structured_row_value", "fragment": f"{header}: {value}"}
            if "многодет" in v:
                return {"score": 95, "source": "structured_row_value", "fragment": f"{header}: {value}"}
        return None

    if category in {"low_income", "bad_family"}:
        needles = {
            "low_income": ["малообеспеч", "малоимущ", "асп", "социальная помощь"],
            "bad_family": ["неблагополуч", "жагдайы нашар"],
        }[category]
        for header, value in row_data.items():
            h = normalize_text(header)
            v = normalize_text(value)
            if any(n in h for n in needles) and not is_empty_or_negative(value):
                return {"score": 100, "source": "structured_row_value", "fragment": f"{header}: {value}"}
            if any(n in v for n in needles):
                return {"score": 90, "source": "structured_row_value", "fragment": f"{header}: {value}"}
        return None

    if category in {"dormitory", "rent_home", "own_home", "relatives_home"}:
        value_needles = {
            "dormitory": ["общежит", "общага", "жатакхана"],
            "rent_home": ["съем", "аренд", "жалдамалы"],
            "own_home": ["свой дом", "собствен", "оз уй", "өз үй"],
            "relatives_home": ["родствен", "туыс"],
        }[category]
        for header, value in row_data.items():
            h = normalize_text(header)
            v = normalize_text(value)
            if any(n in h for n in value_needles) and not is_empty_or_negative(value):
                return {"score": 100, "source": "structured_row_value", "fragment": f"{header}: {value}"}
            if any(n in v for n in value_needles):
                return {"score": 90, "source": "structured_row_value", "fragment": f"{header}: {value}"}
        return None

    if category == "male":
        for header, value in row_data.items():
            h = normalize_text(header)
            v = normalize_text(value)
            if h in ["пол", "жынысы"] or "пол" == h or "жыныс" in h:
                if v in ["муж", "мужской", "м", "ул", "ұл"]:
                    return {"score": 100, "source": "structured_row_value", "fragment": f"{header}: {value}"}
        return None

    if category == "female":
        for header, value in row_data.items():
            h = normalize_text(header)
            v = normalize_text(value)
            if h in ["пол", "жынысы"] or "пол" == h or "жыныс" in h:
                if v in ["жен", "женский", "ж", "кыз", "қыз"]:
                    return {"score": 100, "source": "structured_row_value", "fragment": f"{header}: {value}"}
        return None

    return None


def match_nationality_in_row(row_data: Dict[str, str], nationality: str) -> Optional[Dict[str, Any]]:
    for header, value in row_data.items():
        h = normalize_text(header)
        v = normalize_text(value)
        if "национ" in h or "ұлт" in h or "улт" in h:
            if v == nationality or nationality in v:
                return {"score": 100, "source": "nationality_row_value", "fragment": f"{header}: {value}"}
    return None


def match_age_in_row(row_data: Dict[str, str], age: int) -> Optional[Dict[str, Any]]:
    for header, value in row_data.items():
        h = normalize_text(header)
        if "возраст" in h or "жас" in h:
            n = parse_positive_int(value)
            if n == age:
                return {"score": 100, "source": "age_row_value", "fragment": f"{header}: {value}"}
    return None


def match_number_in_row(row_data: Dict[str, str], digits: str) -> Optional[Dict[str, Any]]:
    if not digits:
        return None
    for header, value in row_data.items():
        value_digits = re.sub(r"\D+", "", str(value or ""))
        if digits in value_digits:
            return {"score": 100, "source": "number_row_value", "fragment": f"{header}: {value}"}
    return None


def match_location_category_in_column(header: str, query_category: str) -> bool:
    return header_location_category(header) == query_category


def match_free_text_in_row(row_data: Dict[str, str], student: Student, group: Optional[Group], query_info: Dict[str, Any]) -> Optional[Dict[str, Any]]:
    q = query_info["normalized"]
    if not q:
        return None

    # ФИО студента.
    student_text = normalize_text(student.full_name)
    if q in student_text:
        return {"score": 100, "source": "student_name", "fragment": f"ФИО: {student.full_name}"}

    # Группа.
    if group and q in normalize_text(group.name):
        return {"score": 95, "source": "group_name", "fragment": f"Группа: {group.name}"}

    q_tokens = [t for t in tokenize(q) if len(t) >= 2]
    if not q_tokens:
        return None

    best: Optional[Dict[str, Any]] = None
    for header, value in row_data.items():
        v = normalize_text(value)
        if not v or is_empty_or_negative(value):
            continue

        # Не ищем по заголовку, только по значению.
        if q in v:
            candidate = {"score": 85, "source": "row_value", "fragment": f"{header}: {value}"}
        elif len(q_tokens) >= 2 and all(token in v for token in q_tokens):
            candidate = {"score": 80, "source": "row_value_tokens", "fragment": f"{header}: {value}"}
        else:
            continue

        if best is None or candidate["score"] > best["score"]:
            best = candidate

    return best


def match_query_in_row(row_data: Dict[str, str], student: Student, group: Optional[Group], query_info: Dict[str, Any]) -> Optional[Dict[str, Any]]:
    mode = query_info["mode"]

    if mode == "category":
        return match_category_in_row(row_data, query_info["category"])

    if mode == "nationality":
        return match_nationality_in_row(row_data, query_info["value"])

    if mode == "age":
        return match_age_in_row(row_data, query_info["value"])

    if mode == "number":
        return match_number_in_row(row_data, query_info["value"])

    # Для location_category сначала пробуем специальные таблицы-колонки.
    # В row_data всё равно разрешаем искать адресом по значению.
    return match_free_text_in_row(row_data, student, group, query_info)


def find_student_row_profiles(parsed_doc: Any, student: Student) -> List[Dict[str, Any]]:
    profiles: List[Dict[str, Any]] = []
    if parsed_doc is None:
        return profiles

    tables = getattr(parsed_doc, "tables", []) or []
    for table_index, table in enumerate(tables):
        rows = table_to_rows(table)
        if not rows:
            continue

        # Для обычных таблиц первая строка — заголовки, дальше строки студентов.
        if is_header_row(rows[0]):
            headers = make_headers(rows[0])
            start_row_index = 1
        else:
            max_columns = max(len(row) for row in rows)
            headers = [f"column_{i + 1}" for i in range(max_columns)]
            start_row_index = 0

        for row_index in range(start_row_index, len(rows)):
            row = rows[row_index]
            if row_matches_student(row, student):
                profiles.append({
                    "table_index": table_index,
                    "row_index": row_index,
                    "headers": headers,
                    "row_data": build_row_dict(headers, row),
                    "row": row,
                })

    return profiles


def match_query_in_category_tables(parsed_doc: Any, student: Student, query_info: Dict[str, Any]) -> Optional[Dict[str, Any]]:
    if parsed_doc is None:
        return None

    mode = query_info["mode"]
    if mode not in {"category", "location_category"}:
        return None

    tables = getattr(parsed_doc, "tables", []) or []
    for table_index, table in enumerate(tables):
        rows = table_to_rows(table)
        if len(rows) < 2:
            continue

        headers = make_headers(rows[0])

        for col_index, header in enumerate(headers):
            header_match = False
            if mode == "category":
                header_match = header_category(header) == query_info["category"]
            elif mode == "location_category":
                header_match = match_location_category_in_column(header, query_info["category"])

            if not header_match:
                continue

            for row_index in range(1, len(rows)):
                row = rows[row_index]
                if col_index >= len(row):
                    continue

                cell_value = row[col_index]
                if is_empty_or_negative(cell_value):
                    continue

                if cell_contains_student_name(cell_value, student):
                    return {
                        "score": 100,
                        "source": "category_column",
                        "fragment": f"{header}: {cell_value}",
                        "table_index": table_index,
                        "row_index": row_index,
                    }

    return None


def safe_open_docx_document(doc: Document):
    if doc.file_type != "docx":
        return None

    candidates: List[str] = []
    filepath = doc.filepath or ""
    candidates.append(filepath)

    # На Windows filepath в БД может быть абсолютным. После переноса проекта путь может не существовать.
    basename = filepath.replace("\\", "/").split("/")[-1]
    if basename:
        candidates.append(os.path.join(STORAGE_DIR, basename))

    uuid_prefix = ""
    if "_" in basename:
        uuid_prefix = basename.split("_", 1)[0]
    elif doc.filename and "_" in doc.filename:
        uuid_prefix = doc.filename.split("_", 1)[0]

    if uuid_prefix and os.path.isdir(STORAGE_DIR):
        try:
            for filename in os.listdir(STORAGE_DIR):
                if filename.startswith(uuid_prefix + "_"):
                    candidates.append(os.path.join(STORAGE_DIR, filename))
        except Exception:
            pass

    # Последний шанс: ищем файл по окончанию имени документа.
    if doc.filename and os.path.isdir(STORAGE_DIR):
        file_name_norm = normalize_text(doc.filename)
        try:
            for filename in os.listdir(STORAGE_DIR):
                if file_name_norm and file_name_norm in normalize_text(filename):
                    candidates.append(os.path.join(STORAGE_DIR, filename))
        except Exception:
            pass

    seen = set()
    for candidate in candidates:
        if not candidate or candidate in seen:
            continue
        seen.add(candidate)
        try:
            if os.path.exists(candidate):
                return open_docx(candidate)
        except Exception:
            continue

    try:
        return open_docx(filepath)
    except Exception:
        return None


def match_shared_docx_for_student(doc: Document, parsed_doc: Any, student: Student, query_info: Dict[str, Any]) -> Optional[Dict[str, Any]]:
    # Сначала проверяем специальные таблицы, где заголовок — категория, а внутри список студентов.
    category_match = match_query_in_category_tables(parsed_doc, student, query_info)
    if category_match:
        return category_match

    # Потом проверяем обычные строки студента.
    profiles = find_student_row_profiles(parsed_doc, student)
    for profile in profiles:
        row_data = profile.get("row_data") or {}
        match = match_query_in_row(row_data, student, student.group, query_info)
        if match:
            match["table_index"] = profile.get("table_index")
            match["row_index"] = profile.get("row_index")
            return match

    return None


def match_personal_document(doc: Document, student: Student, query_info: Dict[str, Any]) -> Optional[Dict[str, Any]]:
    # Для персонального документа можно искать по тексту, но категорийные запросы должны быть строгими.
    text = doc.text_content or ""
    q = query_info["normalized"]
    if not q:
        return None

    if query_info["mode"] == "category":
        # Не засчитываем слово в заголовке или отрицании.
        category = query_info["category"]
        if category == "orphan":
            if any(x in normalize_text(text) for x in ["сирота да", "сирота имеется", "является сиротой", "без попечения родителей"]):
                return {"score": 80, "source": "personal_text_category", "fragment": make_fragment(text, q)}
            return None
        return None

    normalized_text = normalize_text(text)
    if q in normalized_text:
        return {"score": 70, "source": "personal_text", "fragment": make_fragment(text, q)}

    tokens = [t for t in tokenize(q) if len(t) >= 2]
    if tokens and all(t in normalized_text for t in tokens):
        return {"score": 65, "source": "personal_text_tokens", "fragment": make_fragment(text, tokens[0])}

    return None


def make_fragment(text: str, query: str, radius: int = 90) -> str:
    clean = compact_text(text)
    normalized = normalize_text(clean)
    q = normalize_text(query)
    if not clean:
        return ""
    if not q:
        return clean[:220]

    idx = normalized.find(q)
    if idx == -1:
        return clean[:220]

    start = max(0, idx - radius)
    end = min(len(normalized), idx + len(q) + radius)
    fragment = normalized[start:end].strip()
    if start > 0:
        fragment = "..." + fragment
    if end < len(normalized):
        fragment += "..."
    return fragment


def serialize_student_with_documents(db: Session, student: Student):
    links = db.query(DocumentStudent).filter(DocumentStudent.student_id == student.id).all()

    doc_items = []

    for link in links:
        d = db.query(Document).filter(Document.id == link.document_id).first()
        if not d:
            continue

        ai = db.query(AIResult).filter(AIResult.document_id == d.id).first()

        total_links = db.query(DocumentStudent).filter(
            DocumentStudent.document_id == d.id
        ).count()

        is_shared = total_links > 1

        doc_items.append({
            "doc_id": d.id,
            "filename": d.filename,
            "display_name": d.display_name,
            "effective_name": d.display_name or d.filename,
            "file_type": d.file_type,
            "status": d.status,
            "uploaded_at": str(d.uploaded_at),
            "text_preview": (d.text_content or "")[:400],
            "download_url": f"/documents/download/{d.id}",
            "student_profile_url": f"/documents/{d.id}/student-profile/{student.id}" if d.file_type == "docx" else None,
            "match_source": link.match_source,
            "linked_students_count": total_links,
            "is_shared": is_shared,
            "document_scope": "shared" if is_shared else "personal",
            "ai": {
                "doc_type": ai.doc_type if ai else None,
                "entities_json": ai.entities_json if ai else None,
            }
        })

    course_value = student.group.course if student.group else student.course
    group_name = student.group.name if student.group else None

    return {
        "id": student.id,
        "full_name": student.full_name,
        "group_id": student.group_id,
        "group_name": group_name,
        "course": course_value,
        "email": student.email,
        "documents": doc_items
    }


def user_can_access_group(db: Session, user: User, group: Group) -> bool:
    if user.role in ["admin", "manager"]:
        return True

    if user.role == "teacher":
        allowed_group_ids = get_user_group_ids(db, user.id)
        return group.id in allowed_group_ids

    if user.role == "head":
        allowed_department_ids = get_user_department_ids(db, user)
        return group.department_id in allowed_department_ids

    return False


def add_analytics_match(
    matched_students: Dict[int, dict],
    student: Student,
    doc: Document,
    matched_fragment: str,
    match_source: str,
    score: int = 0,
):
    group = student.group

    if student.id not in matched_students:
        matched_students[student.id] = {
            "student_id": student.id,
            "full_name": student.full_name,
            "group_id": group.id if group else student.group_id,
            "group_name": group.name if group else None,
            "department_id": group.department_id if group else None,
            "department_name": group.department.name if group and group.department else None,
            "score": score,
            "documents": [],
        }
    else:
        matched_students[student.id]["score"] = max(matched_students[student.id].get("score") or 0, score)

    already_has_doc = any(
        item["doc_id"] == doc.id
        for item in matched_students[student.id]["documents"]
    )

    if already_has_doc:
        return

    matched_students[student.id]["documents"].append({
        "doc_id": doc.id,
        "filename": doc.filename,
        "display_name": doc.display_name,
        "effective_name": doc.display_name or doc.filename,
        "file_type": doc.file_type,
        "match_source": match_source,
        "matched_fragment": matched_fragment,
        "student_profile_url": f"/documents/{doc.id}/student-profile/{student.id}" if doc.file_type == "docx" else None,
        "score": score,
    })


@router.get("/analytics/version")
def get_analytics_version():
    return {"analytics_version": ANALYTICS_VERSION}


@router.get("/student")
def search_student(
    group_id: int = Query(..., description="Group ID"),
    q: str = Query("", description="Student name query (optional)"),
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    if user.role not in ["admin", "manager", "head", "teacher"]:
        raise HTTPException(status_code=403, detail="Access denied")

    g = db.query(Group).filter(Group.id == group_id).first()
    if not g:
        raise HTTPException(status_code=404, detail="Group not found")

    if not user_can_access_group(db, user, g):
        raise HTTPException(status_code=403, detail="Access denied for this group")

    query = db.query(Student).filter(Student.group_id == g.id)

    if q.strip():
        query_str = normalize_text(q)
        students = query.order_by(Student.full_name.asc()).all()
        students = [s for s in students if query_str in normalize_text(s.full_name)]
    else:
        students = query.order_by(Student.full_name.asc()).all()

    out_students = [serialize_student_with_documents(db, s) for s in students]

    return {
        "group_id": g.id,
        "group": g.name,
        "group_display_name": g.name,
        "count": len(out_students),
        "students": out_students
    }


@router.get("/analytics")
def search_analytics(
    q: str = Query(..., description="Любой поисковый запрос"),
    department_id: int | None = Query(None, description="Department ID filter"),
    group_id: int | None = Query(None, description="Group ID filter"),
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    if user.role not in ["admin", "manager", "head", "teacher"]:
        raise HTTPException(status_code=403, detail="Access denied")

    if not q.strip():
        raise HTTPException(status_code=400, detail="Query is empty")

    query_info = detect_query(q)
    if not query_info.get("normalized"):
        raise HTTPException(status_code=400, detail="Query is empty")

    matched_students: Dict[int, dict] = {}

    docs = db.query(Document).order_by(Document.id.desc()).all()

    parsed_docx_cache: Dict[int, Any] = {}

    for doc in docs:
        links = db.query(DocumentStudent).filter(DocumentStudent.document_id == doc.id).all()
        if not links:
            continue

        is_shared_document = len(links) > 1

        parsed_doc = None
        if doc.file_type == "docx":
            if doc.id not in parsed_docx_cache:
                parsed_docx_cache[doc.id] = safe_open_docx_document(doc)
            parsed_doc = parsed_docx_cache.get(doc.id)

        for link in links:
            student = db.query(Student).filter(Student.id == link.student_id).first()
            if not student or not student.group:
                continue

            if not user_can_access_group(db, user, student.group):
                continue

            if department_id is not None and student.group.department_id != department_id:
                continue

            if group_id is not None and student.group_id != group_id:
                continue

            match = None

            if is_shared_document:
                # Общие DOCX ищем только структурно: конкретная строка студента или колонка-категория.
                # Никакого поиска по полному тексту общего документа, иначе одно слово засчитывается всем.
                if doc.file_type == "docx" and parsed_doc is not None:
                    match = match_shared_docx_for_student(doc, parsed_doc, student, query_info)
            else:
                # Персональный документ можно проверять по тексту.
                match = match_personal_document(doc, student, query_info)

            if match:
                add_analytics_match(
                    matched_students=matched_students,
                    student=student,
                    doc=doc,
                    matched_fragment=match.get("fragment") or "",
                    match_source=match.get("source") or "structured_match",
                    score=int(match.get("score") or 0),
                )

    students = list(matched_students.values())
    students.sort(key=lambda item: (-(item.get("score") or 0), item.get("group_name") or "", item.get("full_name") or ""))

    return {
        "analytics_version": ANALYTICS_VERSION,
        "query": q,
        "query_mode": query_info.get("mode"),
        "query_category": query_info.get("category"),
        "count": len(students),
        "students": students,
    }


@router.get("/student/by-group-name")
def search_student_by_group_name(
    group: str = Query(..., description="Group name, e.g. РЭД22-1Д"),
    q: str = Query("", description="Student name query (optional)"),
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    if user.role not in ["admin", "manager", "head", "teacher"]:
        raise HTTPException(status_code=403, detail="Access denied")

    group_name = group.strip()
    if not group_name:
        raise HTTPException(status_code=400, detail="Group name is empty")

    g = db.query(Group).filter(Group.name == group_name).first()
    if not g:
        raise HTTPException(status_code=404, detail="Group not found")

    if not user_can_access_group(db, user, g):
        raise HTTPException(status_code=403, detail="Access denied for this group")

    query = db.query(Student).filter(Student.group_id == g.id)

    if q.strip():
        query_str = normalize_text(q)
        students = query.order_by(Student.full_name.asc()).all()
        students = [s for s in students if query_str in normalize_text(s.full_name)]
    else:
        students = query.order_by(Student.full_name.asc()).all()

    out_students = [serialize_student_with_documents(db, s) for s in students]

    return {
        "group_id": g.id,
        "group": g.name,
        "group_display_name": g.name,
        "count": len(out_students),
        "students": out_students
    }

import re
from difflib import SequenceMatcher
from typing import Optional, List, Dict, Any, Tuple

from sqlalchemy.orm import Session

from ..models.models import Group, Student


MATCHER_VERSION = "document_matcher_v2_fio_text_group_safe_2026_06_16"


def normalize_text(value: Optional[str]) -> str:
    if not value:
        return ""

    value = str(value).lower()
    value = value.replace("ё", "е")
    value = value.replace("\u00a0", " ")
    value = value.replace("—", " ")
    value = value.replace("–", " ")
    value = value.replace("-", " ")
    value = value.replace("_", " ")
    value = re.sub(r"[^a-zа-я0-9]+", " ", value)
    value = re.sub(r"\s+", " ", value).strip()
    return value


def normalize_group(value: Optional[str]) -> str:
    value = normalize_text(value)
    value = value.replace(" ", "")
    return value


def compact_digits(value: Optional[str]) -> str:
    return re.sub(r"\D+", "", value or "")


def tokenize(value: Optional[str]) -> List[str]:
    return [t for t in normalize_text(value).split() if t]


def token_variants(token: str) -> set[str]:
    """
    Упрощенная нормализация русских ФИО.
    Нужна, чтобы "Климкова Николая Константиновича" находило
    студента "Климков Николай Константинович".
    """
    token = normalize_text(token)
    if not token:
        return set()

    variants = {token}

    # Климкова -> Климков, Константиновича -> Константинович
    if len(token) > 4 and token.endswith(("а", "я", "ы", "и", "у", "ю", "е", "о")):
        variants.add(token[:-1])

    # Николая -> Николай
    if len(token) > 5 and token.endswith("ая"):
        variants.add(token[:-2] + "ай")

    # Сергея -> Сергей, Андрея -> Андрей
    if len(token) > 5 and token.endswith("ея"):
        variants.add(token[:-2] + "ей")

    # Дмитрия -> Дмитрий
    if len(token) > 5 and token.endswith("ия"):
        variants.add(token[:-2] + "ий")

    # фамилии/отчества в родительном
    endings = [
        "ого", "его", "ому", "ему", "ыми", "ими",
        "ской", "цкой", "ова", "ева", "ина", "ына",
        "ича", "вича", "евича", "овича",
        "ной", "вой", "ской",
    ]

    for ending in endings:
        if len(token) > len(ending) + 3 and token.endswith(ending):
            base = token[:-len(ending)]
            variants.add(base)
            if ending in {"ова", "ева", "ина", "ына"}:
                variants.add(token[:-1])
            if ending in {"ича", "вича", "евича", "овича"}:
                variants.add(token[:-1])

    return {v for v in variants if len(v) >= 2}


def text_token_variant_set(text: Optional[str]) -> set[str]:
    result: set[str] = set()
    for token in tokenize(text):
        result.update(token_variants(token))
    return result


def student_name_parts(student: Student) -> List[str]:
    return tokenize(student.full_name)


def student_name_variant_parts(student: Student) -> List[set[str]]:
    return [token_variants(part) for part in student_name_parts(student)]


def source_text_for_matching(
    fio: Optional[str],
    group_name: Optional[str],
    text_content: Optional[str],
    filename: Optional[str],
) -> str:
    return " ".join(
        part for part in [
            fio or "",
            group_name or "",
            filename or "",
            text_content or "",
        ]
        if part
    )


def group_matches(student: Student, group_name: Optional[str], source_text: str) -> bool:
    if not student.group:
        return False

    student_group = normalize_group(student.group.name)
    requested_group = normalize_group(group_name)
    source_group = normalize_group(source_text)

    if requested_group and student_group == requested_group:
        return True

    if student_group and student_group in source_group:
        return True

    return False


def find_group_by_name(db: Session, group_name: Optional[str]) -> Optional[Group]:
    if not group_name:
        return None

    normalized_group = normalize_group(group_name)
    groups = db.query(Group).all()

    for group in groups:
        if normalize_group(group.name) == normalized_group:
            return group

    return None


def get_candidate_students(db: Session, group_name: Optional[str]) -> List[Student]:
    group = find_group_by_name(db, group_name)

    if group:
        return (
            db.query(Student)
            .filter(Student.group_id == group.id)
            .order_by(Student.full_name.asc())
            .all()
        )

    return db.query(Student).order_by(Student.full_name.asc()).all()


def name_exact_phrase_score(student: Student, normalized_source: str) -> int:
    full = normalize_text(student.full_name)
    if full and full in normalized_source:
        return 120

    parts = student_name_parts(student)
    if len(parts) >= 2:
        surname_name = normalize_text(f"{parts[0]} {parts[1]}")
        if surname_name and surname_name in normalized_source:
            return 105

    return 0


def score_student_against_source(
    student: Student,
    source_text: str,
    group_name: Optional[str],
) -> Tuple[int, str]:
    normalized_source = normalize_text(source_text)
    source_variants = text_token_variant_set(source_text)

    if not normalized_source or not source_variants:
        return 0, "empty_source"

    phrase_score = name_exact_phrase_score(student, normalized_source)

    name_variant_parts = student_name_variant_parts(student)
    if not name_variant_parts:
        return 0, "empty_student_name"

    matched_parts = 0
    matched_labels = []

    for original_token, variants in zip(student_name_parts(student), name_variant_parts):
        if variants.intersection(source_variants):
            matched_parts += 1
            matched_labels.append(original_token)

    total_parts = len(name_variant_parts)
    surname_hit = bool(name_variant_parts[0].intersection(source_variants)) if total_parts >= 1 else False
    name_hit = bool(name_variant_parts[1].intersection(source_variants)) if total_parts >= 2 else False
    patronymic_hit = bool(name_variant_parts[2].intersection(source_variants)) if total_parts >= 3 else False
    has_group = group_matches(student, group_name, source_text)

    score = phrase_score

    if total_parts >= 3 and surname_hit and name_hit and patronymic_hit:
        score = max(score, 115)
    elif total_parts >= 2 and surname_hit and name_hit:
        score = max(score, 95)
    elif surname_hit and has_group:
        score = max(score, 75)
    elif matched_parts >= 2 and has_group:
        score = max(score, 80)

    if has_group and score:
        score += 10

    reason_bits = []
    if matched_labels:
        reason_bits.append("ФИО: " + " ".join(matched_labels))
    if has_group and student.group:
        reason_bits.append("группа: " + student.group.name)

    if not reason_bits:
        reason_bits.append("совпадение не найдено")

    return score, "; ".join(reason_bits)


def similarity(a: str, b: str) -> int:
    a = normalize_text(a)
    b = normalize_text(b)
    if not a or not b:
        return 0
    return int(SequenceMatcher(None, a, b).ratio() * 100)


def find_students_by_ai_data(
    db: Session,
    fio: Optional[str],
    group_name: Optional[str],
    text_content: Optional[str] = None,
    filename: Optional[str] = None,
) -> List[Student]:
    """
    Автопривязка документа к студенту.

    Старое поведение требовало одновременно ФИО и группу.
    Из-за этого отзыв/рецензия с ФИО, но без группы, уходили в unassigned.

    Новая логика:
    1. Берет ФИО от AI, имя файла и полный текст документа.
    2. Сравнивает с ФИО студентов с учетом простых падежей:
       "Климкова Николая Константиновича" -> "Климков Николай Константинович".
    3. Если группа известна — ищет сначала внутри группы.
    4. Если группа неизвестна — ищет по всем студентам, но привязывает только уверенные совпадения.
    5. Если совпадение неоднозначное — не привязывает автоматически.
    """
    source_text = source_text_for_matching(
        fio=fio,
        group_name=group_name,
        text_content=text_content,
        filename=filename,
    )

    if not normalize_text(source_text):
        return []

    candidates = get_candidate_students(db, group_name)

    scored: List[Tuple[int, Student, str]] = []

    for student in candidates:
        score, reason = score_student_against_source(
            student=student,
            source_text=source_text,
            group_name=group_name,
        )
        if score > 0:
            scored.append((score, student, reason))

    if not scored:
        return []

    scored.sort(key=lambda item: item[0], reverse=True)

    best_score = scored[0][0]

    # Если есть группа, можно быть чуть мягче.
    threshold = 75 if group_name else 90

    if best_score < threshold:
        return []

    # Берем только явно лучшие результаты.
    best = [item for item in scored if item[0] >= best_score - 3 and item[0] >= threshold]

    # Если без группы найдено несколько одинаково уверенных студентов,
    # автоматом не привязываем, чтобы не сделать хуже.
    if not group_name and len(best) > 1:
        return []

    return [item[1] for item in best]


def debug_match_students_by_text(
    db: Session,
    fio: Optional[str],
    group_name: Optional[str],
    text_content: Optional[str] = None,
    filename: Optional[str] = None,
) -> List[Dict[str, Any]]:
    """
    Отладочная функция. Можно вызывать из Python/Swagger при необходимости.
    """
    source_text = source_text_for_matching(fio, group_name, text_content, filename)
    candidates = get_candidate_students(db, group_name)
    rows = []

    for student in candidates:
        score, reason = score_student_against_source(student, source_text, group_name)
        if score > 0:
            rows.append({
                "student_id": student.id,
                "full_name": student.full_name,
                "group_name": student.group.name if student.group else None,
                "score": score,
                "reason": reason,
            })

    rows.sort(key=lambda item: item["score"], reverse=True)
    return rows

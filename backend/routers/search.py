import re
from typing import Optional, Set, Dict, Any, List

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
from ..services.docx_student_profile import build_student_profile_from_docx

router = APIRouter(prefix="/search", tags=["Search"])


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
    if not value:
        return ""

    value = str(value).lower()
    value = value.replace("ё", "е")
    value = value.replace("\u00a0", " ")
    value = value.replace("\n", " ")
    value = value.replace("\r", " ")
    value = value.replace("\t", " ")
    value = re.sub(r"[^a-zа-я0-9]+", " ", value)
    value = re.sub(r"\s+", " ", value).strip()
    return value


try:
    from rapidfuzz import fuzz
except Exception:
    fuzz = None


WORD_RE = re.compile(r"[a-zа-я0-9]+")

# Смысловые группы для аналитики.
# Они нужны, чтобы запрос "дети без родителей" находил "сирота",
# а "ограниченные возможности" находил "инвалидность" и т.д.
SEMANTIC_DICTIONARY: Dict[str, List[str]] = {
    "nationality_uigur": [
        "уйгур", "уйгуры", "уйгуров", "уйгурка", "уйгурский", "уйгурская",
        "уйгурская национальность", "национальность уйгур", "uigur", "uyghur",
    ],
    "orphan": [
        "сирота", "сироты", "сирот", "сиротство", "без родителей",
        "без попечения", "без попечения родителей", "оставшийся без попечения",
        "оставшаяся без попечения", "опека", "опекун", "попечитель",
    ],
    "large_family": [
        "многодет", "многодетная", "многодетные", "многодетной",
        "многодетная семья", "из многодетной семьи", "3 и более детей",
        "трое детей", "четверо детей", "пять детей",
    ],
    "disability": [
        "инвалид", "инвалидность", "инвалиды", "лицо с инвалидностью",
        "овз", "ограниченные возможности", "ограниченными возможностями",
        "особые образовательные потребности", "ооп",
    ],
    "dormitory": [
        "общежитие", "общежитии", "проживает в общежитии", "нуждается в общежитии",
        "место в общежитии", "иногородний", "иногородняя",
    ],
    "low_income": [
        "малообеспеч", "малоимущ", "малообеспеченная семья",
        "адресная социальная помощь", "асп", "социальная помощь",
    ],
    "single_parent": [
        "неполная семья", "одинокая мать", "одинокий отец",
        "воспитывается матерью", "воспитывается отцом", "один родитель",
    ],
    "village": [
        "село", "сельский", "сельская", "поселок", "посёлок",
        "аул", "район", "область",
    ],
}


def simple_stem(word: str) -> str:
    word = normalize_text(word)
    if not word:
        return ""

    endings = [
        "иями", "ями", "ами", "ого", "ему", "ыми", "ими",
        "ая", "яя", "ое", "ее", "ые", "ие", "его",
        "ому", "ой", "ей", "ам", "ям", "ах", "ях",
        "ов", "ев", "ом", "ем", "ым", "им", "ую", "юю",
        "а", "я", "ы", "и", "е", "у", "ю", "о",
    ]

    for ending in endings:
        if len(word) > 5 and word.endswith(ending):
            return word[:-len(ending)]

    return word


def tokenize(text: str) -> List[str]:
    return WORD_RE.findall(normalize_text(text))


def build_query_variants(query: str) -> List[str]:
    q = normalize_text(query)
    if not q:
        return []

    variants = {q}
    q_tokens = tokenize(q)
    q_stems = {simple_stem(token) for token in q_tokens if len(token) >= 3}

    for category_phrases in SEMANTIC_DICTIONARY.values():
        normalized_phrases = [normalize_text(phrase) for phrase in category_phrases]

        category_tokens = set()
        category_stems = set()

        for phrase in normalized_phrases:
            category_tokens.update(tokenize(phrase))
            category_stems.update(simple_stem(token) for token in tokenize(phrase) if len(token) >= 3)

        category_hit = False

        if q in normalized_phrases:
            category_hit = True

        if not category_hit and q_tokens:
            category_hit = any(q in phrase or phrase in q for phrase in normalized_phrases)

        if not category_hit and q_stems:
            category_hit = bool(q_stems.intersection(category_stems))

        if category_hit:
            variants.update(normalized_phrases)
            variants.update(category_tokens)
            variants.update(stem for stem in category_stems if len(stem) >= 4)

    for token in q_tokens:
        if len(token) >= 3:
            variants.add(token)
        stem = simple_stem(token)
        if len(stem) >= 4:
            variants.add(stem)

    if len(q) >= 5:
        variants.add(q[:5])

    return sorted(v for v in variants if v and len(v) >= 2)


def make_fragment(text: str, query_variants: List[str], radius: int = 90) -> str:
    normalized_original = text or ""
    normalized_search = normalize_text(normalized_original)

    if not normalized_search:
        return ""

    found_index = -1
    found_variant = ""

    for variant in sorted(query_variants, key=len, reverse=True):
        idx = normalized_search.find(variant)
        if idx != -1:
            found_index = idx
            found_variant = variant
            break

    if found_index == -1:
        return normalized_search[:220].strip()

    start = max(0, found_index - radius)
    end = min(len(normalized_search), found_index + len(found_variant) + radius)

    fragment = normalized_search[start:end].strip()
    if start > 0:
        fragment = "..." + fragment
    if end < len(normalized_search):
        fragment = fragment + "..."

    return fragment


def get_fuzzy_score(query: str, text: str) -> int:
    q = normalize_text(query)
    normalized_text = normalize_text(text)

    if not q or not normalized_text:
        return 0

    q_tokens = tokenize(q)
    text_tokens = tokenize(normalized_text)

    if not q_tokens or not text_tokens:
        return 0

    if fuzz is not None:
        token_scores = []
        for q_token in q_tokens:
            if len(q_token) < 4:
                continue
            best_token_score = max(fuzz.ratio(q_token, t) for t in text_tokens)
            token_scores.append(best_token_score)

        avg_token_score = int(sum(token_scores) / len(token_scores)) if token_scores else 0

        if len(q_tokens) > 1:
            n = min(len(q_tokens) + 1, 6)
            grams = [" ".join(text_tokens[i:i + n]) for i in range(0, max(1, len(text_tokens) - n + 1))]
            phrase_score = max([fuzz.token_set_ratio(q, gram) for gram in grams] or [0])
            return int(max(avg_token_score, phrase_score))

        return avg_token_score

    from difflib import SequenceMatcher

    scores = []
    for q_token in q_tokens:
        if len(q_token) < 4:
            continue
        scores.append(max(int(SequenceMatcher(None, q_token, t).ratio() * 100) for t in text_tokens))

    return int(sum(scores) / len(scores)) if scores else 0


def find_analytics_match(
    text: str,
    query: str,
    query_variants: List[str],
) -> Optional[Dict[str, Any]]:
    normalized_text = normalize_text(text)
    normalized_query = normalize_text(query)

    if not normalized_text or not normalized_query:
        return None

    if normalized_query in normalized_text:
        return {
            "match_type": "exact",
            "score": 100,
            "fragment": make_fragment(text, [normalized_query]),
        }

    for variant in sorted(query_variants, key=len, reverse=True):
        if len(variant) >= 3 and variant in normalized_text:
            return {
                "match_type": "semantic_or_morphology",
                "score": 92,
                "fragment": make_fragment(text, [variant]),
            }

    query_stems = {simple_stem(token) for token in tokenize(normalized_query) if len(token) >= 4}
    text_stems = {simple_stem(token) for token in tokenize(normalized_text) if len(token) >= 4}

    if query_stems and query_stems.issubset(text_stems):
        return {
            "match_type": "stem",
            "score": 88,
            "fragment": make_fragment(text, list(query_stems) or query_variants),
        }

    fuzzy_score = get_fuzzy_score(normalized_query, normalized_text)
    if fuzzy_score >= 84:
        return {
            "match_type": "fuzzy",
            "score": fuzzy_score,
            "fragment": make_fragment(text, query_variants),
        }

    return None


def text_has_query(text: str, query_variants: List[str]) -> bool:
    # Оставлено для совместимости со старой логикой.
    query = query_variants[0] if query_variants else ""
    return find_analytics_match(text, query, query_variants) is not None


def get_profile_search_text(profile: Dict[str, Any]) -> str:
    if not profile:
        return ""

    if not profile.get("found"):
        return ""

    chunks = []

    row_data = profile.get("row_data") or {}
    if isinstance(row_data, dict):
        for key, value in row_data.items():
            chunks.append(str(key))
            chunks.append(str(value))

    headers = profile.get("headers") or []
    if isinstance(headers, list):
        chunks.extend([str(h) for h in headers])

    return " ".join(chunks)


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
            "documents": [],
        }

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
    })


def check_docx_profile_match(
    doc: Document,
    student: Student,
    query: str,
    query_variants: List[str],
) -> Optional[Dict[str, Any]]:
    parsed_doc = open_docx(doc.filepath)
    if not parsed_doc:
        return None

    profile = build_student_profile_from_docx(parsed_doc, student.full_name)
    profile_text = get_profile_search_text(profile)

    return find_analytics_match(profile_text, query, query_variants)


def check_personal_document_match(
    doc: Document,
    query: str,
    query_variants: List[str],
) -> Optional[Dict[str, Any]]:
    text = doc.text_content or ""
    return find_analytics_match(text, query, query_variants)


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
        query_str = q.strip().lower()
        students = query.order_by(Student.full_name.asc()).all()
        students = [s for s in students if query_str in s.full_name.lower()]
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

    query_variants = build_query_variants(q)

    if not query_variants:
        raise HTTPException(status_code=400, detail="Query is empty")

    matched_students: Dict[int, dict] = {}

    docs = db.query(Document).order_by(Document.id.desc()).all()

    for doc in docs:
        links = db.query(DocumentStudent).filter(
            DocumentStudent.document_id == doc.id
        ).all()

        if not links:
            continue

        is_shared_document = len(links) > 1

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

            matched_fragment = None
            match_source = "unknown"

            if is_shared_document:
                # ВАЖНО:
                # Для общих документов запрещаем поиск по всему тексту и запрещаем fallback рядом с ФИО.
                # Иначе одно совпадение из общей таблицы засчитывается всем студентам.
                # Общий DOCX засчитывается только если запрос найден в конкретной строке/профиле студента.
                if doc.file_type == "docx":
                    match = check_docx_profile_match(
                        doc=doc,
                        student=student,
                        query=q,
                        query_variants=query_variants,
                    )

                    if match:
                        matched_fragment = match["fragment"]
                        match_source = f"docx_student_row_{match['match_type']}_{match['score']}"

                # Для общих PDF/TXT пока не засчитываем аналитику автоматически,
                # потому что без структуры строки студента легко получить ложную статистику.
            else:
                match = check_personal_document_match(
                    doc=doc,
                    query=q,
                    query_variants=query_variants,
                )

                if match:
                    matched_fragment = match["fragment"]
                    match_source = f"personal_document_{match['match_type']}_{match['score']}"

            if matched_fragment:
                add_analytics_match(
                    matched_students=matched_students,
                    student=student,
                    doc=doc,
                    matched_fragment=matched_fragment,
                    match_source=match_source,
                )

    students = list(matched_students.values())
    students.sort(key=lambda item: (item.get("group_name") or "", item.get("full_name") or ""))

    return {
        "query": q,
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
        query_str = q.strip().lower()
        students = query.order_by(Student.full_name.asc()).all()
        students = [s for s in students if query_str in s.full_name.lower()]
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

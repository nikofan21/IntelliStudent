from typing import Optional, List
from sqlalchemy.orm import Session

from ..models.models import Group, Student


def normalize_text(value: Optional[str]) -> str:
    return " ".join((value or "").strip().lower().split())


def normalize_group(value: Optional[str]) -> str:
    value = normalize_text(value)
    value = value.replace("—", "-").replace("–", "-").replace("_", "-")
    value = value.replace("/", "-")
    value = value.replace(" ", "")
    return value


def find_group_by_name(db: Session, group_name: Optional[str]) -> Optional[Group]:
    if not group_name:
        return None

    normalized_group = normalize_group(group_name)
    groups = db.query(Group).all()
    return next((g for g in groups if normalize_group(g.name) == normalized_group), None)


def find_students_by_ai_data(db: Session, fio: Optional[str], group_name: Optional[str]) -> List[Student]:
    if not fio or not group_name:
        return []

    group = find_group_by_name(db, group_name)
    if not group:
        return []

    normalized_fio = normalize_text(fio)
    candidates = db.query(Student).filter(Student.group_id == group.id).all()

    exact = [s for s in candidates if normalize_text(s.full_name) == normalized_fio]
    if exact:
        return exact

    partial = [
        s for s in candidates
        if normalized_fio in normalize_text(s.full_name) or normalize_text(s.full_name) in normalized_fio
    ]
    return partial
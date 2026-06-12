from typing import Optional, Set

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, EmailStr
from sqlalchemy.orm import Session

from ..database import SessionLocal
from ..models.models import Student, Group, User, UserGroup
from ..auth.security import get_current_user, get_user_department_ids

router = APIRouter(prefix="/students", tags=["Students"])


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


class StudentCreate(BaseModel):
    full_name: str
    group_id: int
    email: EmailStr


class StudentUpdate(BaseModel):
    full_name: str
    group_id: int
    email: EmailStr


def get_user_group_ids(db: Session, user_id: int) -> Set[int]:
    links = db.query(UserGroup).filter(UserGroup.user_id == user_id).all()
    return {link.group_id for link in links}


def check_group_access(user: User, group: Group, allowed_group_ids: Set[int], allowed_department_ids: Set[int]):
    if user.role in ["admin", "manager"]:
        return

    if user.role == "head":
        if group.department_id in allowed_department_ids:
            return
        raise HTTPException(status_code=403, detail="Access denied for this department")

    if user.role == "teacher":
        if group.id in allowed_group_ids:
            return
        raise HTTPException(status_code=403, detail="Access denied for this group")

    raise HTTPException(status_code=403, detail="Access denied")


def check_student_access(user: User, student: Student, allowed_group_ids: Set[int], allowed_department_ids: Set[int]):
    if not student.group:
        raise HTTPException(status_code=500, detail="Student group not loaded")

    check_group_access(user, student.group, allowed_group_ids, allowed_department_ids)


def serialize_student(student: Student):
    group_name = student.group.name if student.group else None
    course = student.group.course if student.group else student.course

    return {
        "id": student.id,
        "full_name": student.full_name,
        "group_id": student.group_id,
        "group_name": group_name,
        "course": course,
        "email": student.email,
        "created_at": student.created_at,
    }


@router.post("/")
def create_student(
    payload: StudentCreate,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    if user.role not in ["admin", "manager", "head", "teacher"]:
        raise HTTPException(status_code=403, detail="Access denied")

    group = db.query(Group).filter(Group.id == payload.group_id).first()
    if not group:
        raise HTTPException(status_code=404, detail="Group not found")

    if not group.is_active:
        raise HTTPException(status_code=400, detail="Нельзя добавить студента в неактивную группу")

    allowed_group_ids = get_user_group_ids(db, user.id)
    allowed_department_ids = get_user_department_ids(db, user)

    check_group_access(user, group, allowed_group_ids, allowed_department_ids)

    full_name = payload.full_name.strip()
    if not full_name:
        raise HTTPException(status_code=400, detail="Full name is empty")

    student = Student(
        full_name=full_name,
        group_id=payload.group_id,
        course=group.course,
        email=str(payload.email),
    )

    db.add(student)
    db.commit()
    db.refresh(student)

    return serialize_student(student)


@router.get("/")
def list_students(
    group_id: Optional[int] = Query(None),
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    if user.role not in ["admin", "manager", "head", "teacher"]:
        raise HTTPException(status_code=403, detail="Access denied")

    query = db.query(Student)

    allowed_group_ids = get_user_group_ids(db, user.id)
    allowed_department_ids = get_user_department_ids(db, user)

    if user.role == "teacher":
        if not allowed_group_ids:
            return []
        query = query.filter(Student.group_id.in_(allowed_group_ids))

    if user.role == "head":
        if not allowed_department_ids:
            return []
        query = query.join(Group).filter(Group.department_id.in_(allowed_department_ids))

    if group_id is not None:
        group = db.query(Group).filter(Group.id == group_id).first()
        if not group:
            raise HTTPException(status_code=404, detail="Group not found")

        check_group_access(user, group, allowed_group_ids, allowed_department_ids)
        query = query.filter(Student.group_id == group_id)

    students = query.order_by(Student.id.desc()).all()
    return [serialize_student(student) for student in students]


@router.get("/{student_id}")
def get_student(
    student_id: int,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    if user.role not in ["admin", "manager", "head", "teacher"]:
        raise HTTPException(status_code=403, detail="Access denied")

    student = db.query(Student).filter(Student.id == student_id).first()
    if not student:
        raise HTTPException(status_code=404, detail="Student not found")

    allowed_group_ids = get_user_group_ids(db, user.id)
    allowed_department_ids = get_user_department_ids(db, user)

    check_student_access(user, student, allowed_group_ids, allowed_department_ids)

    return serialize_student(student)


@router.put("/{student_id}")
def update_student(
    student_id: int,
    payload: StudentUpdate,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    if user.role not in ["admin", "manager", "head", "teacher"]:
        raise HTTPException(status_code=403, detail="Access denied")

    student = db.query(Student).filter(Student.id == student_id).first()
    if not student:
        raise HTTPException(status_code=404, detail="Student not found")

    group = db.query(Group).filter(Group.id == payload.group_id).first()
    if not group:
        raise HTTPException(status_code=404, detail="Group not found")

    if not group.is_active:
        raise HTTPException(status_code=400, detail="Нельзя перевести студента в неактивную группу")

    allowed_group_ids = get_user_group_ids(db, user.id)
    allowed_department_ids = get_user_department_ids(db, user)

    check_student_access(user, student, allowed_group_ids, allowed_department_ids)
    check_group_access(user, group, allowed_group_ids, allowed_department_ids)

    full_name = payload.full_name.strip()
    if not full_name:
        raise HTTPException(status_code=400, detail="Full name is empty")

    student.full_name = full_name
    student.group_id = payload.group_id
    student.course = group.course
    student.email = str(payload.email)

    db.commit()
    db.refresh(student)

    return serialize_student(student)


@router.delete("/{student_id}")
def delete_student(
    student_id: int,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    if user.role not in ["admin", "manager", "head", "teacher"]:
        raise HTTPException(status_code=403, detail="Access denied")

    student = db.query(Student).filter(Student.id == student_id).first()
    if not student:
        raise HTTPException(status_code=404, detail="Student not found")

    allowed_group_ids = get_user_group_ids(db, user.id)
    allowed_department_ids = get_user_department_ids(db, user)

    check_student_access(user, student, allowed_group_ids, allowed_department_ids)

    db.delete(student)
    db.commit()

    return {
        "message": "Student deleted",
        "student_id": student_id,
    }
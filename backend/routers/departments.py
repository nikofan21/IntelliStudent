from typing import List

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

from ..database import SessionLocal
from ..models.models import Department, Group, User, UserDepartment
from ..auth.security import get_current_user

router = APIRouter(prefix="/departments", tags=["Departments"])


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


# ===== SCHEMAS =====

class DepartmentCreate(BaseModel):
    name: str
    description: str | None = None


class DepartmentUpdate(BaseModel):
    name: str
    description: str | None = None
    is_active: bool


class AssignDepartments(BaseModel):
    department_ids: List[int]


class AssignGroupsToDepartment(BaseModel):
    group_ids: List[int]


class AssignGroupDepartment(BaseModel):
    department_id: int | None = None


# ===== HELPERS =====

def ensure_department_manager(user: User):
    if user.role not in ["admin", "manager"]:
        raise HTTPException(status_code=403, detail="Only admin or manager")


def get_head_department_ids(db: Session, user: User) -> list[int]:
    links = db.query(UserDepartment).filter(UserDepartment.user_id == user.id).all()
    return [link.department_id for link in links]


def serialize_group_short(group: Group):
    return {
        "id": group.id,
        "name": group.name,
        "display_name": group.name,
        "department_id": group.department_id,
        "department_name": group.department.name if group.department else None,
        "is_active": group.is_active,
    }


def serialize_department(dep: Department, include_groups: bool = True):
    groups = []
    if include_groups:
        groups = [
            serialize_group_short(group)
            for group in sorted(dep.groups or [], key=lambda g: (not g.is_active, g.name or ""))
        ]

    return {
        "id": dep.id,
        "name": dep.name,
        "description": dep.description,
        "is_active": dep.is_active,
        "created_at": dep.created_at,
        "groups_count": len(dep.groups or []),
        "groups": groups,
    }


# ===== CRUD =====

@router.post("/")
def create_department(
    payload: DepartmentCreate,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    ensure_department_manager(user)

    name = payload.name.strip()
    if not name:
        raise HTTPException(status_code=400, detail="Name is empty")

    existing = db.query(Department).filter(Department.name == name).first()
    if existing:
        raise HTTPException(status_code=400, detail="Department already exists")

    dep = Department(
        name=name,
        description=payload.description,
        is_active=True,
    )

    db.add(dep)
    db.commit()
    db.refresh(dep)

    return serialize_department(dep)


@router.get("/")
def list_departments(
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    if user.role not in ["admin", "manager", "head", "teacher"]:
        raise HTTPException(status_code=403, detail="Access denied")

    query = db.query(Department)

    if user.role == "head":
        ids = get_head_department_ids(db, user)
        if not ids:
            return []
        query = query.filter(Department.id.in_(ids))

    departments = query.order_by(Department.name.asc()).all()
    return [serialize_department(d) for d in departments]


@router.get("/{department_id}/groups")
def get_department_groups(
    department_id: int,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    if user.role not in ["admin", "manager", "head"]:
        raise HTTPException(status_code=403, detail="Access denied")

    dep = db.query(Department).filter(Department.id == department_id).first()
    if not dep:
        raise HTTPException(status_code=404, detail="Department not found")

    if user.role == "head":
        ids = get_head_department_ids(db, user)
        if department_id not in ids:
            raise HTTPException(status_code=403, detail="Access denied")

    groups = db.query(Group).filter(Group.department_id == department_id).order_by(Group.name.asc()).all()

    return {
        "department": serialize_department(dep, include_groups=False),
        "groups": [serialize_group_short(group) for group in groups],
    }


@router.patch("/{department_id}/groups")
def assign_groups_to_department(
    department_id: int,
    payload: AssignGroupsToDepartment,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    ensure_department_manager(user)

    dep = db.query(Department).filter(Department.id == department_id).first()
    if not dep:
        raise HTTPException(status_code=404, detail="Department not found")

    group_ids = sorted(set(payload.group_ids or []))

    if group_ids:
        found_groups = db.query(Group).filter(Group.id.in_(group_ids)).all()
        found_ids = {group.id for group in found_groups}
        missing = [group_id for group_id in group_ids if group_id not in found_ids]

        if missing:
            raise HTTPException(
                status_code=404,
                detail=f"Groups not found: {missing}",
            )

    # Снимаем с отделения те группы, которые убрали в интерфейсе.
    db.query(Group).filter(
        Group.department_id == department_id,
        ~Group.id.in_(group_ids) if group_ids else True,
    ).update({Group.department_id: None}, synchronize_session=False)

    # Назначаем выбранные группы этому отделению.
    if group_ids:
        db.query(Group).filter(Group.id.in_(group_ids)).update(
            {Group.department_id: department_id},
            synchronize_session=False,
        )

    db.commit()
    db.refresh(dep)

    groups = db.query(Group).filter(Group.department_id == department_id).order_by(Group.name.asc()).all()

    return {
        "message": "Groups assigned to department",
        "department": serialize_department(dep, include_groups=False),
        "group_ids": [group.id for group in groups],
        "groups": [serialize_group_short(group) for group in groups],
    }


@router.patch("/groups/{group_id}/department")
def assign_single_group_to_department(
    group_id: int,
    payload: AssignGroupDepartment,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    ensure_department_manager(user)

    group = db.query(Group).filter(Group.id == group_id).first()
    if not group:
        raise HTTPException(status_code=404, detail="Group not found")

    if payload.department_id is not None:
        dep = db.query(Department).filter(Department.id == payload.department_id).first()
        if not dep:
            raise HTTPException(status_code=404, detail="Department not found")

    group.department_id = payload.department_id
    db.commit()
    db.refresh(group)

    return {
        "message": "Group department updated",
        "group": serialize_group_short(group),
    }


@router.get("/{department_id}")
def get_department(
    department_id: int,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    dep = db.query(Department).filter(Department.id == department_id).first()
    if not dep:
        raise HTTPException(status_code=404, detail="Department not found")

    if user.role == "head":
        ids = get_head_department_ids(db, user)
        if department_id not in ids:
            raise HTTPException(status_code=403, detail="Access denied")

    return serialize_department(dep)


@router.put("/{department_id}")
def update_department(
    department_id: int,
    payload: DepartmentUpdate,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    ensure_department_manager(user)

    dep = db.query(Department).filter(Department.id == department_id).first()
    if not dep:
        raise HTTPException(status_code=404, detail="Department not found")

    name = payload.name.strip()
    if not name:
        raise HTTPException(status_code=400, detail="Name is empty")

    duplicate = db.query(Department).filter(
        Department.id != department_id,
        Department.name == name
    ).first()

    if duplicate:
        raise HTTPException(status_code=400, detail="Name already exists")

    dep.name = name
    dep.description = payload.description
    dep.is_active = payload.is_active

    db.commit()
    db.refresh(dep)

    return serialize_department(dep)


@router.delete("/{department_id}")
def delete_department(
    department_id: int,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    if user.role != "admin":
        raise HTTPException(status_code=403, detail="Only admin")

    dep = db.query(Department).filter(Department.id == department_id).first()
    if not dep:
        raise HTTPException(status_code=404, detail="Department not found")

    # Чтобы удаление отделения не ломалось из-за групп, сначала снимаем привязку.
    db.query(Group).filter(Group.department_id == department_id).update(
        {Group.department_id: None},
        synchronize_session=False,
    )

    db.delete(dep)
    db.commit()

    return {
        "message": "Department deleted",
        "department_id": department_id
    }


# ===== ASSIGN HEAD TO DEPARTMENTS =====

@router.post("/assign/{user_id}")
def assign_departments_to_user(
    user_id: int,
    payload: AssignDepartments,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    ensure_department_manager(user)

    target_user = db.query(User).filter(User.id == user_id).first()
    if not target_user:
        raise HTTPException(status_code=404, detail="User not found")

    db.query(UserDepartment).filter(UserDepartment.user_id == user_id).delete()

    department_ids = sorted(set(payload.department_ids or []))

    for dep_id in department_ids:
        dep = db.query(Department).filter(Department.id == dep_id).first()
        if not dep:
            raise HTTPException(status_code=404, detail=f"Department {dep_id} not found")

        db.add(UserDepartment(user_id=user_id, department_id=dep_id))

    db.commit()

    return {
        "message": "Departments assigned",
        "user_id": user_id,
        "department_ids": department_ids
    }

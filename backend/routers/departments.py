from typing import List

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

from ..database import SessionLocal
from ..models.models import Department, User, UserDepartment
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


# ===== SERIALIZER =====

def serialize_department(dep: Department):
    return {
        "id": dep.id,
        "name": dep.name,
        "description": dep.description,
        "is_active": dep.is_active,
        "created_at": dep.created_at,
    }


# ===== CRUD =====

@router.post("/")
def create_department(
    payload: DepartmentCreate,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    if user.role not in ["admin", "manager"]:
        raise HTTPException(status_code=403, detail="Only admin or manager can create departments")

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
        links = db.query(UserDepartment).filter(UserDepartment.user_id == user.id).all()
        ids = [l.department_id for l in links]

        if not ids:
            return []

        query = query.filter(Department.id.in_(ids))

    departments = query.order_by(Department.name.asc()).all()
    return [serialize_department(d) for d in departments]


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
        links = db.query(UserDepartment).filter(
            UserDepartment.user_id == user.id,
            UserDepartment.department_id == department_id
        ).first()

        if not links:
            raise HTTPException(status_code=403, detail="Access denied")

    return serialize_department(dep)


@router.put("/{department_id}")
def update_department(
    department_id: int,
    payload: DepartmentUpdate,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    if user.role not in ["admin", "manager"]:
        raise HTTPException(status_code=403, detail="Only admin or manager")

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
    if user.role not in ["admin", "manager"]:
        raise HTTPException(status_code=403, detail="Only admin or manager")

    target_user = db.query(User).filter(User.id == user_id).first()
    if not target_user:
        raise HTTPException(status_code=404, detail="User not found")

    # удаляем старые связи
    db.query(UserDepartment).filter(UserDepartment.user_id == user_id).delete()

    # добавляем новые
    for dep_id in payload.department_ids:
        dep = db.query(Department).filter(Department.id == dep_id).first()
        if not dep:
            raise HTTPException(status_code=404, detail=f"Department {dep_id} not found")

        link = UserDepartment(
            user_id=user_id,
            department_id=dep_id
        )
        db.add(link)

    db.commit()

    return {
        "message": "Departments assigned",
        "user_id": user_id,
        "department_ids": payload.department_ids
    }
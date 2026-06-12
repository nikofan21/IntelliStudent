from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session
from fastapi.security import OAuth2PasswordRequestForm
from pydantic import BaseModel, Field

from ..database import SessionLocal
from ..models.models import User, Group, UserGroup, Department, UserDepartment
from ..auth.security import (
    get_password_hash,
    verify_password,
    create_access_token,
    get_current_user,
    require_role,
)

router = APIRouter(prefix="/auth", tags=["Auth"])

ALLOWED_ROLES = {"admin", "teacher", "head"}


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


class RegisterRequest(BaseModel):
    login: str = Field(..., min_length=3, max_length=64)
    password: str = Field(..., min_length=4, max_length=128)
    role: str = Field(..., min_length=4, max_length=32)
    group_ids: List[int] = []
    department_ids: List[int] = []


class UpdateUserRequest(BaseModel):
    login: str = Field(..., min_length=3, max_length=64)
    role: str = Field(..., min_length=4, max_length=32)
    password: Optional[str] = Field(default=None, min_length=4, max_length=128)
    group_ids: List[int] = []
    department_ids: List[int] = []


def normalize_role(role: str) -> str:
    return role.strip().lower()


def get_group_ids_for_user(db: Session, user_id: int) -> List[int]:
    links = db.query(UserGroup).filter(UserGroup.user_id == user_id).all()
    return [link.group_id for link in links]


def get_department_ids_for_user(db: Session, user_id: int) -> List[int]:
    links = db.query(UserDepartment).filter(UserDepartment.user_id == user_id).all()
    return [link.department_id for link in links]


def validate_group_ids(db: Session, group_ids: List[int]) -> List[int]:
    unique_ids = sorted(set(group_ids))
    if not unique_ids:
        return []

    existing_groups = db.query(Group).filter(Group.id.in_(unique_ids)).all()
    existing_ids = {group.id for group in existing_groups}

    missing = [gid for gid in unique_ids if gid not in existing_ids]
    if missing:
        raise HTTPException(
            status_code=400,
            detail=f"Groups not found: {missing}",
        )

    return unique_ids


def validate_department_ids(db: Session, department_ids: List[int]) -> List[int]:
    unique_ids = sorted(set(department_ids))
    if not unique_ids:
        return []

    existing_departments = db.query(Department).filter(Department.id.in_(unique_ids)).all()
    existing_ids = {department.id for department in existing_departments}

    missing = [did for did in unique_ids if did not in existing_ids]
    if missing:
        raise HTTPException(
            status_code=400,
            detail=f"Departments not found: {missing}",
        )

    return unique_ids


def replace_user_groups(db: Session, user_id: int, group_ids: List[int]) -> None:
    db.query(UserGroup).filter(UserGroup.user_id == user_id).delete()

    for gid in group_ids:
        db.add(UserGroup(user_id=user_id, group_id=gid))


def replace_user_departments(db: Session, user_id: int, department_ids: List[int]) -> None:
    db.query(UserDepartment).filter(UserDepartment.user_id == user_id).delete()

    for did in department_ids:
        db.add(UserDepartment(user_id=user_id, department_id=did))


def get_groups_for_user(db: Session, group_ids: List[int]):
    if not group_ids:
        return []

    group_rows = db.query(Group).filter(Group.id.in_(group_ids)).all()
    return [{"id": g.id, "name": g.name} for g in group_rows]


def get_departments_for_user(db: Session, department_ids: List[int]):
    if not department_ids:
        return []

    department_rows = db.query(Department).filter(Department.id.in_(department_ids)).all()
    return [{"id": d.id, "name": d.name} for d in department_rows]


@router.post("/register")
def register(
    payload: RegisterRequest,
    db: Session = Depends(get_db),
    admin_user: User = Depends(require_role("admin")),
):
    login = payload.login.strip()
    password = payload.password
    role = normalize_role(payload.role)

    group_ids = validate_group_ids(db, payload.group_ids)
    department_ids = validate_department_ids(db, payload.department_ids)

    if not login:
        raise HTTPException(status_code=400, detail="Login cannot be empty")

    if role not in ALLOWED_ROLES:
        raise HTTPException(
            status_code=400,
            detail=f"Invalid role. Allowed roles: {', '.join(sorted(ALLOWED_ROLES))}"
        )

    if role == "teacher" and not group_ids:
        raise HTTPException(
            status_code=400,
            detail="Teacher must have at least one assigned group"
        )

    if role == "head" and not department_ids:
        raise HTTPException(
            status_code=400,
            detail="Head must have at least one assigned department"
        )

    existing_user = db.query(User).filter(User.login == login).first()
    if existing_user:
        raise HTTPException(status_code=400, detail="User already exists")

    user = User(
        login=login,
        password_hash=get_password_hash(password),
        role=role,
    )

    db.add(user)
    db.commit()
    db.refresh(user)

    if role == "teacher":
        replace_user_groups(db, user.id, group_ids)
        replace_user_departments(db, user.id, [])

    elif role == "head":
        replace_user_groups(db, user.id, [])
        replace_user_departments(db, user.id, department_ids)

    else:
        replace_user_groups(db, user.id, [])
        replace_user_departments(db, user.id, [])

    db.commit()

    return {
        "message": "User created",
        "id": user.id,
        "login": user.login,
        "role": user.role,
        "group_ids": get_group_ids_for_user(db, user.id),
        "groups": get_groups_for_user(db, get_group_ids_for_user(db, user.id)),
        "department_ids": get_department_ids_for_user(db, user.id),
        "departments": get_departments_for_user(db, get_department_ids_for_user(db, user.id)),
        "created_by": admin_user.login,
    }


@router.get("/users")
def list_users(
    db: Session = Depends(get_db),
    admin_user: User = Depends(require_role("admin")),
):
    users = db.query(User).order_by(User.id.desc()).all()

    result = []
    for user in users:
        group_ids = get_group_ids_for_user(db, user.id)
        department_ids = get_department_ids_for_user(db, user.id)

        result.append({
            "id": user.id,
            "login": user.login,
            "role": user.role,
            "group_ids": group_ids,
            "groups": get_groups_for_user(db, group_ids),
            "department_ids": department_ids,
            "departments": get_departments_for_user(db, department_ids),
            "created_at": str(user.created_at) if user.created_at else None,
        })

    return result


@router.put("/users/{user_id}")
def update_user(
    user_id: int,
    payload: UpdateUserRequest,
    db: Session = Depends(get_db),
    admin_user: User = Depends(require_role("admin")),
):
    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")

    login = payload.login.strip()
    role = normalize_role(payload.role)

    group_ids = validate_group_ids(db, payload.group_ids)
    department_ids = validate_department_ids(db, payload.department_ids)

    if not login:
        raise HTTPException(status_code=400, detail="Login cannot be empty")

    if role not in ALLOWED_ROLES:
        raise HTTPException(
            status_code=400,
            detail=f"Invalid role. Allowed roles: {', '.join(sorted(ALLOWED_ROLES))}"
        )

    if role == "teacher" and not group_ids:
        raise HTTPException(
            status_code=400,
            detail="Teacher must have at least one assigned group"
        )

    if role == "head" and not department_ids:
        raise HTTPException(
            status_code=400,
            detail="Head must have at least one assigned department"
        )

    existing_user = db.query(User).filter(User.login == login, User.id != user_id).first()
    if existing_user:
        raise HTTPException(status_code=400, detail="Login already in use")

    user.login = login
    user.role = role

    if payload.password:
        user.password_hash = get_password_hash(payload.password)

    db.commit()
    db.refresh(user)

    if role == "teacher":
        replace_user_groups(db, user.id, group_ids)
        replace_user_departments(db, user.id, [])

    elif role == "head":
        replace_user_groups(db, user.id, [])
        replace_user_departments(db, user.id, department_ids)

    else:
        replace_user_groups(db, user.id, [])
        replace_user_departments(db, user.id, [])

    db.commit()

    return {
        "message": "User updated",
        "id": user.id,
        "login": user.login,
        "role": user.role,
        "group_ids": get_group_ids_for_user(db, user.id),
        "groups": get_groups_for_user(db, get_group_ids_for_user(db, user.id)),
        "department_ids": get_department_ids_for_user(db, user.id),
        "departments": get_departments_for_user(db, get_department_ids_for_user(db, user.id)),
        "updated_by": admin_user.login,
    }


@router.delete("/users/{user_id}")
def delete_user(
    user_id: int,
    db: Session = Depends(get_db),
    admin_user: User = Depends(require_role("admin")),
):
    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")

    if user.id == admin_user.id:
        raise HTTPException(status_code=400, detail="You cannot delete yourself")

    db.query(UserGroup).filter(UserGroup.user_id == user.id).delete()
    db.query(UserDepartment).filter(UserDepartment.user_id == user.id).delete()

    db.delete(user)
    db.commit()

    return {
        "message": "User deleted",
        "user_id": user_id,
    }


@router.post("/login")
def login(
    form_data: OAuth2PasswordRequestForm = Depends(),
    db: Session = Depends(get_db),
):
    login = form_data.username.strip()
    password = form_data.password

    user = db.query(User).filter(User.login == login).first()

    if not user or not verify_password(password, user.password_hash):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Incorrect login or password",
            headers={"WWW-Authenticate": "Bearer"},
        )

    access_token = create_access_token({"sub": str(user.id)})

    group_ids = get_group_ids_for_user(db, user.id)
    department_ids = get_department_ids_for_user(db, user.id)

    return {
        "access_token": access_token,
        "token_type": "bearer",
        "role": user.role,
        "login": user.login,
        "group_ids": group_ids,
        "groups": get_groups_for_user(db, group_ids),
        "department_ids": department_ids,
        "departments": get_departments_for_user(db, department_ids),
    }


@router.get("/me")
def me(user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    group_ids = get_group_ids_for_user(db, user.id)
    department_ids = get_department_ids_for_user(db, user.id)

    return {
        "id": user.id,
        "login": user.login,
        "role": user.role,
        "group_ids": group_ids,
        "groups": get_groups_for_user(db, group_ids),
        "department_ids": department_ids,
        "departments": get_departments_for_user(db, department_ids),
    }
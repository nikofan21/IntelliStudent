from typing import Set

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy.orm import Session

from ..database import SessionLocal
from ..models.models import Group, User, UserGroup, UserDepartment, Student, Department
from ..auth.security import get_current_user
from ..schemas.group import GroupCreate, GroupUpdate

router = APIRouter(prefix="/groups", tags=["Groups"])


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


class GroupPromoteMany(BaseModel):
    group_ids: list[int]


def get_user_group_ids(db: Session, user: User) -> Set[int]:
    links = db.query(UserGroup).filter(UserGroup.user_id == user.id).all()
    return {link.group_id for link in links}


def get_user_department_ids(db: Session, user: User) -> Set[int]:
    links = db.query(UserDepartment).filter(UserDepartment.user_id == user.id).all()
    return {link.department_id for link in links}


def check_group_access(db: Session, user: User, group: Group) -> None:
    if user.role in ["admin", "manager"]:
        return

    if user.role == "head":
        allowed_department_ids = get_user_department_ids(db, user)
        if group.department_id in allowed_department_ids:
            return
        raise HTTPException(status_code=403, detail="Нет доступа к группе этого отделения")

    if user.role == "teacher":
        allowed_group_ids = get_user_group_ids(db, user)
        if group.id in allowed_group_ids:
            return
        raise HTTPException(status_code=403, detail="Нет доступа к этой группе")

    raise HTTPException(status_code=403, detail="Access denied")


def resolve_department_id_for_group_create(
    db: Session,
    user: User,
    payload_department_id: int | None,
) -> int | None:
    if user.role in ["admin", "manager"]:
        if payload_department_id is None:
            return None

        department = db.query(Department).filter(Department.id == payload_department_id).first()
        if not department:
            raise HTTPException(status_code=404, detail="Отделение не найдено")

        return payload_department_id

    if user.role == "head":
        department_ids = sorted(get_user_department_ids(db, user))

        if not department_ids:
            raise HTTPException(
                status_code=400,
                detail="За заведующим не закреплено отделение",
            )

        if payload_department_id is not None:
            if payload_department_id not in department_ids:
                raise HTTPException(
                    status_code=403,
                    detail="Нельзя создать группу в чужом отделении",
                )
            return payload_department_id

        if len(department_ids) > 1:
            raise HTTPException(
                status_code=400,
                detail="У заведующего несколько отделений. Укажите department_id",
            )

        return department_ids[0]

    raise HTTPException(status_code=403, detail="Access denied")


def build_group_name(
    prefix: str,
    admission_year: int,
    course: int,
    suffix: str | None = "",
) -> str:
    year = str(admission_year)[-2:]
    suffix = (suffix or "").strip().upper()
    return f"{prefix}{year}-{course}{suffix}"


def normalize_group_data(
    prefix: str,
    admission_year: int,
    course: int,
    suffix: str | None,
    is_active: bool,
):
    prefix = (prefix or "").strip().upper()
    suffix = (suffix or "").strip().upper()

    if not prefix:
        raise HTTPException(status_code=400, detail="Prefix is empty")

    if admission_year < 2000 or admission_year > 2100:
        raise HTTPException(status_code=400, detail="Admission year is invalid")

    if course < 1 or course > 10:
        raise HTTPException(status_code=400, detail="Course is invalid")

    name = build_group_name(
        prefix=prefix,
        admission_year=admission_year,
        course=course,
        suffix=suffix,
    )

    return {
        "prefix": prefix,
        "admission_year": int(admission_year),
        "course": int(course),
        "suffix": suffix,
        "is_active": bool(is_active),
        "name": name,
    }


def serialize_group(group: Group):
    return {
        "id": group.id,
        "prefix": group.prefix,
        "admission_year": group.admission_year,
        "course": group.course,
        "suffix": group.suffix or "",
        "name": group.name,
        "display_name": group.name,
        "department_id": group.department_id,
        "department_name": group.department.name if group.department else None,
        "is_active": group.is_active,
        "created_at": group.created_at,
    }


@router.post("/")
def create_group(
    payload: GroupCreate,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    if user.role not in ["admin", "manager", "head"]:
        raise HTTPException(
            status_code=403,
            detail="Только admin, manager или head могут создавать группы",
        )

    data = normalize_group_data(
        prefix=payload.prefix,
        admission_year=payload.admission_year,
        course=payload.course,
        suffix=payload.suffix,
        is_active=payload.is_active,
    )

    department_id = resolve_department_id_for_group_create(
        db=db,
        user=user,
        payload_department_id=payload.department_id,
    )

    existing = db.query(Group).filter(
        Group.prefix == data["prefix"],
        Group.admission_year == data["admission_year"],
        Group.course == data["course"],
        Group.suffix == data["suffix"],
    ).first()

    if existing:
        raise HTTPException(status_code=400, detail="Такая группа уже существует")

    existing_name = db.query(Group).filter(Group.name == data["name"]).first()
    if existing_name:
        raise HTTPException(status_code=400, detail="Группа с таким именем уже существует")

    group = Group(
        name=data["name"],
        prefix=data["prefix"],
        admission_year=data["admission_year"],
        course=data["course"],
        suffix=data["suffix"],
        is_active=data["is_active"],
        department_id=department_id,
    )

    db.add(group)
    db.commit()
    db.refresh(group)

    return serialize_group(group)


@router.get("/")
def list_groups(
    include_inactive: bool = Query(False),
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    if user.role not in ["admin", "manager", "head", "teacher"]:
        raise HTTPException(status_code=403, detail="Access denied")

    query = db.query(Group)

    if user.role == "teacher":
        allowed_group_ids = get_user_group_ids(db, user)

        if not allowed_group_ids:
            return []

        query = query.filter(Group.id.in_(allowed_group_ids))

    if user.role == "head":
        allowed_department_ids = get_user_department_ids(db, user)

        if not allowed_department_ids:
            return []

        query = query.filter(Group.department_id.in_(allowed_department_ids))

    if not include_inactive:
        query = query.filter(Group.is_active.is_(True))

    groups = query.order_by(
        Group.is_active.desc(),
        Group.admission_year.desc(),
        Group.prefix.asc(),
        Group.course.asc(),
        Group.suffix.asc(),
    ).all()

    return [serialize_group(group) for group in groups]


@router.get("/{group_id}")
def get_group(
    group_id: int,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    if user.role not in ["admin", "manager", "head", "teacher"]:
        raise HTTPException(status_code=403, detail="Access denied")

    group = db.query(Group).filter(Group.id == group_id).first()
    if not group:
        raise HTTPException(status_code=404, detail="Group not found")

    check_group_access(db, user, group)

    return serialize_group(group)


@router.put("/{group_id}")
def update_group(
    group_id: int,
    payload: GroupUpdate,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    if user.role not in ["admin", "manager", "head"]:
        raise HTTPException(status_code=403, detail="Access denied")

    group = db.query(Group).filter(Group.id == group_id).first()
    if not group:
        raise HTTPException(status_code=404, detail="Group not found")

    check_group_access(db, user, group)

    data = normalize_group_data(
        prefix=payload.prefix,
        admission_year=payload.admission_year,
        course=payload.course,
        suffix=payload.suffix,
        is_active=payload.is_active,
    )

    if user.role in ["admin", "manager"]:
        if payload.department_id is not None:
            department = db.query(Department).filter(
                Department.id == payload.department_id
            ).first()

            if not department:
                raise HTTPException(status_code=404, detail="Отделение не найдено")

            group.department_id = payload.department_id
        else:
            group.department_id = None

    elif user.role == "head":
        allowed_department_ids = get_user_department_ids(db, user)

        if payload.department_id is not None and payload.department_id != group.department_id:
            if payload.department_id not in allowed_department_ids:
                raise HTTPException(
                    status_code=403,
                    detail="Нельзя перенести группу в чужое отделение",
                )
            group.department_id = payload.department_id

    duplicate = db.query(Group).filter(
        Group.id != group_id,
        Group.prefix == data["prefix"],
        Group.admission_year == data["admission_year"],
        Group.course == data["course"],
        Group.suffix == data["suffix"],
    ).first()

    if duplicate:
        raise HTTPException(status_code=400, detail="Такая группа уже существует")

    duplicate_name = db.query(Group).filter(
        Group.id != group_id,
        Group.name == data["name"],
    ).first()

    if duplicate_name:
        raise HTTPException(status_code=400, detail="Группа с таким именем уже существует")

    group.prefix = data["prefix"]
    group.admission_year = data["admission_year"]
    group.course = data["course"]
    group.suffix = data["suffix"]
    group.is_active = data["is_active"]
    group.name = data["name"]

    students = db.query(Student).filter(Student.group_id == group.id).all()
    for student in students:
        student.course = group.course

    db.commit()
    db.refresh(group)

    return serialize_group(group)


@router.post("/promote")
def promote_groups(
    payload: GroupPromoteMany,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    if user.role not in ["admin", "manager", "head"]:
        raise HTTPException(status_code=403, detail="Access denied")

    if not payload.group_ids:
        raise HTTPException(status_code=400, detail="group_ids is empty")

    groups = db.query(Group).filter(Group.id.in_(payload.group_ids)).all()

    if not groups:
        raise HTTPException(status_code=404, detail="Groups not found")

    found_ids = {group.id for group in groups}
    missing_ids = [
        group_id for group_id in payload.group_ids if group_id not in found_ids
    ]

    if missing_ids:
        raise HTTPException(
            status_code=404,
            detail=f"Groups not found: {missing_ids}",
        )

    for group in groups:
        check_group_access(db, user, group)

    future_values = {}
    future_keys = set()

    for group in groups:
        if not group.is_active:
            raise HTTPException(
                status_code=400,
                detail=f"Группа {group.name} архивирована и не может быть повышена",
            )

        if group.course >= 4:
            raise HTTPException(
                status_code=400,
                detail=f"Группа {group.name} уже выпускная",
            )

        new_course = group.course + 1

        new_name = build_group_name(
            prefix=group.prefix,
            admission_year=group.admission_year,
            course=new_course,
            suffix=group.suffix,
        )

        group_suffix = group.suffix or ""
        new_key = (
            group.prefix,
            group.admission_year,
            new_course,
            group_suffix,
        )

        if new_key in future_keys:
            raise HTTPException(
                status_code=400,
                detail="После повышения возникнет дублирование групп",
            )

        future_keys.add(new_key)

        future_values[group.id] = {
            "course": new_course,
            "name": new_name,
        }

    for group in groups:
        group_suffix = group.suffix or ""

        duplicate = db.query(Group).filter(
            Group.id != group.id,
            Group.prefix == group.prefix,
            Group.admission_year == group.admission_year,
            Group.course == future_values[group.id]["course"],
            Group.suffix == group_suffix,
        ).first()

        if duplicate:
            raise HTTPException(
                status_code=400,
                detail=f"Нельзя повысить группу {group.name}: уже существует {duplicate.name}",
            )

    for group in groups:
        group.course = future_values[group.id]["course"]
        group.name = future_values[group.id]["name"]

        students = db.query(Student).filter(Student.group_id == group.id).all()
        for student in students:
            student.course = group.course

    db.commit()

    updated_groups = db.query(Group).filter(Group.id.in_(payload.group_ids)).all()
    updated_groups.sort(key=lambda x: x.name)

    return {
        "message": "Группы успешно повышены на курс",
        "groups": [serialize_group(group) for group in updated_groups],
    }


@router.patch("/{group_id}/archive")
def archive_group(
    group_id: int,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    if user.role not in ["admin", "manager"]:
        raise HTTPException(
            status_code=403,
            detail="Только admin или manager может архивировать группы",
        )

    group = db.query(Group).filter(Group.id == group_id).first()
    if not group:
        raise HTTPException(status_code=404, detail="Group not found")

    if not group.is_active:
        return {
            "message": "Группа уже архивирована",
            "group": serialize_group(group),
        }

    group.is_active = False
    db.commit()
    db.refresh(group)

    return {
        "message": "Группа архивирована",
        "group": serialize_group(group),
    }


@router.patch("/{group_id}/restore")
def restore_group(
    group_id: int,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    if user.role not in ["admin", "manager"]:
        raise HTTPException(
            status_code=403,
            detail="Только admin или manager может восстанавливать группы",
        )

    group = db.query(Group).filter(Group.id == group_id).first()
    if not group:
        raise HTTPException(status_code=404, detail="Group not found")

    if group.is_active:
        return {
            "message": "Группа уже активна",
            "group": serialize_group(group),
        }

    group.is_active = True
    db.commit()
    db.refresh(group)

    return {
        "message": "Группа восстановлена",
        "group": serialize_group(group),
    }


@router.delete("/{group_id}")
def delete_group(
    group_id: int,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    if user.role != "admin":
        raise HTTPException(
            status_code=403,
            detail="Только admin может удалять группы",
        )

    group = db.query(Group).filter(Group.id == group_id).first()
    if not group:
        raise HTTPException(status_code=404, detail="Group not found")

    students_count = db.query(Student).filter(Student.group_id == group.id).count()
    if students_count > 0:
        raise HTTPException(
            status_code=400,
            detail="Нельзя удалить группу, в которой есть студенты. Сначала архивируйте её.",
        )

    links_count = db.query(UserGroup).filter(UserGroup.group_id == group.id).count()
    if links_count > 0:
        raise HTTPException(
            status_code=400,
            detail="Нельзя удалить группу, пока она назначена пользователям. Сначала снимите привязки.",
        )

    db.delete(group)
    db.commit()

    return {
        "message": "Группа удалена",
        "group_id": group_id,
    }
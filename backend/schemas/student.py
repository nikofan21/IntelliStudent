from datetime import datetime

from pydantic import BaseModel, EmailStr


class StudentBase(BaseModel):
    full_name: str
    group_id: int
    email: EmailStr


class StudentCreate(StudentBase):
    pass


class StudentUpdate(StudentBase):
    pass


class StudentOut(BaseModel):
    id: int
    full_name: str
    group_id: int
    group_name: str | None = None
    course: int | None = None
    email: str
    created_at: datetime

    class Config:
        from_attributes = True
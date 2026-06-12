from datetime import datetime
from typing import Optional

from pydantic import BaseModel


class GroupBase(BaseModel):
    prefix: str
    admission_year: int
    course: int
    suffix: Optional[str] = ""
    department_id: Optional[int] = None
    is_active: bool = True


class GroupCreate(GroupBase):
    pass


class GroupUpdate(GroupBase):
    pass


class GroupOut(BaseModel):
    id: int
    prefix: str
    admission_year: int
    course: int
    suffix: Optional[str] = ""
    name: str
    display_name: str

    department_id: Optional[int] = None
    department_name: Optional[str] = None

    is_active: bool
    created_at: datetime

    class Config:
        from_attributes = True
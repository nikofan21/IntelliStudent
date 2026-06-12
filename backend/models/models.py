from sqlalchemy import Column, Integer, String, DateTime, ForeignKey, Text, UniqueConstraint, Boolean
from sqlalchemy.sql import func
from sqlalchemy.orm import relationship
from ..database import Base


class User(Base):
    __tablename__ = "users"

    id = Column(Integer, primary_key=True, index=True)
    login = Column(String, unique=True, index=True, nullable=False)
    password_hash = Column(String, nullable=False)
    role = Column(String, nullable=False)
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    group_links = relationship(
        "UserGroup",
        back_populates="user",
        cascade="all, delete-orphan"
    )

    department_links = relationship(
        "UserDepartment",
        back_populates="user",
        cascade="all, delete-orphan"
    )


class Department(Base):
    __tablename__ = "departments"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String, nullable=False, unique=True, index=True)
    description = Column(Text, nullable=True)
    is_active = Column(Boolean, nullable=False, default=True, server_default="1", index=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    groups = relationship(
        "Group",
        back_populates="department"
    )

    user_links = relationship(
        "UserDepartment",
        back_populates="department",
        cascade="all, delete-orphan"
    )


class UserDepartment(Base):
    __tablename__ = "user_departments"
    __table_args__ = (
        UniqueConstraint("user_id", "department_id", name="uq_user_department"),
    )

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False, index=True)
    department_id = Column(Integer, ForeignKey("departments.id"), nullable=False, index=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    user = relationship("User", back_populates="department_links")
    department = relationship("Department", back_populates="user_links")


class Group(Base):
    __tablename__ = "groups"
    __table_args__ = (
        UniqueConstraint(
            "prefix",
            "admission_year",
            "course",
            "suffix",
            name="uq_group_structured"
        ),
    )

    id = Column(Integer, primary_key=True, index=True)

    # display name, собирается автоматически из полей ниже
    name = Column(String, nullable=False, unique=True, index=True)

    prefix = Column(String, nullable=False, index=True)
    admission_year = Column(Integer, nullable=False, index=True)
    course = Column(Integer, nullable=False, index=True)
    suffix = Column(String, nullable=False)

    # Новая привязка группы к отделению
    department_id = Column(Integer, ForeignKey("departments.id"), nullable=True, index=True)

    is_active = Column(Boolean, nullable=False, default=True, server_default="1", index=True)

    created_at = Column(DateTime(timezone=True), server_default=func.now())

    department = relationship(
        "Department",
        back_populates="groups"
    )

    students = relationship(
        "Student",
        back_populates="group",
        cascade="all, delete-orphan"
    )

    user_links = relationship(
        "UserGroup",
        back_populates="group",
        cascade="all, delete-orphan"
    )

    @staticmethod
    def build_name(prefix: str, admission_year: int, course: int, suffix: str) -> str:
        prefix = (prefix or "").strip()
        suffix = (suffix or "").strip().upper()

        if not prefix:
            raise ValueError("prefix is required")
        if admission_year is None:
            raise ValueError("admission_year is required")
        if course is None:
            raise ValueError("course is required")
        if not suffix:
            raise ValueError("suffix is required")

        year_short = str(admission_year)[-2:]
        return f"{prefix}{year_short}-{course}{suffix}"

    @property
    def display_name(self) -> str:
        return self.name


class UserGroup(Base):
    __tablename__ = "user_groups"
    __table_args__ = (
        UniqueConstraint("user_id", "group_id", name="uq_user_group"),
    )

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False, index=True)
    group_id = Column(Integer, ForeignKey("groups.id"), nullable=False, index=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    user = relationship("User", back_populates="group_links")
    group = relationship("Group", back_populates="user_links")


class Student(Base):
    __tablename__ = "students"

    id = Column(Integer, primary_key=True, index=True)
    full_name = Column(String, nullable=False, index=True)
    group_id = Column(Integer, ForeignKey("groups.id"), nullable=False, index=True)

    # Пока оставляем физически, чтобы не сломать остальной проект.
    # Но теперь это производное значение от группы.
    course = Column(Integer, nullable=False)

    email = Column(String, nullable=False)
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    group = relationship("Group", back_populates="students")
    document_links = relationship(
        "DocumentStudent",
        back_populates="student",
        cascade="all, delete-orphan"
    )

    @property
    def actual_course(self):
        if self.group:
            return self.group.course
        return self.course


class Document(Base):
    __tablename__ = "documents"

    id = Column(Integer, primary_key=True, index=True)
    display_name = Column(String, nullable=True)
    filename = Column(String, nullable=False)
    filepath = Column(String, nullable=False)
    file_type = Column(String, nullable=False)
    status = Column(String, nullable=False, default="uploaded")
    uploaded_at = Column(DateTime(timezone=True), server_default=func.now())
    text_content = Column(Text)

    ai_result = relationship(
        "AIResult",
        back_populates="document",
        uselist=False,
        cascade="all, delete-orphan"
    )
    student_links = relationship(
        "DocumentStudent",
        back_populates="document",
        cascade="all, delete-orphan"
    )


class DocumentStudent(Base):
    __tablename__ = "document_students"
    __table_args__ = (
        UniqueConstraint("document_id", "student_id", name="uq_document_student"),
    )

    id = Column(Integer, primary_key=True, index=True)
    document_id = Column(Integer, ForeignKey("documents.id"), nullable=False, index=True)
    student_id = Column(Integer, ForeignKey("students.id"), nullable=False, index=True)
    match_source = Column(String, nullable=False, default="manual")
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    document = relationship("Document", back_populates="student_links")
    student = relationship("Student", back_populates="document_links")


class AIResult(Base):
    __tablename__ = "ai_results"
    __table_args__ = (
        UniqueConstraint("document_id", name="uq_ai_results_document_id"),
    )

    id = Column(Integer, primary_key=True, index=True)
    document_id = Column(Integer, ForeignKey("documents.id"), nullable=False, index=True)
    doc_type = Column(String, nullable=False)
    entities_json = Column(Text)
    vector_blob = Column(Text)

    document = relationship("Document", back_populates="ai_result")
import os
import uuid
import json
from typing import Optional, List, Set

from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, Form
from fastapi.responses import FileResponse
from pydantic import BaseModel
from sqlalchemy.orm import Session

from ..database import SessionLocal
from ..models.models import (
    Document,
    Student,
    User,
    AIResult,
    DocumentStudent,
    Group,
    UserGroup,
)
from ..auth.security import get_current_user
from ..utils.text_extract import detect_file_type, extract_text_from_file, open_docx
from ..services.ai_client import analyze_text
from ..services.document_matcher import find_students_by_ai_data
from ..services.docx_student_profile import build_student_profile_from_docx

router = APIRouter(prefix="/documents", tags=["Documents"])

BASE_DIR = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
STORAGE_DIR = os.path.join(BASE_DIR, "storage", "documents")
os.makedirs(STORAGE_DIR, exist_ok=True)


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


class AssignManyStudentsRequest(BaseModel):
    student_ids: List[int]


class UpdateDocumentTitleRequest(BaseModel):
    display_name: Optional[str] = None


def get_user_group_ids(db: Session, user_id: int) -> Set[int]:
    links = db.query(UserGroup).filter(UserGroup.user_id == user_id).all()
    return {link.group_id for link in links}


def check_group_access(db: Session, user: User, group_id: int) -> None:
    if user.role in ["admin", "manager", "head"]:
        return

    if user.role != "teacher":
        raise HTTPException(status_code=403, detail="Access denied")

    allowed_group_ids = get_user_group_ids(db, user.id)
    if group_id not in allowed_group_ids:
        raise HTTPException(status_code=403, detail="Access denied for this group")


def check_student_access(db: Session, user: User, student: Student) -> None:
    check_group_access(db, user, student.group_id)


def get_document_group_ids(db: Session, doc_id: int) -> Set[int]:
    links = db.query(DocumentStudent).filter(
        DocumentStudent.document_id == doc_id
    ).all()

    group_ids = set()

    for link in links:
        student = db.query(Student).filter(Student.id == link.student_id).first()
        if student:
            group_ids.add(student.group_id)

    return group_ids


def get_group_by_ai_name(db: Session, detected_group_name: Optional[str]) -> Optional[Group]:
    """
    AI пока возвращает строковое имя группы.
    Здесь централизованно пытаемся найти соответствующую группу.
    """
    if not detected_group_name:
        return None

    clean_name = detected_group_name.strip()
    if not clean_name:
        return None

    return db.query(Group).filter(Group.name == clean_name).first()


def check_document_access(db: Session, user: User, doc: Document) -> None:
    if user.role in ["admin", "manager", "head"]:
        return

    if user.role != "teacher":
        raise HTTPException(status_code=403, detail="Access denied")

    user_group_ids = get_user_group_ids(db, user.id)
    doc_group_ids = get_document_group_ids(db, doc.id)

    ai_row = db.query(AIResult).filter(AIResult.document_id == doc.id).first()
    detected_group_name = None

    if ai_row and ai_row.entities_json:
        try:
            entities = json.loads(ai_row.entities_json or "{}")
            detected_group_name = entities.get("group_name")
        except Exception:
            detected_group_name = None

    detected_group = get_group_by_ai_name(db, detected_group_name)
    detected_group_id = detected_group.id if detected_group else None

    if doc_group_ids.intersection(user_group_ids):
        return

    if detected_group_id and detected_group_id in user_group_ids:
        return

    raise HTTPException(status_code=403, detail="Access denied to this document")


def get_students_by_group_name(db: Session, group_name: Optional[str]) -> List[Student]:
    if not group_name:
        return []

    group = get_group_by_ai_name(db, group_name)
    if not group:
        return []

    students = db.query(Student).filter(Student.group_id == group.id).all()
    return students


def link_document_to_students(
    db: Session,
    doc: Document,
    students: List[Student],
    match_source: str
):
    linked_students = []

    for student in students:
        existing_link = db.query(DocumentStudent).filter(
            DocumentStudent.document_id == doc.id,
            DocumentStudent.student_id == student.id
        ).first()

        if not existing_link:
            link = DocumentStudent(
                document_id=doc.id,
                student_id=student.id,
                match_source=match_source
            )
            db.add(link)
            linked_students.append(student)

    if linked_students:
        doc.status = "processed"

    return linked_students


def serialize_document_student(student: Student, match_source: str):
    return {
        "id": student.id,
        "full_name": student.full_name,
        "group_id": student.group_id,
        "group_name": student.group.name if student.group else None,
        "course": student.group.course if student.group else student.course,
        "match_source": match_source,
    }


@router.post("/upload")
def upload_document(
    file: UploadFile = File(...),
    student_id: Optional[int] = Form(None),
    display_name: Optional[str] = Form(None),
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    if user.role not in ["admin", "manager", "head", "teacher"]:
        raise HTTPException(status_code=403, detail="Access denied")

    chosen_students = []
    auto_match_source = None

    if student_id is not None:
        chosen_student = db.query(Student).filter(Student.id == student_id).first()
        if not chosen_student:
            raise HTTPException(status_code=404, detail="Student not found")
        check_student_access(db, user, chosen_student)
        chosen_students = [chosen_student]

    file_type = detect_file_type(file.filename)
    if file_type == "unknown":
        raise HTTPException(status_code=400, detail="Unsupported file type. Use PDF/DOCX/TXT")

    safe_name = f"{uuid.uuid4().hex}_{file.filename}"
    save_path = os.path.join(STORAGE_DIR, safe_name)

    with open(save_path, "wb") as f:
        f.write(file.file.read())

    text_content = extract_text_from_file(save_path, file_type)

    try:
        ai = analyze_text(text_content or "")
    except Exception as e:
        raise HTTPException(
            status_code=502,
            detail=f"AI service error. Start ai_service on port 8001. Details: {str(e)}"
        )

    entities = ai.get("entities", {}) or {}
    detected_fio = entities.get("fio")
    detected_group = entities.get("group_name")

    matched_students = []

    if chosen_students:
        matched_students = chosen_students
        auto_match_source = "manual"
    else:
        matched_students = find_students_by_ai_data(db, detected_fio, detected_group)

        if user.role == "teacher":
            allowed_group_ids = get_user_group_ids(db, user.id)
            matched_students = [
                s for s in matched_students
                if s.group_id in allowed_group_ids
            ]

        if matched_students:
            auto_match_source = "ai"
        else:
            group_students = get_students_by_group_name(db, detected_group)

            if user.role == "teacher":
                allowed_group_ids = get_user_group_ids(db, user.id)
                group_students = [
                    s for s in group_students
                    if s.group_id in allowed_group_ids
                ]

            if group_students:
                matched_students = group_students
                auto_match_source = "ai_group"

    status = "processed" if matched_students else "unassigned"

    clean_display_name = (display_name or "").strip() or None

    doc = Document(
        filename=file.filename,
        display_name=clean_display_name,
        filepath=save_path,
        file_type=file_type,
        status=status,
        text_content=text_content,
    )
    db.add(doc)
    db.commit()
    db.refresh(doc)

    if matched_students:
        link_document_to_students(
            db=db,
            doc=doc,
            students=matched_students,
            match_source=auto_match_source or "ai"
        )
        db.commit()
        db.refresh(doc)

    ai_row = AIResult(
        document_id=doc.id,
        doc_type=ai.get("doc_type", "unknown"),
        entities_json=json.dumps(entities, ensure_ascii=False),
        vector_blob=json.dumps(ai.get("vector", []), ensure_ascii=False),
    )
    db.add(ai_row)
    db.commit()
    db.refresh(ai_row)

    return {
        "id": doc.id,
        "filename": doc.filename,
        "display_name": doc.display_name,
        "effective_name": doc.display_name or doc.filename,
        "file_type": doc.file_type,
        "status": doc.status,
        "text_length": len(doc.text_content or ""),
        "ai_result_id": ai_row.id,
        "doc_type": ai_row.doc_type,
        "entities": entities,
        "match_source": auto_match_source,
        "matched_students": [
            {
                "id": s.id,
                "full_name": s.full_name,
                "group_id": s.group_id,
                "group_name": s.group.name if s.group else None,
                "course": s.group.course if s.group else s.course,
            }
            for s in matched_students
        ]
    }


@router.patch("/{doc_id}/title")
def update_document_title(
    doc_id: int,
    payload: UpdateDocumentTitleRequest,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    if user.role not in ["admin", "manager", "head", "teacher"]:
        raise HTTPException(status_code=403, detail="Access denied")

    doc = db.query(Document).filter(Document.id == doc_id).first()
    if not doc:
        raise HTTPException(status_code=404, detail="Document not found")

    check_document_access(db, user, doc)

    clean_display_name = (payload.display_name or "").strip()
    doc.display_name = clean_display_name if clean_display_name else None

    db.commit()
    db.refresh(doc)

    return {
        "message": "Document title updated",
        "doc_id": doc.id,
        "display_name": doc.display_name,
        "effective_name": doc.display_name or doc.filename
    }


@router.get("/unassigned")
def list_unassigned_documents(
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    if user.role not in ["admin", "manager", "head", "teacher"]:
        raise HTTPException(status_code=403, detail="Access denied")

    docs = db.query(Document).filter(
        Document.status == "unassigned"
    ).order_by(Document.id.desc()).all()

    result = []
    user_group_ids = get_user_group_ids(db, user.id) if user.role == "teacher" else set()

    for d in docs:
        ai = db.query(AIResult).filter(AIResult.document_id == d.id).first()

        if user.role == "teacher":
            doc_group_ids = get_document_group_ids(db, d.id)
            detected_group_id = None

            if ai and ai.entities_json:
                try:
                    entities = json.loads(ai.entities_json or "{}")
                    detected_group_name = entities.get("group_name")
                    detected_group = get_group_by_ai_name(db, detected_group_name)
                    if detected_group:
                        detected_group_id = detected_group.id
                except Exception:
                    detected_group_id = None

            if doc_group_ids:
                if not doc_group_ids.intersection(user_group_ids):
                    continue
            elif detected_group_id:
                if detected_group_id not in user_group_ids:
                    continue

        result.append({
            "id": d.id,
            "filename": d.filename,
            "display_name": d.display_name,
            "effective_name": d.display_name or d.filename,
            "file_type": d.file_type,
            "status": d.status,
            "uploaded_at": str(d.uploaded_at),
            "text_preview": (d.text_content or "")[:300],
            "entities_json": ai.entities_json if ai else None,
        })

    return result


@router.post("/{doc_id}/assign")
def assign_document_to_student(
    doc_id: int,
    student_id: int,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    if user.role not in ["admin", "manager", "head", "teacher"]:
        raise HTTPException(status_code=403, detail="Access denied")

    doc = db.query(Document).filter(Document.id == doc_id).first()
    if not doc:
        raise HTTPException(status_code=404, detail="Document not found")

    check_document_access(db, user, doc)

    student = db.query(Student).filter(Student.id == student_id).first()
    if not student:
        raise HTTPException(status_code=404, detail="Student not found")

    check_student_access(db, user, student)

    existing_link = db.query(DocumentStudent).filter(
        DocumentStudent.document_id == doc.id,
        DocumentStudent.student_id == student.id
    ).first()

    if not existing_link:
        link = DocumentStudent(
            document_id=doc.id,
            student_id=student.id,
            match_source="manual"
        )
        db.add(link)

    doc.status = "processed"
    db.commit()
    db.refresh(doc)

    return {
        "message": "Document assigned",
        "doc_id": doc.id,
        "student_id": student.id
    }


@router.post("/{doc_id}/assign-many")
def assign_document_to_many_students(
    doc_id: int,
    payload: AssignManyStudentsRequest,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    if user.role not in ["admin", "manager", "head", "teacher"]:
        raise HTTPException(status_code=403, detail="Access denied")

    doc = db.query(Document).filter(Document.id == doc_id).first()
    if not doc:
        raise HTTPException(status_code=404, detail="Document not found")

    check_document_access(db, user, doc)

    if not payload.student_ids:
        raise HTTPException(status_code=400, detail="student_ids cannot be empty")

    linked_students = []
    already_linked = []
    not_found_students = []

    unique_student_ids = list(set(payload.student_ids))

    for student_id in unique_student_ids:
        student = db.query(Student).filter(Student.id == student_id).first()
        if not student:
            not_found_students.append(student_id)
            continue

        check_student_access(db, user, student)

        existing_link = db.query(DocumentStudent).filter(
            DocumentStudent.document_id == doc.id,
            DocumentStudent.student_id == student.id
        ).first()

        if existing_link:
            already_linked.append(student.id)
            continue

        link = DocumentStudent(
            document_id=doc.id,
            student_id=student.id,
            match_source="manual_many"
        )
        db.add(link)
        linked_students.append(student.id)

    if linked_students or already_linked:
        doc.status = "processed"

    db.commit()
    db.refresh(doc)

    return {
        "message": "Document assigned to selected students",
        "doc_id": doc.id,
        "linked_students": linked_students,
        "already_linked": already_linked,
        "not_found_students": not_found_students,
        "total_requested": len(unique_student_ids)
    }


@router.post("/{doc_id}/assign-group/{group_id}")
def assign_document_to_group(
    doc_id: int,
    group_id: int,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    if user.role not in ["admin", "manager", "head", "teacher"]:
        raise HTTPException(status_code=403, detail="Access denied")

    doc = db.query(Document).filter(Document.id == doc_id).first()
    if not doc:
        raise HTTPException(status_code=404, detail="Document not found")

    check_document_access(db, user, doc)
    check_group_access(db, user, group_id)

    students = db.query(Student).filter(Student.group_id == group_id).all()
    if not students:
        raise HTTPException(status_code=404, detail="No students found in this group")

    linked_students = []
    already_linked = []

    for student in students:
        existing_link = db.query(DocumentStudent).filter(
            DocumentStudent.document_id == doc.id,
            DocumentStudent.student_id == student.id
        ).first()

        if existing_link:
            already_linked.append(student.id)
            continue

        link = DocumentStudent(
            document_id=doc.id,
            student_id=student.id,
            match_source="group_assign"
        )
        db.add(link)
        linked_students.append(student.id)

    doc.status = "processed"
    db.commit()
    db.refresh(doc)

    return {
        "message": "Document assigned to group",
        "doc_id": doc.id,
        "group_id": group_id,
        "linked_students": linked_students,
        "already_linked": already_linked,
        "total_in_group": len(students)
    }


@router.get("/{doc_id}")
def get_document(
    doc_id: int,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    doc = db.query(Document).filter(Document.id == doc_id).first()
    if not doc:
        raise HTTPException(status_code=404, detail="Document not found")

    if user.role not in ["admin", "manager", "head", "teacher"]:
        raise HTTPException(status_code=403, detail="Access denied")

    check_document_access(db, user, doc)

    ai_row = db.query(AIResult).filter(AIResult.document_id == doc.id).first()
    links = db.query(DocumentStudent).filter(DocumentStudent.document_id == doc.id).all()

    students = []
    for link in links:
        student = db.query(Student).filter(Student.id == link.student_id).first()
        if student:
            students.append(serialize_document_student(student, link.match_source))

    return {
        "id": doc.id,
        "filename": doc.filename,
        "display_name": doc.display_name,
        "effective_name": doc.display_name or doc.filename,
        "file_type": doc.file_type,
        "status": doc.status,
        "text_preview": (doc.text_content or "")[:500],
        "students": students,
        "ai": None if not ai_row else {
            "doc_type": ai_row.doc_type,
            "entities": json.loads(ai_row.entities_json or "{}")
        }
    }


@router.get("/{doc_id}/student-profile/{student_id}")
def get_student_profile_from_document(
    doc_id: int,
    student_id: int,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    if user.role not in ["admin", "manager", "head", "teacher"]:
        raise HTTPException(status_code=403, detail="Access denied")

    doc = db.query(Document).filter(Document.id == doc_id).first()
    if not doc:
        raise HTTPException(status_code=404, detail="Document not found")

    check_document_access(db, user, doc)

    student = db.query(Student).filter(Student.id == student_id).first()
    if not student:
        raise HTTPException(status_code=404, detail="Student not found")

    check_student_access(db, user, student)

    link = db.query(DocumentStudent).filter(
        DocumentStudent.document_id == doc.id,
        DocumentStudent.student_id == student.id
    ).first()
    if not link:
        raise HTTPException(status_code=404, detail="This document is not linked to this student")

    if doc.file_type != "docx":
        raise HTTPException(status_code=400, detail="Student profile extraction is supported only for DOCX")

    parsed_doc = open_docx(doc.filepath)
    if not parsed_doc:
        raise HTTPException(status_code=400, detail="Failed to open DOCX document")

    profile = build_student_profile_from_docx(parsed_doc, student.full_name)

    return {
        "document_id": doc.id,
        "student_id": student.id,
        "student_full_name": student.full_name,
        "group_name": student.group.name if student.group else None,
        "course": student.group.course if student.group else student.course,
        "profile": profile
    }


@router.get("/download/{doc_id}")
def download_document(
    doc_id: int,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    doc = db.query(Document).filter(Document.id == doc_id).first()
    if not doc:
        raise HTTPException(status_code=404, detail="Document not found")

    if user.role not in ["admin", "manager", "head", "teacher"]:
        raise HTTPException(status_code=403, detail="Access denied")

    check_document_access(db, user, doc)

    if not os.path.exists(doc.filepath):
        raise HTTPException(status_code=404, detail="File missing on disk")

    return FileResponse(path=doc.filepath, filename=doc.filename)


@router.delete("/{doc_id}/unlink/{student_id}")
def unlink_document_from_student(
    doc_id: int,
    student_id: int,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    if user.role not in ["admin", "manager", "head", "teacher"]:
        raise HTTPException(status_code=403, detail="Access denied")

    doc = db.query(Document).filter(Document.id == doc_id).first()
    if not doc:
        raise HTTPException(status_code=404, detail="Document not found")

    check_document_access(db, user, doc)

    student = db.query(Student).filter(Student.id == student_id).first()
    if not student:
        raise HTTPException(status_code=404, detail="Student not found")

    check_student_access(db, user, student)

    link = db.query(DocumentStudent).filter(
        DocumentStudent.document_id == doc.id,
        DocumentStudent.student_id == student.id
    ).first()

    if not link:
        raise HTTPException(status_code=404, detail="Document is not linked to this student")

    total_links = db.query(DocumentStudent).filter(
        DocumentStudent.document_id == doc.id
    ).count()

    if total_links <= 1:
        raise HTTPException(
            status_code=400,
            detail="This is a personal document. Use full delete instead of unlink."
        )

    db.delete(link)
    db.commit()

    remaining_links = db.query(DocumentStudent).filter(
        DocumentStudent.document_id == doc.id
    ).count()

    return {
        "message": "Document unlinked from student",
        "doc_id": doc.id,
        "student_id": student.id,
        "remaining_links": remaining_links
    }


@router.delete("/{doc_id}")
def delete_document(
    doc_id: int,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    if user.role not in ["admin", "manager", "head", "teacher"]:
        raise HTTPException(status_code=403, detail="Access denied")

    doc = db.query(Document).filter(Document.id == doc_id).first()

    if not doc:
        raise HTTPException(status_code=404, detail="Document not found")

    check_document_access(db, user, doc)

    db.query(DocumentStudent).filter(
        DocumentStudent.document_id == doc.id
    ).delete()

    db.query(AIResult).filter(
        AIResult.document_id == doc.id
    ).delete()

    if os.path.exists(doc.filepath):
        try:
            os.remove(doc.filepath)
        except Exception:
            pass

    db.delete(doc)
    db.commit()

    return {"message": "Document deleted"}


@router.get("/admin/all")
def get_all_documents_admin(
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    if user.role not in ["admin", "manager", "head"]:
        raise HTTPException(status_code=403, detail="Access denied")

    docs = db.query(Document).order_by(Document.id.desc()).all()

    result = []

    for d in docs:
        links = db.query(DocumentStudent).filter(
            DocumentStudent.document_id == d.id
        ).all()

        students = []
        for link in links:
            student = db.query(Student).filter(Student.id == link.student_id).first()
            if student:
                students.append({
                    "id": student.id,
                    "full_name": student.full_name,
                    "group_id": student.group_id,
                    "group_name": student.group.name if student.group else None,
                    "course": student.group.course if student.group else student.course,
                    "match_source": link.match_source,
                })

        result.append({
            "id": d.id,
            "filename": d.filename,
            "display_name": d.display_name,
            "effective_name": d.display_name or d.filename,
            "file_type": d.file_type,
            "status": d.status,
            "uploaded_at": str(d.uploaded_at),
            "linked_students_count": len(students),
            "is_shared": len(students) > 1,
            "students": students,
        })

    return result
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from ..database import SessionLocal
from ..models.models import Group, Student, Document, DocumentStudent, User
from ..auth.security import get_current_user

router = APIRouter(prefix="/dashboard", tags=["Dashboard"])


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


@router.get("/stats")
def get_dashboard_stats(
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    if user.role not in ["admin", "teacher"]:
        raise HTTPException(status_code=403, detail="Access denied")

    total_students = db.query(Student).count()
    total_groups = db.query(Group).count()
    total_documents = db.query(Document).count()
    unassigned_documents = db.query(Document).filter(Document.status == "unassigned").count()

    all_docs = db.query(Document).all()

    shared_documents = 0
    personal_documents = 0

    for doc in all_docs:
        links_count = db.query(DocumentStudent).filter(
            DocumentStudent.document_id == doc.id
        ).count()

        if links_count > 1:
            shared_documents += 1
        elif links_count == 1:
            personal_documents += 1

    return {
        "total_students": total_students,
        "total_groups": total_groups,
        "total_documents": total_documents,
        "unassigned_documents": unassigned_documents,
        "shared_documents": shared_documents,
        "personal_documents": personal_documents,
    }
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from .database import engine, Base
from .models import models

from .routers import auth, documents, groups, students, search, dashboard, departments

app = FastAPI(title="IntelliStudent Backend")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://127.0.0.1:5173"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(auth.router)
app.include_router(groups.router)
app.include_router(students.router)
app.include_router(documents.router)
app.include_router(search.router)
app.include_router(dashboard.router)
app.include_router(departments.router)


@app.get("/")
def root():
    return {"status": "Backend running"}


Base.metadata.create_all(bind=engine)
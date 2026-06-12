from fastapi import FastAPI
from pydantic import BaseModel
from typing import Any, Dict, List

from .nlp import classify_doc, extract_entities

app = FastAPI(title="IntelliStudent AI Service")


class AnalyzeIn(BaseModel):
    text: str


class AnalyzeOut(BaseModel):
    doc_type: str
    entities: Dict[str, Any]
    vector: List[float]


@app.get("/")
def root():
    return {"status": "AI service running"}


@app.post("/analyze", response_model=AnalyzeOut)
def analyze(payload: AnalyzeIn):
    text = payload.text or ""
    return {
        "doc_type": classify_doc(text),
        "entities": extract_entities(text),
        "vector": []
    }
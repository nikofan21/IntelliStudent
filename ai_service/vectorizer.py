from typing import List
import numpy as np
from sklearn.feature_extraction.text import TfidfVectorizer
from sklearn.metrics.pairwise import cosine_similarity

class LocalVectorIndex:
    def __init__(self):
        self.vectorizer = TfidfVectorizer(max_features=5000)
        self.doc_ids: List[int] = []
        self.matrix = None  # sparse matrix

    def rebuild(self, documents: List[dict]):
        # documents: [{"id": int, "text": str}, ...]
        self.doc_ids = [d["id"] for d in documents]
        texts = [d["text"] or "" for d in documents]
        if len(texts) == 0:
            self.matrix = None
            return

        self.matrix = self.vectorizer.fit_transform(texts)

    def add_or_update(self, doc_id: int, text: str):
        # Для простоты MVP: при добавлении лучше пересобрать индекс в backend командой rebuild_index
        # Здесь оставим как заглушку.
        pass

    def encode_query(self, query: str):
        if self.matrix is None:
            return None
        return self.vectorizer.transform([query or ""])

    def search(self, query: str, top_k: int = 5):
        if self.matrix is None:
            return []
        q = self.encode_query(query)
        sims = cosine_similarity(q, self.matrix)[0]
        pairs = list(zip(self.doc_ids, sims))
        pairs.sort(key=lambda x: x[1], reverse=True)
        return [{"document_id": did, "score": float(score)} for did, score in pairs[:top_k]]
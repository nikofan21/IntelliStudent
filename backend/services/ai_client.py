import requests

BASE_URL = "http://127.0.0.1:8001"


def analyze_text(text: str) -> dict:
    r = requests.post(
        f"{BASE_URL}/analyze",
        json={"text": text},
        timeout=30
    )
    r.raise_for_status()
    return r.json()


def rebuild_index(documents: list[dict]) -> dict:
    r = requests.post(
        f"{BASE_URL}/rebuild_index",
        json={"documents": documents},
        timeout=60
    )
    r.raise_for_status()
    return r.json()


def semantic_search(query: str, top_k: int = 5) -> dict:
    r = requests.post(
        f"{BASE_URL}/semantic_search",
        json={"query": query, "top_k": top_k},
        timeout=30
    )
    r.raise_for_status()
    return r.json()
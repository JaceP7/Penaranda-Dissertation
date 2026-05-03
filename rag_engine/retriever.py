"""
rag_engine/retriever.py — FAISS retrieval + Cross-Encoder reranking

Adapted from LEKS retriever.py (cs190-ieee-v3).
Loads the pre-built FAISS index for city services,
encodes queries with multilingual-e5-large ("query: " prefix),
and optionally reranks with BAAI/bge-reranker-base.

Public API:
    encode_query(query)          -> np.ndarray (1, dim)
    retrieve(query, top_k, ...)  -> list[dict]
"""

import json
from functools import lru_cache
from pathlib import Path

import faiss
import numpy as np
from sentence_transformers import CrossEncoder, SentenceTransformer

INDEX_DIR    = Path(__file__).resolve().parent / "index"
INDEX_FILE   = "faiss.index"
META_FILE    = "metadata.jsonl"

EMBED_MODEL  = "intfloat/multilingual-e5-large"
RERANK_MODEL = "BAAI/bge-reranker-base"
QUERY_PREFIX = "query: "

_index_cache: dict = {}


def _load_index() -> tuple:
    """Load FAISS index + metadata. Cached after first load."""
    key = str(INDEX_DIR.resolve())
    if key not in _index_cache:
        idx_path  = INDEX_DIR / INDEX_FILE
        meta_path = INDEX_DIR / META_FILE
        if not idx_path.exists():
            raise FileNotFoundError(
                f"FAISS index not found at {idx_path}.\n"
                f"Run: python -m rag_engine.build_index"
            )
        index = faiss.read_index(str(idx_path))
        with open(meta_path, encoding="utf-8") as f:
            meta = [json.loads(line) for line in f]
        _index_cache[key] = (index, meta)
    return _index_cache[key]


@lru_cache(maxsize=1)
def _load_embedder() -> SentenceTransformer:
    return SentenceTransformer(EMBED_MODEL, device="cpu")


@lru_cache(maxsize=1)
def _load_reranker() -> CrossEncoder:
    import os
    try:
        import torch
        device = "cuda" if (torch.cuda.is_available() and
                            os.environ.get("RAG_RERANKER_CPU", "0") != "1") else "cpu"
    except ImportError:
        device = "cpu"
    model = CrossEncoder(RERANK_MODEL, device=device)
    return model


_query_cache: dict = {}
_QUERY_CACHE_MAX = 64


def encode_query(query: str) -> np.ndarray:
    """Encode a query string; results LRU-cached (max 64)."""
    if query in _query_cache:
        return _query_cache[query]
    embedder = _load_embedder()
    vec = embedder.encode(
        [QUERY_PREFIX + query],
        normalize_embeddings=True,
        convert_to_numpy=True,
    ).astype(np.float32)
    if len(_query_cache) >= _QUERY_CACHE_MAX:
        _query_cache.pop(next(iter(_query_cache)))
    _query_cache[query] = vec
    return vec


def retrieve(
    query: str,
    top_k: int = 5,
    use_reranker: bool = True,
    rerank_pool: int = 15,
    q_vec: "np.ndarray | None" = None,
) -> list[dict]:
    """
    Retrieve top_k relevant service chunks for a query.

    Args:
        query        : rewritten query string
        top_k        : final number of results
        use_reranker : apply Cross-Encoder reranking
        rerank_pool  : FAISS candidates fed to reranker (>= top_k)
        q_vec        : pre-computed query embedding (skip encoding if provided)

    Returns:
        list of chunk dicts with 'score' and optionally 'rerank_score'
    """
    index, meta = _load_index()

    if q_vec is None:
        q_vec = encode_query(query)

    k_fetch = max(rerank_pool, top_k) if use_reranker else top_k
    scores, indices = index.search(q_vec, k_fetch)
    scores, indices = scores[0], indices[0]

    candidates = []
    for score, idx in zip(scores, indices):
        if idx == -1:
            continue
        chunk = dict(meta[idx])
        chunk["score"] = float(score)
        candidates.append(chunk)

    if not use_reranker:
        return candidates[:top_k]

    reranker      = _load_reranker()
    pairs         = [(query, c["text"]) for c in candidates]
    rerank_scores = reranker.predict(pairs)

    for chunk, rs in zip(candidates, rerank_scores):
        chunk["rerank_score"] = float(rs)

    return sorted(candidates, key=lambda c: c["rerank_score"], reverse=True)[:top_k]

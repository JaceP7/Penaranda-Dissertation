"""
rag_engine/build_index.py — Build FAISS index from services.json

Reads wayfinding-app/data/services.json (74 sub-services),
embeds each entry with multilingual-e5-large, and writes:
  rag_engine/index/faiss.index
  rag_engine/index/metadata.jsonl

One vector per sub-service entry (service + subservice + department + steps).

Usage:
    python -m rag_engine.build_index
    -- or --
    python rag_engine/build_index.py
"""

import json
from pathlib import Path

import faiss
import numpy as np
from sentence_transformers import SentenceTransformer
from tqdm import tqdm

ROOT         = Path(__file__).resolve().parent.parent
SERVICES_JSON = ROOT / "wayfinding-app" / "data" / "services.json"
INDEX_DIR    = Path(__file__).resolve().parent / "index"
MODEL_NAME   = "intfloat/multilingual-e5-large"
PASSAGE_PFX  = "passage: "
BATCH_SIZE   = 16


def _format_requirements(reqs: list) -> str:
    """Render a requirements list (dicts or strings) into searchable text."""
    lines = []
    for r in reqs:
        if isinstance(r, dict):
            req = r.get("requirement", "")
            where = r.get("where_to_secure", "")
            lines.append(req + (f" (secure at: {where})" if where else ""))
        else:
            lines.append(str(r))
    return "\n".join(lines)


def build_chunk(entry: dict, idx: int) -> dict:
    """
    Convert a services.json entry into a flat chunk dict.

    IMPORTANT — two separate concerns:
      * `embed_text`  : CONCISE service identity that gets vectorised for FAISS.
                        Leading with the service name + department maximises
                        retrieval precision. The full requirements boilerplate is
                        deliberately EXCLUDED here (many services share the same
                        requirement phrases, which dilutes identity and hurt P@1).
      * metadata      : full `requirements` + `steps` carried alongside (NOT
                        embedded) so the pipeline can still cite them in answers.
    """
    who = (entry.get("who_may_avail") or "").strip()
    who_short = who[:200]

    embed_parts = [
        entry["subservice"],                          # service name — strongest signal
        f"Department: {entry['department']}",
        f"Category: {entry['service']}",
    ]
    if who_short:
        embed_parts.append(f"Who may avail: {who_short}")
    embed_text = "\n".join(embed_parts)

    return {
        "id":            f"svc-{idx}",
        "type":          "service",
        "service":       entry["service"],
        "subservice":    entry["subservice"],
        "department":    entry["department"],
        "requirements":  entry.get("requirements", []),   # metadata (for the LLM)
        "steps":         entry.get("steps", []),           # metadata (for the LLM)
        "who_may_avail": who,
        "text":          embed_text,                        # concise — this is embedded
    }


def build_index():
    INDEX_DIR.mkdir(parents=True, exist_ok=True)
    index_path = INDEX_DIR / "faiss.index"
    meta_path  = INDEX_DIR / "metadata.jsonl"

    print("=" * 60)
    print("Geo-Agentic RAG — Building FAISS Index")
    print("=" * 60)

    # 1. Load services corpus
    print(f"\n[1/4] Loading corpus from {SERVICES_JSON}")
    if not SERVICES_JSON.exists():
        raise FileNotFoundError(f"services.json not found at {SERVICES_JSON}")
    with open(SERVICES_JSON, encoding="utf-8") as f:
        services = json.load(f)
    docs = [build_chunk(entry, i) for i, entry in enumerate(services)]
    print(f"      Chunks prepared: {len(docs)}")

    # 2. Prepare texts with passage prefix
    texts = [PASSAGE_PFX + d["text"] for d in docs]

    # 3. Embed
    print(f"\n[2/4] Loading embedding model: {MODEL_NAME}")
    model = SentenceTransformer(MODEL_NAME, device="cpu")

    print(f"[3/4] Encoding {len(texts)} passages (batch_size={BATCH_SIZE})...")
    embeddings = model.encode(
        texts,
        batch_size=BATCH_SIZE,
        show_progress_bar=True,
        normalize_embeddings=True,
        convert_to_numpy=True,
    ).astype(np.float32)
    print(f"      Embedding matrix: {embeddings.shape}")

    # 4. Build FAISS IndexFlatIP and save
    print("\n[4/4] Building FAISS IndexFlatIP and saving...")
    dim   = embeddings.shape[1]
    index = faiss.IndexFlatIP(dim)
    index.add(embeddings)
    print(f"      Vectors indexed: {index.ntotal}")

    faiss.write_index(index, str(index_path))
    print(f"      Saved index    -> {index_path}")

    with open(meta_path, "w", encoding="utf-8") as f:
        for doc in docs:
            f.write(json.dumps(doc, ensure_ascii=False) + "\n")
    print(f"      Saved metadata -> {meta_path}")

    print("\nDone. Run serve_https.py to use the full pipeline.")


if __name__ == "__main__":
    build_index()

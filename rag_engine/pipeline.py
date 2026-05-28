"""
rag_engine/pipeline.py — Geo-Agentic RAG Pipeline

Adapted from LEKS LeksPipeline (cs190-ieee-v3).
Implements the 6-stage pipeline described in Chapter 2:

  Stage 1 — Query Rewriting    : normalise Taglish / informal queries
  Stage 2 — Embedding          : multilingual-e5-large ("query: " prefix)
  Stage 3 — FAISS Vector Search: inner-product search over service index
  Stage 4 — Cross-Encoder      : BAAI/bge-reranker-base reranking
  Stage 5 — Answer Generation  : Qwen2.5:3b via Ollama  OR  Groq cloud LLM
  Stage 6 — Coordinate Resolve : returns department + grid coords (from departments.json)

LLM backend selection (controlled by .env):
  - Default                       → Ollama Qwen2.5:3b (fully local)
  - USE_GROQ=true + GROQ_API_KEY  → Stages 1 & 5 use Groq (llama-3.1-8b-instant).
                                    Stages 2/3/4 still run locally. This is the
                                    high-concurrency, low-cost dissertation-grade
                                    configuration — ~50+ concurrent users with the
                                    same RAG quality.

Usage:
    from rag_engine.pipeline import CityPipeline
    pipe   = CityPipeline()
    result = pipe.answer("paano kumuha ng business permit?")
    print(result["answer"])
    print(result["department"])
"""

import json
import os
import re
import time
from pathlib import Path

import ollama
import requests

from rag_engine.retriever import encode_query, retrieve

ROOT             = Path(__file__).resolve().parent.parent
DEPARTMENTS_JSON = ROOT / "wayfinding-app" / "data" / "departments.json"

OLLAMA_MODEL = os.getenv("OLLAMA_MODEL", "qwen2.5:3b")
OLLAMA_HOST  = os.getenv("OLLAMA_HOST",  "http://localhost:11434")

# ── Optional cloud LLM backends (Stage 5 only — embed/FAISS/rerank stay local) ─
# Priority: Groq > Gemini > Ollama (local). The first available backend wins.
#
# Groq — fast, very generous free tier (14.4k RPD on small models)
GROQ_API_KEY = os.getenv("GROQ_API_KEY", "")
GROQ_MODEL   = os.getenv("GROQ_MODEL",   "llama-3.1-8b-instant")
GROQ_URL     = "https://api.groq.com/openai/v1/chat/completions"
USE_GROQ     = (
    os.getenv("USE_GROQ", "false").lower() == "true"
    and bool(GROQ_API_KEY)
)

# Google Gemini — strong Filipino/Taglish quality, 1.5k RPD free
GEMINI_API_KEY = os.getenv("GEMINI_API_KEY", "")
GEMINI_MODEL   = os.getenv("GEMINI_MODEL",   "gemini-2.5-flash")
GEMINI_URL     = "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions"
USE_GEMINI     = (
    os.getenv("USE_GEMINI", "false").lower() == "true"
    and bool(GEMINI_API_KEY)
)


# ── Filipino / Taglish detection (from LEKS) ──────────────────────────────────
_FILIPINO_WORDS: frozenset = frozenset({
    "ano", "anong", "paano", "bakit", "sino", "saan", "kanino",
    "kung", "yung", "yun", "yan", "ito", "iyon", "dito", "doon",
    "ba", "nga", "po", "naman", "daw", "raw", "kasi", "pero",
    "at", "ng", "sa", "na", "ang", "mga", "ganito", "ganyan",
    "pwede", "pwedeng", "hindi", "wala", "walang", "mayroon", "meron",
    "para", "dahil", "kaya", "habang", "kapag", "pag", "tapos",
    "gusto", "ibig", "sabihin", "tayo", "kami", "sila", "siya",
    "ikaw", "ako", "niya", "namin", "natin", "nila", "mo", "ko",
    "ka", "rin", "din", "lang", "lamang", "talaga", "lahat", "bawat",
})

_COMMON_SHORT: frozenset = frozenset({
    "a", "i", "in", "an", "be", "by", "do", "go", "he", "if",
    "is", "it", "me", "my", "no", "of", "on", "or", "so", "to",
    "up", "us", "we", "vs", "the", "and", "for", "are", "has",
    "its", "may", "can", "did", "not", "was", "get", "how",
})

_VOWELS: frozenset = frozenset("aeiou")


def _needs_rewrite(query: str) -> bool:
    words   = query.strip().split()
    if len(words) <= 2:
        return True
    cleaned = [w.lower().strip("?.,!;:()\"'") for w in words]
    if any(w in _FILIPINO_WORDS for w in cleaned):
        return True
    for token in cleaned:
        if len(token) < 2 or token in _COMMON_SHORT:
            continue
        vowels = sum(1 for c in token if c in _VOWELS)
        if vowels == 0:
            return True
        if len(token) >= 5 and vowels / len(token) < 0.15:
            return True
    return False


# ── Prompt templates ──────────────────────────────────────────────────────────

_REWRITE_PROMPT = (
    "You are an assistant for a Philippine city government office. "
    "Rewrite the following query into a single, complete question "
    "using clear English suitable for searching city hall services.\n\n"
    "Rules:\n"
    "- Output a full question ending with '?'\n"
    "- Preserve the original intent exactly\n"
    "- Translate Filipino/Taglish to English\n"
    "- Return ONLY the rewritten question, nothing else.\n\n"
    "Query: {query}\n\nRewritten query:"
)

_RAG_PROMPT = (
    "You are a helpful assistant for Calamba City Hall.\n"
    "Answer the citizen's question using ONLY the service information provided below.\n\n"
    "STRICT RULES:\n"
    "1. Use ONLY the information in the Context. Do not add steps or requirements from memory.\n"
    "2. If multiple sub-services match, list the options and ask which one the user needs.\n"
    "3. When giving steps, be concise and end your answer with exactly:\n"
    "   Go to: [DEPARTMENT NAME]\n"
    "   (use the exact department name from the context)\n"
    "4. If the context does not contain enough information, say: "
    "'I could not find that service in the Calamba City Hall directory.'\n\n"
    "Context:\n{context}\n\n"
    "Question: {question}\n\nAnswer:"
)

_NORAG_PROMPT = (
    "You are a helpful assistant for Calamba City Hall.\n"
    "Question: {question}\n\nAnswer:"
)


# ── Context formatting ────────────────────────────────────────────────────────

def _format_context(chunks: list[dict]) -> str:
    parts = []
    for i, c in enumerate(chunks, 1):
        parts.append(
            f"[{i}] Sub-service: {c['subservice']}\n"
            f"    Department:  {c['department']}\n"
            f"    {c['text'].split('Steps:')[-1].strip()}"
        )
    return "\n\n".join(parts)


# ── Hallucination filter ──────────────────────────────────────────────────────

def _strip_hallucinated_depts(answer: str, chunks: list[dict]) -> str:
    """
    Remove any 'Go to: [DEPT]' line whose department does not appear
    in the retrieved chunks — prevents the model from directing users
    to an office not supported by the retrieved context.
    """
    valid_depts = {c["department"].upper() for c in chunks}
    lines = answer.splitlines()
    filtered = []
    for line in lines:
        m = re.match(r"Go to:\s*(.+)", line, re.IGNORECASE)
        if m:
            dept = m.group(1).strip().upper()
            if not any(dept in vd or vd in dept for vd in valid_depts):
                continue  # drop hallucinated department line
        filtered.append(line)
    return "\n".join(filtered)


# ── Department coordinate resolution ─────────────────────────────────────────

def _load_departments() -> dict:
    if DEPARTMENTS_JSON.exists():
        with open(DEPARTMENTS_JSON, encoding="utf-8") as f:
            return json.load(f)
    return {}


# ── Pipeline ──────────────────────────────────────────────────────────────────

class CityPipeline:
    """
    Full 6-stage local RAG pipeline for Calamba City Hall services.
    Requires Ollama running with qwen2.5:3b pulled.
    """

    def __init__(self):
        # Backend selection: Groq > Gemini > Ollama (first available wins)
        self._use_groq   = USE_GROQ
        self._use_gemini = USE_GEMINI and not USE_GROQ

        if self._use_groq:
            self._client = None
            print(f"[Pipeline] LLM backend: Groq ({GROQ_MODEL}) — local embed + rerank + FAISS")
            return

        if self._use_gemini:
            self._client = None
            print(f"[Pipeline] LLM backend: Google Gemini ({GEMINI_MODEL}) — local embed + rerank + FAISS")
            return

        # Local LLM mode (default) — validate Ollama is up
        self._client = ollama.Client(host=OLLAMA_HOST)
        try:
            self._client.show(OLLAMA_MODEL)
        except ollama.ResponseError as e:
            raise RuntimeError(
                f"Model '{OLLAMA_MODEL}' not found in Ollama.\n"
                f"Run:  ollama pull {OLLAMA_MODEL}"
            ) from e
        except Exception as e:
            raise RuntimeError(
                f"Cannot connect to Ollama at {OLLAMA_HOST}.\n"
                f"Make sure Ollama is installed and running."
            ) from e
        print(f"[Pipeline] LLM backend: Ollama ({OLLAMA_MODEL})")

    def _generate(self, prompt: str, num_predict: int = 512) -> str:
        """Generate text — routes to Groq, Gemini, or Ollama."""
        if self._use_groq:
            return self._generate_groq(prompt, max_tokens=num_predict)
        if self._use_gemini:
            return self._generate_gemini(prompt, max_tokens=num_predict)
        response = self._client.generate(
            model=OLLAMA_MODEL,
            prompt=prompt,
            options={"temperature": 0.15, "num_predict": num_predict, "num_ctx": 4096},
        )
        return response.response.strip()

    def _generate_groq(self, prompt: str, max_tokens: int = 512) -> str:
        """Call Groq's OpenAI-compatible chat API."""
        return self._call_openai_compatible(
            GROQ_URL, GROQ_API_KEY, GROQ_MODEL, prompt, max_tokens, "Groq"
        )

    def _generate_gemini(self, prompt: str, max_tokens: int = 512) -> str:
        """Call Google Gemini via the OpenAI-compatible endpoint."""
        return self._call_openai_compatible(
            GEMINI_URL, GEMINI_API_KEY, GEMINI_MODEL, prompt, max_tokens, "Gemini"
        )

    def _call_openai_compatible(self, url, api_key, model, prompt, max_tokens, provider_name):
        """Shared call for any OpenAI-compatible chat completions API."""
        try:
            r = requests.post(
                url,
                headers={
                    "Authorization": f"Bearer {api_key}",
                    "Content-Type":  "application/json",
                },
                json={
                    "model":       model,
                    "messages":    [{"role": "user", "content": prompt}],
                    "temperature": 0.15,
                    "max_tokens":  max_tokens,
                },
                timeout=30,
            )
            r.raise_for_status()
            return r.json()["choices"][0]["message"]["content"].strip()
        except requests.HTTPError as e:
            if e.response is not None and e.response.status_code == 429:
                return "I'm a bit busy right now — please try again in a moment."
            raise
        except Exception as e:
            raise RuntimeError(f"{provider_name} call failed: {e}") from e

    def query_rewrite(self, query: str) -> str:
        """Stage 1: normalise informal/Taglish queries to formal English."""
        if not _needs_rewrite(query):
            return query
        rewritten = self._generate(_REWRITE_PROMPT.format(query=query), num_predict=64)
        # Guard: if the LLM call failed (rate-limit fallback message, error text,
        # or too-short output), fall back to the ORIGINAL query so retrieval is
        # never polluted by an error string.
        low = rewritten.lower()
        if ("busy right now" in low
                or "call failed" in low
                or "error" in low
                or len(rewritten.split()) <= 4):
            return query
        return rewritten

    def answer(
        self,
        query: str,
        top_k: int = 5,
        use_reranker: bool = True,
        use_rag: bool = True,
        history: list[dict] | None = None,
    ) -> dict:
        """
        Run the full pipeline and return a structured result dict.

        Returns:
            {
              "query"          : original query,
              "rewritten_query": normalised query,
              "answer"         : generated answer string,
              "department"     : top-match department name (or None),
              "subservice"     : top-match sub-service name (or None),
              "location"       : { floor, row, col } or None,
              "chunks"         : retrieved chunk dicts,
              "needsContext"   : True if answer is a clarification prompt,
              "latency_ms"     : total wall-clock time,
            }
        """
        t_start  = time.perf_counter()
        chunks   = []
        rewritten = None

        if use_rag:
            # Stage 1 — Query rewriting
            rewritten = self.query_rewrite(query)

            # Stage 2 — Embedding
            q_vec = encode_query(rewritten)

            # Stage 3+4 — FAISS search + Cross-Encoder reranking
            chunks = retrieve(rewritten, top_k=top_k,
                              use_reranker=use_reranker, q_vec=q_vec)

            # Stage 5 — Answer generation
            context = _format_context(chunks)
            prompt  = _RAG_PROMPT.format(context=context, question=rewritten)
            answer  = self._generate(prompt)

            # Hallucination filter
            answer = _strip_hallucinated_depts(answer, chunks)

        else:
            answer = self._generate(_NORAG_PROMPT.format(question=query))

        latency_ms = round((time.perf_counter() - t_start) * 1000, 1)

        # Stage 6 — Coordinate resolution
        is_clarifying = bool(re.search(
            r"which.*service|which.*permit|could you specify|please clarify|"
            r"which one|please choose|select one",
            answer, re.IGNORECASE
        ))

        top_dept    = chunks[0]["department"] if chunks and not is_clarifying else None
        top_sub     = chunks[0]["subservice"] if chunks and not is_clarifying else None
        depts       = _load_departments()
        location    = depts.get(top_dept) if top_dept else None
        # Null location means fieldwork mapping not yet done
        if location and location.get("floor") is None:
            location = None

        return {
            "query":           query,
            "rewritten_query": rewritten,
            "answer":          answer,
            "department":      top_dept,
            "subservice":      top_sub,
            "location":        location,
            "needsContext":    is_clarifying,
            "options":         [],
            "chunks":          chunks,
            "latency_ms":      latency_ms,
        }

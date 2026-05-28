#!/usr/bin/env python3
"""
HTTPS dev server for wayfinding-app.
Uses a mkcert-generated cert if present (no browser warning after mkcert -install).
Falls back to a self-signed cert via openssl (one-time browser warning).

To get zero browser warnings:
  1. Run  mkcert.exe -install  once (requires admin / UAC approval)
  2. Restart this server — it will auto-detect the mkcert cert.
"""

import http.server, ssl, subprocess, os, sys, socket, shutil, json, re
import socketserver, threading
from datetime import datetime, timedelta, timezone
from collections import defaultdict
try:
    import urllib.request as _urlreq
except ImportError:
    pass

# ── Load .env from repo root (local dev config, never committed) ──────────────
try:
    from dotenv import load_dotenv as _load_dotenv
    _load_dotenv(os.path.join(
        os.path.dirname(os.path.dirname(os.path.abspath(__file__))), '.env'
    ))
except ImportError:
    pass   # dotenv not installed — env vars must be set manually

# ── Try to load the full FAISS pipeline; fall back to keyword search ──────────
_PIPELINE      = None
_PIPELINE_LOCK = threading.Lock()
_LOG_LOCK      = threading.Lock()

def _init_pipeline():
    global _PIPELINE
    if _PIPELINE is not None:          # fast path — no lock needed once initialised
        return True
    with _PIPELINE_LOCK:               # only one thread initialises
        if _PIPELINE is not None:      # double-checked locking
            return True
        try:
            _repo_root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
            if _repo_root not in sys.path:
                sys.path.insert(0, _repo_root)
            from rag_engine.pipeline import CityPipeline
            _PIPELINE = CityPipeline()
            print('[RAG] Full pipeline loaded (FAISS + e5-large + bge-reranker + Ollama)')
            return True
        except Exception as e:
            print(f'[RAG] Full pipeline unavailable ({e}); using keyword fallback')
            return False

PORT     = 3001
BASE_DIR = os.path.dirname(os.path.abspath(__file__))

# mkcert cert takes priority (trusted, no browser warning)
MKCERT   = os.path.join(BASE_DIR, 'localhost+2.pem')
MKCERT_K = os.path.join(BASE_DIR, 'localhost+2-key.pem')

# fallback self-signed cert
CERT     = os.path.join(BASE_DIR, 'cert.pem')
KEY      = os.path.join(BASE_DIR, 'key.pem')
CFG      = os.path.join(BASE_DIR, 'san.cnf')

# ── helpers ───────────────────────────────────────────────────────────────────

def get_local_ip():
    s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    try:
        s.connect(('8.8.8.8', 80))
        return s.getsockname()[0]
    except Exception:
        return '127.0.0.1'
    finally:
        s.close()

def find_openssl():
    found = shutil.which('openssl')
    if found:
        return found
    for c in [r'C:\Program Files\Git\usr\bin\openssl.exe',
              r'C:\Program Files (x86)\Git\usr\bin\openssl.exe']:
        if os.path.exists(c):
            return c
    return None

def generate_self_signed(ip, openssl_path):
    with open(CFG, 'w') as f:
        f.write(
            '[req]\ndistinguished_name=dn\nprompt=no\n'
            '[dn]\nCN=' + ip + '\n'
            '[san]\nsubjectAltName=IP:' + ip + ',DNS:localhost\n'
        )
    result = subprocess.run([
        openssl_path, 'req', '-x509', '-newkey', 'rsa:2048',
        '-keyout', KEY, '-out', CERT,
        '-days', '365', '-nodes',
        '-subj', f'/CN={ip}',
        '-extensions', 'san',
        '-config', CFG,
    ], capture_output=True)
    if os.path.exists(CFG):
        os.remove(CFG)
    if result.returncode != 0:
        print('openssl error:\n', result.stderr.decode(errors='replace'))
        sys.exit(1)

# ── choose cert ───────────────────────────────────────────────────────────────

ip = get_local_ip()

if os.path.exists(MKCERT) and os.path.exists(MKCERT_K):
    cert_file, key_file = MKCERT, MKCERT_K
    trusted = True
else:
    cert_file, key_file = CERT, KEY
    trusted = False
    if not os.path.exists(CERT) or not os.path.exists(KEY):
        openssl = find_openssl()
        if not openssl:
            print('ERROR: openssl not found. Install Git for Windows.')
            sys.exit(1)
        print(f'Generating self-signed cert for {ip} ...')
        generate_self_signed(ip, openssl)
        print('Done.\n')

# ── start server ──────────────────────────────────────────────────────────────

print('=' * 55)
print('  HTTPS server running on:')
print(f'    https://localhost:{PORT}      (this machine)')
print(f'    https://{ip}:{PORT}   (phone / other device)')
print()
if trusted:
    print('  Cert is trusted — no browser warning.')
else:
    print('  Self-signed cert — accept the warning once.')
    print('  (Advanced -> Proceed to ... unsafe)')
    print()
    print('  To remove the warning permanently:')
    print('    Run mkcert.exe -install  (as administrator)')
    print('    Then restart this server.')
print('=' * 55)

# Show which LLM backend will be used (resolved after .env is loaded).
# Mirrors the pipeline priority: Groq > Gemini > Ollama.
_use_groq_banner   = os.getenv('USE_GROQ', 'false').lower() == 'true' and bool(os.getenv('GROQ_API_KEY'))
_use_gemini_banner = os.getenv('USE_GEMINI', 'false').lower() == 'true' and bool(os.getenv('GEMINI_API_KEY'))
if _use_groq_banner:
    _llm_label = f'Groq ({os.getenv("GROQ_MODEL", "llama-3.1-8b-instant")})'
elif _use_gemini_banner:
    _llm_label = f'Gemini ({os.getenv("GEMINI_MODEL", "gemini-2.5-flash")})'
else:
    _llm_label = f'Ollama ({os.getenv("OLLAMA_MODEL", "qwen2.5:3b")})'
print(f'  LLM backend  : {_llm_label}')
print(f'  Analytics    : https://localhost:{PORT}/admin.html')
print('=' * 55)

os.chdir(BASE_DIR)

STATE_FILE    = os.path.join(BASE_DIR, 'app-state.json')
SERVICES_FILE = os.path.join(BASE_DIR, 'data', 'services.json')
QUERY_LOG     = os.path.join(BASE_DIR, 'query_log.jsonl')

# ── LLM backend (read from .env or environment) ───────────────────────────────
_OLLAMA_HOST  = os.getenv('OLLAMA_HOST', 'http://localhost:11434')
OLLAMA_URL    = _OLLAMA_HOST.rstrip('/') + '/api/chat'
OLLAMA_MODEL  = os.getenv('OLLAMA_MODEL', 'qwen2.5:3b')

# Optional Groq fallback — used in keyword path when USE_GROQ=true
GROQ_API_KEY  = os.getenv('GROQ_API_KEY', '')
GROQ_MODEL    = os.getenv('GROQ_MODEL',   'llama-3.1-8b-instant')
GROQ_URL      = 'https://api.groq.com/openai/v1/chat/completions'
# USE_GROQ activates only when key is present AND explicitly enabled
USE_GROQ      = os.getenv('USE_GROQ', 'false').lower() == 'true' and bool(GROQ_API_KEY)

# ── Local RAG helpers ─────────────────────────────────────────────────────────

def _load_services():
    try:
        with open(SERVICES_FILE, 'r', encoding='utf-8') as f:
            return json.load(f)
    except Exception:
        return []

def _rag_search(services, query, top_n=5):
    tokens = [t for t in re.split(r'\s+', query.lower()) if len(t) > 2]
    if not tokens:
        return services[:top_n], False, []
    def score(entry):
        blob = ' '.join([entry.get('service',''), entry.get('subservice',''),
                         entry.get('department','')] + entry.get('steps',[])).lower()
        return sum(1 for t in tokens if t in blob)
    scored = sorted(services, key=score, reverse=True)
    top    = scored[:top_n]
    top_score = score(top[0]) if top else 0
    tied  = [e for e in top if score(e) >= max(top_score - 1, 1)]
    unique_sub = list(dict.fromkeys(e['subservice'] for e in tied))
    ambiguous  = len(unique_sub) > 2
    return top, ambiguous, unique_sub[:6] if ambiguous else []

def _build_context(results):
    parts = []
    for r in results:
        parts.append(
            f"Service: {r.get('service','')}\n"
            f"Sub-service: {r.get('subservice','')}\n"
            f"Department: {r.get('department','')}\n"
            f"Steps:\n" + '\n'.join(r.get('steps', []))
        )
    return '\n\n---\n\n'.join(parts)

SYSTEM_PROMPT = """You are a helpful assistant for Calamba City Hall.
Answer questions about city government services using ONLY the provided context.

Rules:
1. LANGUAGE: Reply in the SAME language as the user's question. If they ask in Filipino or
   Taglish (mixed Tagalog-English), answer in natural conversational Taglish like a friendly
   City Hall staff. If they ask in English, answer in English. Keep office names, form names,
   and "(secure at: ...)" notes exactly as in the context.
2. If the query matches MULTIPLE different sub-services, list the options clearly and ask which one they need.
3. Only provide detailed steps once the specific sub-service is clear.
4. When giving steps, always end with "Go to: [EXACT DEPARTMENT NAME]".
5. If unrelated to city services, say you can only help with Calamba City Hall services.
6. Keep answers concise and scannable: a one-line intro, then a numbered list, one item per line."""

def _call_ollama(messages):
    payload = json.dumps({
        'model': OLLAMA_MODEL,
        'messages': messages,
        'stream': False,
        'options': {'temperature': 0.3}
    }).encode('utf-8')
    req = _urlreq.Request(OLLAMA_URL, data=payload,
                          headers={'Content-Type': 'application/json'},
                          method='POST')
    try:
        with _urlreq.urlopen(req, timeout=60) as resp:
            data = json.loads(resp.read())
            return data.get('message', {}).get('content', 'No answer returned.')
    except Exception as e:
        return f'Ollama error: {e}'


def _call_groq(messages):
    """Call Groq API (OpenAI-compatible). Active only when USE_GROQ=true in .env."""
    payload = json.dumps({
        'model':      GROQ_MODEL,
        'messages':   messages,
        'temperature': 0.3,
        'max_tokens':  500,
    }).encode('utf-8')
    req = _urlreq.Request(GROQ_URL, data=payload,
                          headers={
                              'Content-Type':  'application/json',
                              'Authorization': f'Bearer {GROQ_API_KEY}',
                          },
                          method='POST')
    try:
        with _urlreq.urlopen(req, timeout=30) as resp:
            data = json.loads(resp.read())
            return data.get('choices', [{}])[0].get('message', {}).get('content', 'No answer returned.')
    except Exception as e:
        return f'Groq error: {e}'


def _call_llm(messages):
    """Route to Groq or Ollama based on .env / environment configuration."""
    if USE_GROQ:
        return _call_groq(messages)
    return _call_ollama(messages)

def _handle_rag(query, history):
    out = None

    # ── Full pipeline (FAISS + embeddings + reranker + Ollama) ───────────────
    if _init_pipeline() and _PIPELINE is not None:
        try:
            result = _PIPELINE.answer(query, top_k=5, use_reranker=True, history=history)
            out = {
                'answer':       result['answer'],
                'department':   result['department'],
                'subservice':   result['subservice'],
                'needsContext': result['needsContext'],
                'options':      result['options'],
                'rewritten':    result['rewritten_query'],
                'latency_ms':   result['latency_ms'],
            }
        except Exception as e:
            print(f'[RAG] Pipeline error: {e}; falling back to keyword search')

    # ── Keyword fallback (no FAISS index / Ollama not running) ───────────────
    if out is None:
        services = _load_services()
        results, ambiguous, options = _rag_search(services, query)
        context  = _build_context(results)
        messages = [{'role': 'system', 'content': SYSTEM_PROMPT}]
        messages += (history or [])[-6:]
        messages.append({'role': 'user',
                         'content': f'Context:\n{context}\n\nUser question: {query}'})
        raw    = _call_llm(messages)
        answer = re.sub(r'<think>[\s\S]*?</think>', '', raw, flags=re.IGNORECASE).strip()
        is_asking = ambiguous or bool(re.search(
            r'which.*service|which.*permit|could you specify|please clarify|which one',
            answer, re.IGNORECASE))
        top = results[0] if results and not is_asking else {}
        out = {
            'answer':       answer,
            'department':   top.get('department') if not is_asking else None,
            'subservice':   top.get('subservice') if not is_asking else None,
            'needsContext': is_asking,
            'options':      options,
            'rewritten':    None,
            'latency_ms':   None,
        }

    # ── Log interaction ───────────────────────────────────────────────────────
    _log_query({
        'timestamp':    datetime.now(timezone.utc).isoformat(),
        'query':        query,
        'rewritten':    out.get('rewritten'),
        'department':   out.get('department'),
        'subservice':   out.get('subservice'),
        'needsContext': bool(out.get('needsContext')),
        'latency_ms':   out.get('latency_ms'),
    })
    return out

# ── Analytics helpers ─────────────────────────────────────────────────────────

def _log_query(entry):
    """Append one JSON line to query_log.jsonl (thread-safe)."""
    try:
        with _LOG_LOCK:
            with open(QUERY_LOG, 'a', encoding='utf-8') as f:
                f.write(json.dumps(entry, ensure_ascii=False) + '\n')
    except Exception as e:
        print(f'[LOG] Warning: could not write query log: {e}')


def _get_analytics():
    """Read query_log.jsonl and return aggregated stats."""
    lines = []
    try:
        with open(QUERY_LOG, 'r', encoding='utf-8') as f:
            for raw in f:
                raw = raw.strip()
                if raw:
                    try:
                        lines.append(json.loads(raw))
                    except json.JSONDecodeError:
                        pass
    except FileNotFoundError:
        pass

    total = len(lines)

    # Department counts
    dept_counts = defaultdict(int)
    for l in lines:
        d = l.get('department')
        if d:
            dept_counts[d] += 1
    top_depts = sorted(dept_counts.items(), key=lambda x: x[1], reverse=True)[:10]

    # Sub-service counts
    sub_counts = defaultdict(int)
    for l in lines:
        s = l.get('subservice')
        if s:
            sub_counts[s] += 1
    top_subs = sorted(sub_counts.items(), key=lambda x: x[1], reverse=True)[:10]

    # Queries per day — last 7 days
    day_counts = defaultdict(int)
    for l in lines:
        ts = l.get('timestamp', '')
        day = ts[:10] if ts else 'unknown'
        day_counts[day] += 1
    today_date = datetime.now(timezone.utc).date()
    days = [(today_date - timedelta(days=i)).isoformat() for i in range(6, -1, -1)]
    queries_per_day = [{'date': d, 'count': day_counts.get(d, 0)} for d in days]

    # Summary stats
    ambiguous    = sum(1 for l in lines if l.get('needsContext'))
    latencies    = [l['latency_ms'] for l in lines if l.get('latency_ms') is not None]
    avg_latency  = round(sum(latencies) / len(latencies), 1) if latencies else 0
    today_count  = day_counts.get(today_date.isoformat(), 0)

    return {
        'total':          total,
        'today':          today_count,
        'ambiguityRate':  round(ambiguous / total * 100, 1) if total else 0,
        'avgLatency':     avg_latency,
        'topDepartments': [{'name': k, 'count': v} for k, v in top_depts],
        'topSubservices': [{'name': k, 'count': v} for k, v in top_subs],
        'queriesPerDay':  queries_per_day,
        'recentQueries':  list(reversed(lines[-20:])),
    }


class Handler(http.server.SimpleHTTPRequestHandler):
    """Static file server + /api/state GET/POST for cross-device grid sync."""

    def do_GET(self):
        if self.path == '/api/state':
            try:
                with open(STATE_FILE, 'r', encoding='utf-8') as f:
                    data = f.read()
            except FileNotFoundError:
                data = '{}'
            body = data.encode('utf-8')
            self.send_response(200)
            self.send_header('Content-Type', 'application/json')
            self.send_header('Content-Length', str(len(body)))
            self.end_headers()
            self.wfile.write(body)
        elif self.path == '/api/analytics':
            body = json.dumps(_get_analytics()).encode('utf-8')
            self.send_response(200)
            self.send_header('Content-Type', 'application/json')
            self.send_header('Access-Control-Allow-Origin', '*')
            self.send_header('Content-Length', str(len(body)))
            self.end_headers()
            self.wfile.write(body)
        else:
            super().do_GET()

    def do_POST(self):
        length = int(self.headers.get('Content-Length', 0))
        body   = self.rfile.read(length)

        if self.path == '/api/state':
            try:
                json.loads(body)
                with open(STATE_FILE, 'wb') as f:
                    f.write(body)
                resp = b'{"ok":true}'
                self.send_response(200)
                self.send_header('Content-Type', 'application/json')
                self.send_header('Content-Length', str(len(resp)))
                self.end_headers()
                self.wfile.write(resp)
            except Exception:
                self.send_response(400)
                self.end_headers()

        elif self.path == '/api/chat':
            try:
                payload = json.loads(body)
                result  = _handle_rag(payload.get('query',''),
                                      payload.get('history', []))
                resp = json.dumps(result).encode('utf-8')
                self.send_response(200)
                self.send_header('Content-Type', 'application/json')
                self.send_header('Access-Control-Allow-Origin', '*')
                self.send_header('Content-Length', str(len(resp)))
                self.end_headers()
                self.wfile.write(resp)
            except Exception as e:
                err = json.dumps({'error': str(e)}).encode('utf-8')
                self.send_response(500)
                self.send_header('Content-Type', 'application/json')
                self.send_header('Content-Length', str(len(err)))
                self.end_headers()
                self.wfile.write(err)

        else:
            self.send_response(404)
            self.end_headers()

    def do_OPTIONS(self):
        self.send_response(200)
        self.send_header('Access-Control-Allow-Origin',  '*')
        self.send_header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
        self.send_header('Access-Control-Allow-Headers', 'Content-Type')
        self.end_headers()

    def log_message(self, fmt, *args):
        # Only log API calls; suppress noisy static-file lines
        if args and '/api/' in str(args[0]):
            super().log_message(fmt, *args)

# Each incoming connection gets its own thread — prevents one slow Ollama call
# from blocking every other request (e.g. static files, state sync, analytics).
class _ThreadingHTTPServer(socketserver.ThreadingMixIn, http.server.HTTPServer):
    daemon_threads = True   # threads die cleanly when the server stops

httpd = _ThreadingHTTPServer(('0.0.0.0', PORT), Handler)
ctx = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
ctx.load_cert_chain(cert_file, key_file)
httpd.socket = ctx.wrap_socket(httpd.socket, server_side=True)
httpd.serve_forever()

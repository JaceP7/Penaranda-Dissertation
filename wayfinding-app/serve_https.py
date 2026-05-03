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
try:
    import urllib.request as _urlreq
except ImportError:
    pass

# ── Try to load the full FAISS pipeline; fall back to keyword search ──────────
_PIPELINE = None
def _init_pipeline():
    global _PIPELINE
    if _PIPELINE is not None:
        return True
    try:
        # Add repo root to path so rag_engine is importable
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

os.chdir(BASE_DIR)

STATE_FILE    = os.path.join(BASE_DIR, 'app-state.json')
SERVICES_FILE = os.path.join(BASE_DIR, 'data', 'services.json')
OLLAMA_URL    = 'http://localhost:11434/api/chat'
OLLAMA_MODEL  = 'qwen2.5:3b'   # change if you pulled a different tag

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
1. If the query matches MULTIPLE different sub-services, list the options clearly and ask which one they need.
2. Only provide detailed steps once the specific sub-service is clear.
3. When giving steps, always end with "Go to: [EXACT DEPARTMENT NAME]".
4. If unrelated to city services, say you can only help with Calamba City Hall services.
5. Keep answers concise."""

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

def _handle_rag(query, history):
    # ── Full pipeline (FAISS + embeddings + reranker + Ollama) ───────────────
    if _init_pipeline() and _PIPELINE is not None:
        try:
            result = _PIPELINE.answer(query, top_k=5, use_reranker=True)
            return {
                'answer':      result['answer'],
                'department':  result['department'],
                'subservice':  result['subservice'],
                'needsContext': result['needsContext'],
                'options':     result['options'],
                'rewritten':   result['rewritten_query'],
                'latency_ms':  result['latency_ms'],
            }
        except Exception as e:
            print(f'[RAG] Pipeline error: {e}; falling back to keyword search')

    # ── Keyword fallback (no FAISS index / Ollama not running) ───────────────
    services = _load_services()
    results, ambiguous, options = _rag_search(services, query)
    context  = _build_context(results)
    messages = [{'role': 'system', 'content': SYSTEM_PROMPT}]
    messages += (history or [])[-6:]
    messages.append({'role': 'user',
                     'content': f'Context:\n{context}\n\nUser question: {query}'})
    raw    = _call_ollama(messages)
    answer = re.sub(r'<think>[\s\S]*?</think>', '', raw, flags=re.IGNORECASE).strip()
    is_asking = ambiguous or bool(re.search(
        r'which.*service|which.*permit|could you specify|please clarify|which one',
        answer, re.IGNORECASE))
    top = results[0] if results and not is_asking else {}
    return {
        'answer':      answer,
        'department':  top.get('department') if not is_asking else None,
        'subservice':  top.get('subservice') if not is_asking else None,
        'needsContext': is_asking,
        'options':     options
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

httpd = http.server.HTTPServer(('0.0.0.0', PORT), Handler)
ctx = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
ctx.load_cert_chain(cert_file, key_file)
httpd.socket = ctx.wrap_socket(httpd.socket, server_side=True)
httpd.serve_forever()

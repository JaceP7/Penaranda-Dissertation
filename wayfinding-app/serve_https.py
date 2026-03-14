#!/usr/bin/env python3
"""
HTTPS dev server for wayfinding-app.
Uses a mkcert-generated cert if present (no browser warning after mkcert -install).
Falls back to a self-signed cert via openssl (one-time browser warning).

To get zero browser warnings:
  1. Run  mkcert.exe -install  once (requires admin / UAC approval)
  2. Restart this server — it will auto-detect the mkcert cert.
"""

import http.server, ssl, subprocess, os, sys, socket, shutil, json

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

STATE_FILE = os.path.join(BASE_DIR, 'app-state.json')

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
        if self.path == '/api/state':
            length = int(self.headers.get('Content-Length', 0))
            body   = self.rfile.read(length)
            try:
                json.loads(body)          # validate before writing
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

#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# setup.sh — Geo-Agentic RAG VM bootstrap script
# Run ONCE on a fresh Ubuntu 22.04 / 24.04 ARM instance.
#
# Usage:
#   chmod +x setup.sh
#   ./setup.sh
#
# What it does:
#   1. Updates system packages
#   2. Opens firewall for HTTP/HTTPS
#   3. Installs Python 3.11 + venv + git + nginx + certbot
#   4. Clones the wayfinding-app repo (you'll be prompted for URL)
#   5. Creates a Python virtualenv
#   6. Installs all Python dependencies (ARM-compatible)
#   7. Configures nginx as reverse proxy
#   8. Creates systemd service for auto-restart
#
# Logs to ~/setup.log
# ─────────────────────────────────────────────────────────────────────────────

set -euo pipefail

LOG_FILE="$HOME/setup.log"
APP_DIR="$HOME/wayfinding-app"
VENV_DIR="$HOME/wayfinding-env"
SERVICE_NAME="wayfinding"

echo "===== setup.sh started $(date) =====" | tee -a "$LOG_FILE"

# ── 1. Update system ──────────────────────────────────────────────────────────
echo "→ Updating system packages..." | tee -a "$LOG_FILE"
sudo apt-get update -qq | tee -a "$LOG_FILE"
sudo DEBIAN_FRONTEND=noninteractive apt-get upgrade -y -qq | tee -a "$LOG_FILE"

# ── 2. Firewall ───────────────────────────────────────────────────────────────
echo "→ Configuring firewall..." | tee -a "$LOG_FILE"
sudo ufw --force enable
sudo ufw allow OpenSSH
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp
sudo ufw reload

# Oracle Cloud also requires opening ports in the VCN security list via web console.
# Reminder shown at the end.

# ── 3. Install dependencies ───────────────────────────────────────────────────
echo "→ Installing system dependencies..." | tee -a "$LOG_FILE"
sudo apt-get install -y \
    python3.11 python3.11-venv python3.11-dev \
    git curl wget \
    nginx certbot python3-certbot-nginx \
    build-essential pkg-config \
    libssl-dev libffi-dev \
    | tee -a "$LOG_FILE"

# ── 4. Clone the repo ─────────────────────────────────────────────────────────
if [ ! -d "$APP_DIR/.git" ]; then
    echo "→ Cloning repo..." | tee -a "$LOG_FILE"
    read -p "Enter the git URL of your wayfinding-app repo: " REPO_URL
    git clone "$REPO_URL" "$APP_DIR" | tee -a "$LOG_FILE"
else
    echo "→ Repo already exists, pulling latest..." | tee -a "$LOG_FILE"
    cd "$APP_DIR" && git pull
fi

# ── 5. Create virtualenv ──────────────────────────────────────────────────────
echo "→ Creating Python virtual environment..." | tee -a "$LOG_FILE"
python3.11 -m venv "$VENV_DIR"
# shellcheck disable=SC1090
source "$VENV_DIR/bin/activate"

pip install --upgrade pip setuptools wheel | tee -a "$LOG_FILE"

# ── 6. Install Python deps (ARM-compatible) ───────────────────────────────────
echo "→ Installing Python packages (this takes ~10 minutes on ARM)..." | tee -a "$LOG_FILE"

# Use PyTorch's CPU-only wheels (no CUDA, smaller download, works on ARM)
pip install torch --index-url https://download.pytorch.org/whl/cpu | tee -a "$LOG_FILE"

# Core ML + RAG stack
pip install \
    sentence-transformers \
    faiss-cpu \
    transformers \
    requests \
    python-dotenv \
    | tee -a "$LOG_FILE"

# Optional Ollama client (not needed in cloud mode, but kept for parity)
pip install ollama || echo "Ollama package skipped (not critical in cloud mode)"

# ── 7. Configure nginx as reverse proxy ───────────────────────────────────────
echo "→ Writing nginx config..." | tee -a "$LOG_FILE"

read -p "Enter your domain (e.g., wayfinding.duckdns.org) or press Enter to skip: " DOMAIN
DOMAIN=${DOMAIN:-_}

sudo tee /etc/nginx/sites-available/wayfinding > /dev/null <<EOF
server {
    listen 80;
    server_name $DOMAIN;

    client_max_body_size 10M;

    # Reverse proxy to the Python server
    location / {
        proxy_pass http://127.0.0.1:3001;
        proxy_http_version 1.1;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;

        # Allow long-running RAG queries
        proxy_read_timeout 60s;
        proxy_connect_timeout 10s;
        proxy_send_timeout 60s;

        # Forward upgrade headers for any future WebSocket use
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection "upgrade";
    }

    # Health check endpoint
    location /healthz {
        access_log off;
        return 200 "ok\n";
    }
}
EOF

sudo ln -sf /etc/nginx/sites-available/wayfinding /etc/nginx/sites-enabled/wayfinding
sudo rm -f /etc/nginx/sites-enabled/default
sudo nginx -t | tee -a "$LOG_FILE"
sudo systemctl restart nginx

# ── 8. Create systemd service ─────────────────────────────────────────────────
echo "→ Creating systemd service..." | tee -a "$LOG_FILE"

# Find the python server file (could be in app root or wayfinding-app subdir)
if [ -f "$APP_DIR/wayfinding-app/serve_https.py" ]; then
    SERVER_PATH="$APP_DIR/wayfinding-app/serve_https.py"
    WORK_DIR="$APP_DIR"
elif [ -f "$APP_DIR/serve_https.py" ]; then
    SERVER_PATH="$APP_DIR/serve_https.py"
    WORK_DIR="$APP_DIR"
else
    echo "ERROR: Cannot find serve_https.py. Check your repo structure." | tee -a "$LOG_FILE"
    exit 1
fi

sudo tee /etc/systemd/system/wayfinding.service > /dev/null <<EOF
[Unit]
Description=Geo-Agentic RAG Wayfinding Backend
After=network.target

[Service]
Type=simple
User=ubuntu
WorkingDirectory=$WORK_DIR
EnvironmentFile=$WORK_DIR/.env
ExecStart=$VENV_DIR/bin/python $SERVER_PATH
Restart=always
RestartSec=10
StandardOutput=append:/var/log/wayfinding.log
StandardError=append:/var/log/wayfinding-error.log

# Memory protection (Oracle Free has 24 GB, plenty)
MemoryHigh=6G
MemoryMax=12G

[Install]
WantedBy=multi-user.target
EOF

# Create the log files with right permissions
sudo touch /var/log/wayfinding.log /var/log/wayfinding-error.log
sudo chown ubuntu:ubuntu /var/log/wayfinding*.log

# Touch .env if it doesn't exist (user fills in Phase 5)
if [ ! -f "$WORK_DIR/.env" ]; then
    cp "$WORK_DIR/.env.example" "$WORK_DIR/.env" 2>/dev/null || touch "$WORK_DIR/.env"
fi

sudo systemctl daemon-reload
sudo systemctl enable wayfinding | tee -a "$LOG_FILE"

# ── Final report ──────────────────────────────────────────────────────────────
echo ""
echo "===== setup.sh completed successfully =====" | tee -a "$LOG_FILE"
echo ""
echo "✅ NEXT STEPS:"
echo ""
echo "1. Open Oracle Cloud → VCN → Security List → add ingress rules for port 80 and 443"
echo "   (Source 0.0.0.0/0)"
echo ""
echo "2. Configure .env at:  $WORK_DIR/.env"
echo "   - Add GEMINI_API_KEY=AIza..."
echo "   - Set USE_GEMINI=true"
echo ""
echo "3. Download the ML models (one-time, ~20 min):"
echo "   source $VENV_DIR/bin/activate"
echo "   python -c \"from sentence_transformers import SentenceTransformer; SentenceTransformer('intfloat/multilingual-e5-large')\""
echo "   python -c \"from sentence_transformers import CrossEncoder; CrossEncoder('BAAI/bge-reranker-base')\""
echo ""
if [ "$DOMAIN" != "_" ]; then
    echo "4. Get HTTPS certificate:"
    echo "   sudo certbot --nginx -d $DOMAIN"
    echo ""
fi
echo "5. Start the service:"
echo "   sudo systemctl start wayfinding"
echo "   sudo systemctl status wayfinding"
echo ""
echo "6. Check logs:"
echo "   sudo journalctl -u wayfinding -f"
echo ""
echo "7. Verify the app is responding:"
if [ "$DOMAIN" != "_" ]; then
    echo "   curl http://$DOMAIN/healthz"
else
    echo "   curl http://localhost/healthz"
fi
echo ""
echo "Logs: $LOG_FILE"

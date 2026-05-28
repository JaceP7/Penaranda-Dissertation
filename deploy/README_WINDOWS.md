# A3 — Oracle Cloud Always Free Deployment Guide
### From Windows · No laptop dependency · ₱0/month

This is the **complete, step-by-step deployment guide** for hosting the Geo-Agentic RAG system on Oracle Cloud Infrastructure's Always Free tier. Total setup time: **4–6 hours** the first time.

After this, your system runs 24/7 in the cloud at a public URL. You can close your laptop.

---

## 🎯 What you're building

```
Public Internet
      │
      ▼
┌───────────────────────────────────┐
│ Vercel (frontend)                 │
│ - HTML / CSS / JS                 │
│ - URL: cityhall.vercel.app        │
└──────────────┬────────────────────┘
               │ HTTPS
               ▼
┌───────────────────────────────────┐
│ Oracle Cloud (backend)            │
│ - Ubuntu 24.04 LTS ARM            │
│ - 4 cores, 24 GB RAM, FREE        │
│ - Python pipeline                 │
│ - Nginx reverse proxy             │
│ - Let's Encrypt HTTPS             │
│ - systemd auto-restart            │
│ - URL: api.cityhall.example.com   │
└──────────────┬────────────────────┘
               │
               ▼
┌───────────────────────────────────┐
│ Google Gemini API                 │
│ - Stage 5 LLM (cloud)             │
│ - Free tier 1,500 RPD             │
└───────────────────────────────────┘
```

---

## 📋 Prerequisites checklist

- [ ] Credit/debit card (Oracle requires it for identity verification — they won't charge it for the free tier)
- [ ] Phone for OTP verification
- [ ] Gmail or other email account
- [ ] Your laptop's Windows 10/11 (built-in PowerShell + SSH)
- [ ] ~1 hour of uninterrupted time for the initial setup
- [ ] Existing `.env` with your `GEMINI_API_KEY`

---

## 🗺️ Roadmap (10 phases)

| Phase | What | Time |
|---|---|---|
| 1. Sign up for Oracle Cloud Free | Account creation | 30 min |
| 2. Create the ARM compute instance | VM provisioning | 20 min |
| 3. Connect via SSH from Windows | Verify access | 10 min |
| 4. Run the setup script | Auto-install everything | 30 min (mostly waiting) |
| 5. Configure your `.env` on the server | Add Gemini key | 5 min |
| 6. Download ML models on the server | First-run model fetch | 20 min |
| 7. Get a free domain (optional) | DuckDNS or your own | 15 min |
| 8. Set up HTTPS with Let's Encrypt | Certbot | 10 min |
| 9. Start the service + verify | systemctl + curl | 10 min |
| 10. Deploy the frontend to Vercel | Static site hosting | 30 min |

---

## 🟢 Phase 1 — Sign up for Oracle Cloud Free

Oracle Cloud's "Always Free" tier gives you:
- 4 ARM Ampere cores (Ampere A1)
- 24 GB RAM
- 200 GB block storage
- 10 TB/month outbound bandwidth
- Permanent — no expiration

### Steps

1. Go to **https://www.oracle.com/cloud/free/**
2. Click **"Start for free"**
3. Fill in the form:
   - **Country/Territory**: Philippines
   - **Account type**: Individual
4. Verify email (check inbox for code)
5. Verify phone via SMS code
6. **Choose your home region carefully** — this is permanent:
   - **Singapore (ap-singapore-1)** — closest to PH, lowest latency
   - Tokyo (ap-tokyo-1) — backup option
   - Mumbai (ap-mumbai-1) — backup option

   ⚠️ **Avoid US/EU regions** — they're popular and Ampere stockouts are common.

7. Enter credit card for identity verification (Oracle confirms you're not a bot)
8. Confirm agreement and finish signup

**Wait time:** Oracle reviews your account for 5–15 minutes. You'll get an email when ready.

---

## 🟢 Phase 2 — Create the ARM compute instance

Once your account is active:

1. Sign in at **https://cloud.oracle.com**
2. From the top-left menu (≡), go to **Compute → Instances**
3. Click **"Create instance"**

### Configuration

| Field | Value |
|---|---|
| Name | `wayfinding-server` |
| Compartment | (root — default) |
| **Image** | Click **"Change image"** → **Canonical Ubuntu 24.04** (or 22.04 if 24.04 unavailable) |
| **Shape** | Click **"Change shape"** → **Ampere → VM.Standard.A1.Flex** |
| **OCPU count** | **4** |
| **Memory (GB)** | **24** |
| **VNIC** | Use default VCN (it'll be auto-created if first time) |
| **Assign public IP** | ✅ Yes |
| **Add SSH keys** | ✅ **Generate a key pair for me** → **Save Private Key** (downloads `ssh-key-xxxxx.key`) |

4. Click **"Create"**

### If you see "Out of capacity" error

This is Oracle's biggest headache. Try:
- Wait 30 minutes, try again
- Try a different region (Mumbai, Tokyo)
- Try fewer OCPUs (start with 2 cores, 12 GB)
- Use a community tool: `oci-arm-host-capacity` (creates instance the moment capacity opens)

### Save these values

When the instance comes up, write down:
- **Public IP address** (e.g., `129.213.45.67`)
- Path to the downloaded `.key` file

---

## 🟢 Phase 3 — Connect via SSH from Windows

### Move your SSH key to the right place

In **PowerShell**:

```powershell
# Move key to your .ssh folder
mkdir $env:USERPROFILE\.ssh -ErrorAction SilentlyContinue
move "$env:USERPROFILE\Downloads\ssh-key-*.key" "$env:USERPROFILE\.ssh\oracle-cloud.key"

# Restrict permissions (Windows requires this)
icacls "$env:USERPROFILE\.ssh\oracle-cloud.key" /inheritance:r /grant:r "${env:USERNAME}:R"
```

### Connect

```powershell
ssh -i $env:USERPROFILE\.ssh\oracle-cloud.key ubuntu@<your-public-ip>
```

First time you'll see:
```
The authenticity of host '129.213.45.67' can't be established. ECDSA key fingerprint is SHA256:...
Are you sure you want to continue connecting (yes/no/[fingerprint])?
```

Type `yes` and press Enter.

You should see the Ubuntu prompt:
```
ubuntu@wayfinding-server:~$
```

You're in. ✅

---

## 🟢 Phase 4 — Run the setup script

This script installs Python, all ML dependencies, nginx, and configures the system. It takes ~30 minutes (mostly waiting for downloads).

### Download the script

Still in the SSH session, run:

```bash
cd ~
curl -O https://raw.githubusercontent.com/YOUR_USERNAME/YOUR_REPO/main/dissertation/deploy/setup.sh
chmod +x setup.sh
```

⚠️ **You'll need to push your project to GitHub first** for this to work. Alternatively, you can `scp` the script from your laptop:

```powershell
# From Windows PowerShell:
scp -i $env:USERPROFILE\.ssh\oracle-cloud.key `
    "C:\Users\Jace\Desktop\College Files\diko\dissertation\deploy\setup.sh" `
    ubuntu@<your-public-ip>:~/
```

### Run the script

```bash
bash setup.sh
```

Watch for prompts. The script will:
1. Update system packages
2. Open firewall for HTTP/HTTPS
3. Install Python 3.11 + venv + git + nginx + certbot
4. Clone your repo (you'll need to provide the URL or paste it)
5. Create a Python virtualenv
6. Install all Python dependencies
7. Configure nginx as a reverse proxy
8. Create a systemd service file
9. Set the service to auto-start on boot

If something fails, the script logs to `~/setup.log`.

---

## 🟢 Phase 5 — Configure `.env` on the server

```bash
cd ~/wayfinding-app/  # adjust path if you cloned elsewhere
nano .env
```

Paste:
```ini
# Cloud LLM via Google Gemini
GEMINI_API_KEY=AIza_your_actual_key_here
USE_GEMINI=true
GEMINI_MODEL=gemini-2.5-flash

# Ollama not used on cloud (no GPU)
USE_GROQ=false
```

Save with `Ctrl+O`, Enter, `Ctrl+X`.

---

## 🟢 Phase 6 — Download ML models (one-time, ~20 min)

The first run downloads `multilingual-e5-large` (~2 GB) and `bge-reranker-base` (~500 MB) from Hugging Face. This is the longest step.

```bash
cd ~
source ~/wayfinding-env/bin/activate
python -c "from sentence_transformers import SentenceTransformer; \
           SentenceTransformer('intfloat/multilingual-e5-large')"
python -c "from sentence_transformers import CrossEncoder; \
           CrossEncoder('BAAI/bge-reranker-base')"
```

Each runs for several minutes. Be patient. They cache to `~/.cache/huggingface/`.

---

## 🟢 Phase 7 — (Optional) Get a free domain

If you want a nice URL like `wayfinding.duckdns.org` instead of an IP:

### Use DuckDNS (free, instant)

1. Go to https://www.duckdns.org
2. Sign in with GitHub/Google
3. Create subdomain: `wayfinding-cityhall` (or whatever you want)
4. Set the IP to your Oracle public IP
5. Click "Update"

Your URL is now `wayfinding-cityhall.duckdns.org` — points to your VM.

### Skip this step if

You're OK with using the raw IP `https://129.213.45.67` for the SUS evaluation. Citizens will see the IP in the URL, but it works.

---

## 🟢 Phase 8 — Set up HTTPS with Let's Encrypt

Required because the wayfinding app uses `DeviceMotion` and `Camera` APIs which need HTTPS.

```bash
# Replace with your domain (or skip this if using IP only)
sudo certbot --nginx -d wayfinding-cityhall.duckdns.org
```

Certbot will:
1. Verify domain ownership
2. Get a free SSL certificate (90 days)
3. Auto-configure nginx for HTTPS
4. Set up auto-renewal

Test renewal:
```bash
sudo certbot renew --dry-run
```

If using IP-only (no domain), you'll use a self-signed cert. Browsers will warn but accept after one click.

---

## 🟢 Phase 9 — Start the service + verify

```bash
sudo systemctl enable wayfinding
sudo systemctl start wayfinding
sudo systemctl status wayfinding
```

Expected output:
```
● wayfinding.service - Geo-Agentic RAG Wayfinding Backend
     Loaded: loaded (/etc/systemd/system/wayfinding.service; enabled)
     Active: active (running)
```

Test the API:

```bash
curl -sk https://wayfinding-cityhall.duckdns.org/ | head -5
# Should return the HTML
```

From a browser on your laptop:
```
https://wayfinding-cityhall.duckdns.org/
```

You should see the wayfinding app with the octagonal grid.

---

## 🟢 Phase 10 — Deploy the frontend to Vercel (optional)

The static frontend can be served by Vercel for faster global CDN delivery. The Oracle VM just handles the API.

### If you want this

1. Push your repo to GitHub
2. Go to https://vercel.com → Sign in with GitHub
3. **New Project** → import your repo
4. **Framework Preset:** Other
5. **Root Directory:** `wayfinding-app/`
6. **Build Command:** (leave blank — it's static)
7. Set environment variable: `API_URL=https://wayfinding-cityhall.duckdns.org`
8. Deploy

The frontend lives at `your-app.vercel.app` and calls the Oracle VM for API.

### If you skip this

Use the Oracle URL directly. Everything still works.

---

## ⚙️ Day-to-day operations

### Restart the service (if needed)
```bash
ssh -i $env:USERPROFILE\.ssh\oracle-cloud.key ubuntu@<ip>
sudo systemctl restart wayfinding
```

### View logs
```bash
sudo journalctl -u wayfinding -f
```

### Update the code
```bash
cd ~/wayfinding-app
git pull
sudo systemctl restart wayfinding
```

### View analytics
```
https://wayfinding-cityhall.duckdns.org/admin.html
```

---

## 🆘 Troubleshooting

| Problem | Try |
|---|---|
| "Out of capacity" creating instance | Wait 30 min, try different region, try fewer cores |
| SSH "Permission denied" | Check key path + chmod, use `ubuntu` not `root` |
| Models won't download | Free up disk: `df -h`; check internet: `curl https://huggingface.co` |
| `systemctl start` fails | Check logs: `journalctl -u wayfinding -n 50` |
| Browser shows "connection refused" | `sudo systemctl status nginx` and check `~/wayfinding-app/serve_https.py` is binding |
| HTTPS cert renewal fails | DNS may have changed; check DuckDNS still points to Oracle IP |
| Gemini quota exhausted | Wait until midnight UTC, or upgrade to paid Gemini tier |

---

## 🔐 Security hardening (do these before SUS evaluation)

- [ ] Change SSH port from 22 to something random (e.g., 2222)
- [ ] Disable SSH password login (key-only)
- [ ] Set up UFW firewall (only ports 80, 443, your-SSH-port)
- [ ] Enable automatic security updates (`unattended-upgrades`)
- [ ] Set up fail2ban for SSH brute force protection
- [ ] Disable root login

Detailed commands in `deploy/HARDENING.md` (build this after first deploy works).

---

## ✅ Success criteria

You're done with A3 when ALL of these are true:

- [ ] Oracle VM is running (visible in OCI console)
- [ ] You can SSH in from Windows
- [ ] `systemctl status wayfinding` shows "active (running)"
- [ ] `https://your-url/` loads the wayfinding app in a browser
- [ ] `https://your-url/admin.html` loads the analytics dashboard
- [ ] Chat widget responds to a Filipino query in <10 seconds
- [ ] Floor switching works on the public URL
- [ ] HTTPS lock icon shows in browser
- [ ] Your laptop is OFF and the URL still works

After this, mark A3 ✅ in `IMPLEMENTATION_AUDIT.md` and proceed to A2 (fieldwork) and the usability tests.

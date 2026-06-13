# Serverless RAG setup — Upstash Vector + Groq

This makes the **live website chat** do real retrieval-augmented generation
(not the old keyword fallback), so "Take me there" routing works on Vercel —
without running any server/VM.

```
Browser → Vercel api/chat.js → Upstash Vector (bge-m3 embeds + searches 235 services)
                 │                       ↓ top-K + metadata (requirements, steps, dept)
                 └──────────► Groq (llama-3.3-70b) grounds the Taglish answer + "Go to:"
```

## One-time setup (≈10 minutes)

### 1. Create an Upstash account
- Go to **https://console.upstash.com** → sign up (free, GitHub login works).

### 2. Create a Vector index
- **Vector → Create Index**.
- Name: `calamba-services` (anything).
- **Embedding Model: `BAAI/bge-m3`** ← important (multilingual, 1024-dim, handles Taglish).
- Dimensions / metric: auto-filled by the model (1024, COSINE). Leave defaults.
- Region: pick the one closest to your Vercel region (or Singapore/Tokyo for PH).
- Create.

### 3. Copy the REST credentials
- Open the index → **Details / REST** tab.
- Copy **`UPSTASH_VECTOR_REST_URL`** and **`UPSTASH_VECTOR_REST_TOKEN`**.

### 4. Seed the 235 services (run once, from the repo)
PowerShell:
```powershell
$env:UPSTASH_VECTOR_REST_URL   = "https://YOUR-ID.upstash.io"
$env:UPSTASH_VECTOR_REST_TOKEN = "YOUR-TOKEN"
python tools/upstash_seed.py
```
Expect: `upserted 25/235 … 235/235` then `Done. Seeded 235 services`.
(Re-run anytime after a corpus change; `--reset` clears first.)

### 5. Add the same env vars to Vercel
- Vercel dashboard → your project → **Settings → Environment Variables**.
- Add **`UPSTASH_VECTOR_REST_URL`** and **`UPSTASH_VECTOR_REST_TOKEN`** (Production + Preview).
- Confirm **`GROQ_API_KEY`** is also set (it already was — `hasKey:true`). Rotate it if it's the one pasted in chat earlier.

### 6. Redeploy
- Push any commit, or in Vercel hit **Deployments → ⋯ → Redeploy** so the new env vars load.

### 7. Test
Open `https://penaranda-dissertation.vercel.app`, ask the chat:
> *paano kumuha ng business permit?*

You should get a grounded Taglish answer with requirements, a "Go to:" line,
and a **Take me there** button that routes on the map.

## Notes / caveats

- **Different embedding model.** This uses `bge-m3` (via Upstash), not the
  `multilingual-e5-large` your Chapter 4 metrics were measured on. Retrieval
  quality will differ → **re-run the retrieval eval against Upstash** and report
  the new numbers. Ask me for `eval/run_upstash_eval.py` when ready.
- **Free tier limits.** Upstash Vector free tier covers ~10k queries/day and
  enough storage for 235 vectors many times over — ample for the dissertation +
  SUS evaluation.
- **Two chat backends now exist.** Local `serve_https.py` still runs the exact
  e5-large + bge-reranker pipeline (for offline / metrics). Vercel uses this
  Upstash path. They share the same response contract and corpus.
- **Cost: $0** within Upstash + Vercel + Groq free tiers.

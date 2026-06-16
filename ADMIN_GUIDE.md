# Admin Guide — Managing Rooms & Analytics (multi-admin, cloud)

This is how a City Hall staff member (not the developer) updates the map and reads analytics on the **live site** — no git, no laptop, no code.

---

## 1. Enter admin mode

1. Open the live site on any device.
2. Tap the **🔧** button (bottom-left).
3. Enter the **staff PIN** (in `app.js`, `ADMIN_PIN`; default `2024` — change this).
4. The full editor appears. Tap **🔧** again to return to the citizen view. (The view is never remembered — every reload returns to the citizen chat, which is kiosk-safe.)

> Two access secrets, two jobs:
> - **Staff PIN** — unlocks the *editor UI* on a device (client-side).
> - **Publish token** (`MAP_ADMIN_TOKEN`, set in Vercel) — authorizes *writing the shared map* to the cloud (server-side). Without it, edits stay on that one device.

---

## 2. Make / edit / update rooms

All editing happens in admin mode:

| Task | How |
|---|---|
| **Make a room / walls / doors / stairs** | **🧱 Wall Mode** → pick Paint type (Wall / Door / Stair / Erase) → drag on the grid. |
| **Name / place an office** | **🔲 Stamp & Places** → design or pick a stamp, type a label, click the grid to place it. The label shows on that floor. |
| **Move / rotate / delete a block** | **⬚ Select** → drag a region → use the toolbar (CW/CCW/Move/Delete). |
| **Copy a floor's shell to another floor** | Floors ▾ → **Duplicate Floor**. |
| **Rename a floor** | ✏️ next to the floor label. |
| **Switch floors** | ▲ / ▼ in the floor selector. |

Edits auto-save to **that device's** browser. To make them appear on **everyone's** device, publish (next step).

---

## 3. Publish to all devices (the important part)

1. Make your edits in admin mode.
2. Floors ▾ → **☁ Publish to all devices**.
3. Enter the **publish token** the first time (remembered for the session).
4. Confirm. You'll see "Published as version N."
5. Other devices pick it up **on their next reload** (the app pulls the latest published map on load and applies it if newer).

What gets published: every floor's walls/doors/stairs, all stamp placements/labels, and floor names. Citizens are never teleported — a published update refreshes the map without moving anyone mid-route.

**One-time setup (developer):** in the Vercel project → Settings → Environment Variables, add `MAP_ADMIN_TOKEN` (a strong password) and redeploy. Until it's set, Publish is refused (fail-closed) so nobody can overwrite the shared map anonymously. Storage reuses the existing `UPSTASH_REDIS_REST_URL` / `UPSTASH_REDIS_REST_TOKEN`.

---

## 4. Check analytics

- From admin: tap **📊** (or open `/admin.html` directly — share this URL with admins).
- Shows live website usage from the query log (Upstash Redis): total & today's queries, ambiguity rate, average latency, top departments, top sub-services, queries-per-day (7-day), and recent queries.
- Read-only; safe to open on any device.

---

## 5. Generate QR anchors (for accurate positioning)

Admin → **📍 Navigate** → **🏷 Gen QR** → enter floor/row/col → **Save PNG** → print → post on the wall at that spot. Citizens scan it with their **normal camera** to set their location. See `QR_ANCHOR_PLAN.md` for which coordinates to use and why.

---

## 6. Roles & limits (current)

- **Single shared PIN + single publish token.** Fine for a small admin team. Per-admin accounts/audit log are a future enhancement (every publish already records `updatedBy` + timestamp + version in the cloud doc, so the last writer wins and is stamped).
- **Publish is explicit** (a button), not automatic — so half-finished edits never go live by accident.
- The old **Export / Deploy Floors** (git bake-and-push) still exists for the developer but is **not needed** by staff anymore; cloud Publish replaces it for day-to-day room changes.

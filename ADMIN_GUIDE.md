# Admin Guide — Managing Rooms & Analytics (multi-admin, cloud)

This is how a City Hall staff member (not the developer) updates the map and reads analytics on the **live site** — no git, no laptop, no code.

---

## 1. Enter admin mode

1. Open the live site on any device.
2. Tap the **🔧** button (bottom-left).
3. Enter the **staff PIN**. It is checked by the server (`api/adminauth.js`) and is no longer written into `app.js`, so it cannot be read from the page source.
4. The full editor appears. Tap **🔧** again to return to the citizen view. (The view is never remembered — every reload returns to the citizen chat, which is kiosk-safe.)

**One-time setup (developer):** add `ADMIN_PIN` to the Vercel environment variables and redeploy. Until you do, the previous PIN `2024` keeps working and a warning is logged to the browser console, so nobody is locked out mid-deployment.

> Two access secrets, two jobs:
> - **Staff PIN** — unlocks the *editor UI* on a device. A deterrent, not a wall: the editor is a CSS class, so someone with devtools can still reveal it. That alone changes nothing, because every write is checked server-side.
> - **Publish token** (`MAP_ADMIN_TOKEN`, set in Vercel) — authorizes *writing the shared map*. This is the real control. Without it, edits stay on that one device. It is held only for the browser tab and is cleared when you leave the editor.

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

Your edits are **saved on your device only** until you publish. Nothing a citizen sees changes before that.

1. Make your edits in admin mode. An amber **"Unpublished changes"** badge appears in the header the moment your map differs from the live one, and tells you which version citizens are still on.
2. *(Optional but recommended)* Floors ▾ → **👁 Preview as citizen** to see exactly what a visitor gets, including your unpublished edits. Tap the chip at the bottom to return to the editor — no PIN needed.
3. Floors ▾ → **☁ Publish to all devices**.
4. You are shown **what will change** in plain language before anything happens — for example *"14 wall/door/stair cells changed — Ground Floor (11), 2nd Floor (3); 2 rooms moved or renamed"*. If nothing differs, it tells you and stops.
5. Give your **name or office** the first time. It is recorded with every publish so the team can see who changed what.
6. Enter the **publish token** the first time in each browser tab.
7. Confirm. You'll see "Published as version N."
8. Other devices pick it up **on their next reload**.

What gets published: every floor's walls/doors/stairs, all stamp placements/labels, and floor names. Citizens are never teleported — a published update refreshes the map without moving anyone mid-route.

### If someone else published while you were editing

The system refuses to silently overwrite their work. You are told who published, when, and asked to choose:

- **keep** — publish yours over theirs
- **discard** — throw away your edits and take theirs
- **cancel** — do nothing for now

This also protects you in the other direction: if a colleague is editing while you publish, their next publish will warn them rather than wipe yours.

### Undoing a bad publish

Floors ▾ → **🕘 Version history** lists the last 10 published versions with who published each and when. **Restore** puts any of them back.

Restoring publishes the old map as a *new* version, so nothing is ever deleted and a restore can itself be undone.

### Discarding your own unpublished edits

Tap **Revert** inside the amber badge. Your device reloads the live map and your local changes are discarded. Anything already published is unaffected.

> If you have unpublished edits and a colleague publishes, your device will **keep your edits** rather than overwrite them on reload. Publish or Revert when you're ready.

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

- **Single shared PIN + single publish token.** Fine for a small admin team. Each publish records the name you gave, the timestamp and the version, so you can see *who* changed the map — but because the token is shared, that name is self-declared, not authenticated. Per-admin accounts are a future enhancement.
- **Publish is explicit** (a button), not automatic — so half-finished edits never go live by accident.
- **Concurrent edits are detected, not prevented.** Two admins can edit at once; whoever publishes second is warned and must choose. There is no locking.
- **History keeps the last 10 versions.** Older ones are dropped. For a permanent archive, use Export Floors.
- **The staff PIN is a deterrent, not a security boundary.** It keeps the editor out of casual reach. Data safety rests on `MAP_ADMIN_TOKEN`, which is verified server-side and never sent to the browser.
- The old **Export / Deploy Floors** (git bake-and-push) still exists for the developer but is **not needed** by staff anymore; cloud Publish replaces it for day-to-day room changes.

---

## 7. For the developer

Regression tests for the publishing logic (conflict detection, rollback, auth) run against a fake Redis, so they never touch live data:

```bash
node tools/test_admin_publishing.js .
```

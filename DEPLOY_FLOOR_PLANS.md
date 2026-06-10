# Deploying floor-plan changes to all users

This is the workflow for publishing new walls / doors / stairs to **every device that visits the production URL**. It's intentionally git-based so each change is reproducible, auditable for the dissertation, and free of backend cost.

## TL;DR

```text
Edit in Map Editor → click Export Floors → run helper script → git push → ~60 s later, every device sees the new floor on next reload
```

## When to use this

- You add / remove walls on any floor.
- You change door or stair locations.
- You introduce a new floor.
- Anything where the **bundled** floor layout should change for everyone.

**Not for**: captured office coordinates (those live in `departments.json` and use the existing 💾 Export Captures workflow), or per-user preferences (those stay in localStorage on the device).

## Step-by-step

### 1. Edit on the laptop

```bash
python wayfinding-app/serve_https.py
```

Open `https://localhost:3001/` and use the Map Editor to add / remove / change cells on each floor. Switch floors with `▼` / `▲` arrows. Everything autosaves to localStorage as you work.

### 2. Export

In the top toolbar, click **`Export Floors`**.

A browser dialog confirms the export and tells you the new version number. A file called `floor_presets.js` downloads to your Downloads folder.

The export contains:
- All 4 (or however many) floor cell arrays — `FLOOR_PRESETS`.
- The auto-incremented `FLOOR_PRESETS_VERSION` (so existing devices' localStorage gets invalidated).
- The unchanged `FLOOR_PRESETS_DEPARTMENTS` (office centroids).
- The unchanged `applyFloorPresets()` function.

### 3. Install via the helper script

```bash
python tools/replace_floor_presets.py ~/Downloads/floor_presets.js
```

The script:
- Validates the input.
- Backs up the existing `wayfinding-app/js/floor_presets.js` to `.bak`.
- Copies the new file into place.
- Prints the version diff + line-count summary.
- Prints suggested git commands.

If the new version isn't higher than the current one, the script warns and asks for confirmation. (Usually that means you forgot to refresh after a previous push — re-edit and re-export.)

### 4. Review the diff

```bash
git diff wayfinding-app/js/floor_presets.js | head -80
```

The version line should change (e.g. `v3 → v4`). The cell arrays change for whichever floor(s) you edited.

### 5. Commit + push

```bash
git add wayfinding-app/js/floor_presets.js
git commit -m "Update floor plans (presets v3 → v4)"
git push origin main
```

### 6. Verify deploy

Vercel auto-deploys on push. Within ~60 seconds, the production URL serves the new bundle.

To confirm:
- On any device, hard-refresh the production URL.
- The app's existing version-check logic compares the bundled `FLOOR_PRESETS_VERSION` against whatever's stored in the device's localStorage. If they differ, the bundled (newer) layout overwrites the local cache automatically.

## Why the version bump matters

Without the version bump, devices that have already loaded the old layout would keep using their cached localStorage and never see your change. The `FLOOR_PRESETS_VERSION` integer is the cache-busting key — when it differs from `localStorage["gridPathfinder_floorPresetsVersion"]` (or whatever the app uses), the app re-applies the bundled layout. The Export Floors button increments this for you automatically.

## What stays per-device

Even after deploy:
- Captured office coordinates (`wayfinding-captures-v1`) — per device.
- Custom offices added on-site (`wayfinding-custom-offices-v1`) — per device.
- Stamp placements / presets — per device.
- Walk recordings (`wayfinding-walks-v1`) — per device.

The deploy only resets the **bundled floor wall data**. Your local capture / walk / stamp data is preserved.

## If something goes wrong

```bash
# Roll back the file change
git checkout wayfinding-app/js/floor_presets.js

# Or restore from the script's backup
cp wayfinding-app/js/floor_presets.js.bak wayfinding-app/js/floor_presets.js

# Force-clear localStorage on a specific device (browser DevTools console):
localStorage.removeItem('wayfinding-grid-v1');
location.reload();
```

## Future improvement (deferred)

Real-time cross-device sync via Vercel KV / Firebase / Supabase. Skipped for now because (a) floor plans change infrequently, (b) the dissertation needs reproducibility, (c) zero backend cost is preferred. Revisit if floor edits become a daily workflow.

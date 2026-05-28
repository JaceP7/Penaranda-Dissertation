# A2 — Fieldwork Data Gathering Plan
### Geo-Agentic RAG Wayfinding · Calamba City Hall · 2026

This is the **definite, on-site instruction plan** for the field survey. Bring this document (printed or on your phone) when you visit City Hall.

---

## 🎯 What this fieldwork produces

After one visit (3–6 hours), you should leave with:

1. ✅ **All 21 departments** mapped to real grid coordinates (`floor`, `row`, `col`)
2. ✅ **Floor confirmation** for offices not labeled clearly on the blueprint
3. ✅ **`metresPerCell` calibration** from one measured corridor
4. ✅ **QR anchor positions** chosen and marked (4–6 per floor = 16–24 total)
5. ✅ **Office signage photos** for the catalogue feature
6. ✅ **Stair connectivity** confirmed (which stair connects which floors)
7. ✅ **Door positions** verified for accurate pathfinding
8. ✅ **Office hours + canonical names + aliases** (what citizens actually call each office)

---

## 📦 What to bring

| Item | Purpose | Required? |
|---|---|---|
| **Phone** (charged, with the live app installed/bookmarked) | Run live tests, take photos, scan QRs | ✅ |
| **Power bank** | PDR drains battery fast during testing | ✅ |
| **Tape measure or laser distance meter** | Measure one corridor for calibration | ✅ |
| **Printed copies of the 4 anonymized grid maps** (`anon_floor_plans/floor_*_grid.png`) | Annotate corrections on paper | ✅ |
| **Printed copy of departments.json list** (provided below) | Check off each department as you confirm it | ✅ |
| **Notebook + 2 pens** (blue + red) | Blue = notes, Red = corrections to grid | ✅ |
| **Painter's tape** (low-residue, blue) | Temporarily mark QR anchor positions on walls | ✅ |
| **Pre-printed sample QR codes** (8–10) | Test scanning before deciding final positions | ✅ |
| **Permission letter from your dissertation adviser** | Show to staff who ask why you're there | ✅ |
| **Smartphone tripod / selfie stick** (optional) | Stable photos of signage | ⚠️ Nice |
| **Compass app on phone** (or use the wayfinding app's compass) | Verify floor plan orientation | ⚠️ Nice |

---

## 📋 Pre-fieldwork checklist (do these 1 day before)

- [ ] Phone charged to 100%, screen brightness max
- [ ] Phone configured: **Disable auto-rotation lock**, **disable sleep**, allow camera + motion sensors permissions for the app
- [ ] Live URL bookmarked on phone homescreen (set once you've deployed via A3)
- [ ] Pre-printed sample QR codes from the app's QR Generator (Generate one for `GRID:1:37,37` — center of Ground Floor — and a few neighbors)
- [ ] Print 4 floor plan PNGs at A3 size if possible (A4 acceptable)
- [ ] Print `departments.json` checklist (template below)
- [ ] Print this document
- [ ] Contact City Hall ahead of time to schedule the visit during low-traffic hours (request mid-morning weekday)

---

## ⏱️ Suggested time budget

| Activity | Time |
|---|---|
| Arrival, briefing, get visitor pass | 30 min |
| **Ground Floor** (Floor 1) — 8 offices | 1.5 hrs |
| **Lower Ground Floor** (Floor 0) — 12 offices | 1.5 hrs |
| **Second Floor** (Floor 2) — 12 offices | 1 hr |
| **Third Floor** (Floor 3) — 11 offices | 1 hr |
| Calibration corridor measurement | 15 min |
| QR anchor position selection + marking | 30 min |
| Buffer / interruptions | 1 hr |
| **TOTAL** | **6–7 hours** |

Plan for **one full day**. Can split into two half-days if needed (do Ground Floor first since it's most important).

---

## 🚶 Floor-by-floor procedure

Repeat this sequence for each of the 4 floors. **Start with Ground Floor (Floor 1)** — it has the main entrance and the highest citizen traffic.

### Step-by-step (one floor at a time)

#### 1. Orient yourself
- Stand at the entry point of the floor (lobby for Ground, top of stairs for others)
- Look at the printed anonymized grid map
- Confirm which side of the building is North (use phone compass)
- Mark the actual North on the printout if it differs

#### 2. Walk the perimeter
- Move clockwise from the main entrance
- For each room you pass:
  - **Look at the door sign** — note the exact official office name
  - **Take a photo of the signage** (filename: `floor1_treasury_sign.jpg` etc.)
  - **Estimate the grid cells** the room occupies — pencil it on the printed grid
  - **Check off the corresponding department** on your departments.json checklist

#### 3. For each department, record these fields

Use this template (one row per office, write in your notebook):

```
DEPT NAME (official):  _________________________________
Aliases (what citizens call it): _________________________
Floor (0/1/2/3):       _________
Row (0-74):            _________
Col (0-74):            _________
Door position (N/S/E/W wall): _________
Public-facing? (yes/no): _________
Office hours: _________________________________________
Photo filename: _______________________________________
Notes: ________________________________________________
```

You'll consolidate this into `departments.json` after the visit.

#### 4. Pick QR anchor positions for this floor
- Choose **4–6 spots per floor** where you'll later install printed QR codes
- Good spots:
  - Inside the main entrance lobby (1)
  - At the top of each stairwell (2–3 depending on number of stairs)
  - Near major decision points (e.g., where a corridor branches)
  - Near the most popular departments (Treasury, Business Permits)
- Mark each spot with a small piece of **blue painter's tape**
- Photograph each spot from ~1m away (the photo helps you remember when printing the actual QR sticker)
- Note the grid cell for each spot: `Floor 1, row 60, col 37 — wall opposite entrance`

#### 5. Test pathfinding live
- Open the app on your phone (from your deployed Oracle Cloud URL)
- From the main entry cell, tap each major destination
- Verify the path drawn on screen actually leads to that office
- If the path goes through a wall or skips a corridor → adjust the grid in your notes

---

## 📏 metresPerCell calibration (do this once for the whole building)

This calibrates the system's distance estimate.

1. Pick a **straight corridor** between 2 fixed landmarks (e.g., from the bottom of stair S1 to the door of City Treasury)
2. Use your tape measure or laser to measure the **real distance in metres**
3. Count the **grid cells** that span the same distance on your floor plan
4. Note both: `Real: 22.5 m. Cells: 38. Per-cell: 0.59 m.`
5. After the visit, run in browser console:
   ```javascript
   NAV.metresPerCell = 0.59
   ```

---

## 📝 Departments.json checklist (print this page)

For each, write: ✓ if confirmed, ✗ if not visible, ❓ if uncertain.

### Floor 0 — Lower Ground
- [ ] CSSYDO — *City Social Services Department* — Floor: __ Row: __ Col: __
- [ ] PDAO — *Persons with Disability Affairs Office* — Floor: __ Row: __ Col: __
- [ ] City Health Services Department — Floor: __ Row: __ Col: __
- [ ] IIPESO — *Investment, Promotions, Employment Services* — Floor: __ Row: __ Col: __
- [ ] City Treasury Annex — Floor: __ Row: __ Col: __
- [ ] COOP — *Cooperatives & Livelihood* — Floor: __ Row: __ Col: __
- [ ] Veterinary Services & Slaughterhouse Mgmt Office — Floor: __ Row: __ Col: __
- [ ] Agriculture Office (if part of system) — Floor: __ Row: __ Col: __

### Floor 1 — Ground (Public Entry)
- [ ] City Treasury Office (Main) — Floor: __ Row: __ Col: __
- [ ] City Assessment Office — Floor: __ Row: __ Col: __
- [ ] Business Permits & Tricycle Franchising Office — Floor: __ Row: __ Col: __
- [ ] Local Civil Registry — Floor: __ Row: __ Col: __
- [ ] General Services Office (GSO) — Floor: __ Row: __ Col: __
- [ ] Tourism Office — Floor: __ Row: __ Col: __
- [ ] MOPAC (confirm if this is the same as City Legal Services?) — Floor: __ Row: __ Col: __

### Floor 2 — Second
- [ ] City Planning & Development Office — Floor: __ Row: __ Col: __
- [ ] City Accounting & Internal Control Office — Floor: __ Row: __ Col: __
- [ ] Building Regulatory Services Office — Floor: __ Row: __ Col: __
- [ ] City Human Resource Management Office — Floor: __ Row: __ Col: __
- [ ] City Environment & Natural Resources Dept (CENRO) — Floor: __ Row: __ Col: __
- [ ] City Population Management Office (main vs annex on F3?) — Floor: __ Row: __ Col: __
- [ ] City Budget Office — Floor: __ Row: __ Col: __

### Floor 3 — Third (Executive)
- [ ] Office of the City Mayor — Floor: __ Row: __ Col: __
- [ ] Office of the City Vice-Mayor — Floor: __ Row: __ Col: __
- [ ] City Administration Office — Floor: __ Row: __ Col: __

### Other (verify location during visit)
- [ ] Office for Senior Citizens Affairs (OSCA) — Floor: __ Row: __ Col: __
- [ ] City Disaster Risk Reduction & Management Division — Floor: __ Row: __ Col: __
- [ ] City Legal Services Office — Floor: __ Row: __ Col: __ *(same as MOPAC or separate?)*
- [ ] City College of Calamba *(may be a separate building entirely)* — Floor: __ Row: __ Col: __

---

## ❓ Questions to confirm with City Hall personnel during visit

(From `FIELDWORK_PREP.md` Section C, in Taglish — reuse those.)

Priority answers needed:
1. **CSSYDO = City Social Services Department?** (yes / no, same office or separate)
2. **Prosecutor = City Legal Services Office?** (yes / no)
3. **OSCA location?** (which floor and where)
4. **CDRRMD location?** (in this building or annex?)
5. **City College of Calamba** location (probably separate)
6. **Population Office** — which is the public-facing counter, Floor 2 or Floor 3?
7. **Numbers in parentheses** on the original plan — personnel count? seating? something else?
8. **Numbers on out-of-scope offices** (COMELEC, Landbank, etc.) — keep or remove from system?

---

## 🚧 During the visit — common issues + how to handle

| Issue | Action |
|---|---|
| Staff asks "what are you doing?" | Show permission letter. Explain: *"Dissertation research for La Consolacion University — improving citizen wayfinding."* |
| An office is locked or unattended | Note it, skip, come back. Don't force entry. |
| Office name doesn't match the official `departments.json` | Use the official name on the door as canonical. Add aliases. |
| Floor plan doesn't match reality (e.g., office moved) | Mark the printed grid map with red pen. Re-photograph signage. |
| QR code position you picked is on a glass wall | Choose a different position with solid wall. Glass reflects camera flash. |
| Wi-Fi is weak / no internet on phone | Use mobile data. Mention this to City Hall IT (ask about public Wi-Fi). |
| Compass on phone doesn't seem accurate | Tap "Recal" button in the app's Nav Mode |

---

## ✅ Post-fieldwork (back at home)

Within 24 hours of the visit, do these in order:

1. **Sort your photos** into folders: `floor0/`, `floor1/`, `floor2/`, `floor3/`
2. **Transcribe your notes** into `departments.json` (update all 21 entries)
3. **Update the 4 floor PNG annotations** if rooms shifted from your initial guess
4. **Regenerate the floor presets** by re-running `python gen_all_floor_grids.py` (with manual edits to room positions in the script)
5. **Set `NAV.metresPerCell`** in `app.js` constant (or via browser console for testing)
6. **Print final QR codes** for the anchor positions you chose
7. **Re-test pathfinding** on the deployed system using your phone
8. **Mark A2 as ✅ in `IMPLEMENTATION_AUDIT.md`**

---

## 📦 Output files you should have at the end

| File | Purpose |
|---|---|
| `wayfinding-app/data/departments.json` | All 21 entries with non-null floor/row/col + office_hours + aliases |
| `dissertation/fieldwork_photos/floor{0..3}/*.jpg` | Office signage photos |
| `dissertation/qr_anchor_positions.md` | Document of where each printed QR code goes |
| Annotated paper printouts of the 4 floor PNGs | For your dissertation appendix |
| `dissertation/FIELDWORK_REPORT.md` | Short summary of what you confirmed + any deviations from blueprint |

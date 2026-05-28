# Fieldwork Prep — Calamba City Hall Site Survey
### Geo-Agentic RAG Wayfinding System · Dissertation Project

---

## A. What to Bring on Survey Day

| Item | Why |
|---|---|
| Phone with charged battery | Run the dev app live for demo |
| Tape measure or laser distance meter | Measure a known corridor for `metresPerCell` calibration |
| Notebook + pen | Sketch any rooms not visible on official floor plan |
| Printed copy of the anonymized floor plans | Annotate corrections directly |
| Printed copy of `departments.json` list | Confirm which 21 offices to map |
| QR codes printed (sample) | Test scanning at real wall positions |
| Power bank | PDR drains battery fast |
| Permission letter / endorsement from adviser | For unrestricted access to all floors |

---

## B. Recommended Survey Order

### ✅ Start with: **GROUND FLOOR (Floor 1)**

**Why this floor first:**
- Only **7–8 public-facing offices** — simplest to map
- Contains the **main entrance** — every navigation path starts here
- Highest citizen foot traffic — most valuable for SUS evaluation later
- Most labels in the original plan are clear and unambiguous

**Concrete tasks for this floor:**
1. Walk the perimeter and confirm the 7 offices match the anonymized PNG
2. Measure one corridor (e.g., entry to City Treasury counter) in metres → set `NAV.metresPerCell`
3. Choose 4–6 wall positions for QR anchors and mark them with painter's tape
4. Note door positions (open vs. closed walls in pathfinding)
5. Photograph each office signage as it exists today (for the catalogue feature)

---

### Then in this order:

| Order | Floor | Reason |
|---|---|---|
| 2nd | **Lower Ground** | More offices but still public-facing (Health, PWD, Veterinary) |
| 3rd | **Second Floor** | Mixed back-office and public (HR, Accounting, Planning) |
| 4th | **Third Floor** | Mostly executive offices — lowest citizen traffic, do last |

---

## C. Questions to Ask City Hall Personnel

> Use this in the meeting. Each section is a topic block — ask them in order.
> Taglish version follows after the English version below.

### C.1 — Pasilidad at Public Access

> "Ano po ang pinaka-pangunahing pasukan ng publiko sa City Hall? Pwede po bang ituro kung saang panig ng gusali ito matatagpuan? Tapos, sa apat na floor (Lower Ground, Ground, Second, Third), mayroon po bang floor na hindi pwedeng puntahan ng mga ordinaryong mamamayan?"

> "Yung mga office po na nasa floor plan tulad ng COMELEC, Landbank, Housing, Tourism, GSO, MOPAC, Engineering Services, DILG, at Sangguniang Bayan — regular po bang nagpupunta dito ang mga walk-in citizens, o internal/partner agencies lang po ito na hindi direkta nagse-serve sa publiko?"

> "Kung may bisita po na hindi alam saan pupunta, sino po ang unang naka-assign na tumutulong sa kanila? May information desk po ba o guard na nag-direct?"

---

### C.2 — Existing Tech Stack

> "Mayroon po bang kasalukuyang wayfinding system, digital directory, o kiosk sa City Hall? Kung mayroon, paano po ito ginagamit at sino ang nagma-maintain?"

> "May Wi-Fi po ba na pwedeng gamitin ng publiko sa loob ng gusali? Kung mayroon, gaano kalakas ang signal sa bawat floor, at may password po ba?"

> "Yung mga computer po na ginagamit sa bawat opisina — nasa local network ba sila o may central server? May IT department o staff po ba na nagma-maintain nito?"

> "May existing po ba na website o mobile app ang City Hall para sa mga citizen services? Anong technology gamit nito (e.g., website lang, may backend, may database)?"

> "Para sa document services po (cedula, business permit, birth certificate), automated na po ba ito o manual pa rin? Online application po ba available?"

---

### C.3 — Data at Maintenance

> "Sino po ang nag-mamaintain ng impormasyon kung anong requirements at procedures ang kailangan sa bawat opisina? Updated po ba ito regular?"

> "Kung may magbabago sa requirements (e.g., bagong dokumento needed para sa business permit), paano po ito ina-anunsyo sa publiko? May centralized announcement system po ba?"

> "Pwede po ba makakuha ng official document o file na naglilista ng lahat ng services na inaalok ng bawat opisina? Yung tipong PDF, Excel, o printed handbook?"

> "Sino po sa city hall ang may pinaka-updated na department contact list at office numbers?"

---

### C.4 — Layout at Floor Plan Confirmation

> "Sa floor plan po, may opisinang nakalabel na CSSYDO — ito po ba ang pareho sa City Social Services Department na nasa official department list?"

> "Yung 'Prosecutor' po na nasa Lower Ground Floor — ito po ba ang same office sa City Legal Services Office, o magkahiwalay sila?"

> "Saan po physically matatagpuan ang Office for Senior Citizens Affairs (OSCA), ang City Disaster Risk Reduction and Management Division (CDRRMD), at ang City College of Calamba? Nasa main City Hall building po ba sila o sa annex/separate building?"

> "Ang City Population Management Office po — may kopya po ba ito sa Second Floor at Third Floor? Alin po ang main public counter?"

> "Yung numero sa tabi ng bawat opisina sa floor plan (halimbawa, 'Treasury (20)', 'Health (10)') — ano po ang ibig sabihin nito? Bilang ng tauhan, kapasidad ng upuan, o iba pa?"

---

### C.5 — Citizen Pain Points

> "Sa karanasan po ninyo, ano ang pinaka-madalas na tanong ng mga mamamayan na unang pumapasok sa City Hall?"

> "Anong opisina po ang madalas hinahanap pero mahirap mahanap ng mga bisita?"

> "May araw po ba ng linggo o oras ng araw kung kailan mas maraming dumadayo? Para alam namin kung kailan mas marami ang concurrent users ng app."

> "Sa floor transitions po (galing Ground papunta Second Floor halimbawa) — gumagamit po ba sila ng hagdan o elevator? May elevator po ba available para sa publiko o staff lang?"

---

### C.6 — Pilot Deployment at Permission

> "Kung ang sistemang ito ay magiging successful sa dissertation evaluation, may interest po ba ang City Hall na i-deploy ito as a pilot project para sa mga bisita?"

> "Kung gusto naming maglagay ng printed QR code stickers sa mga pader (small, professional-looking), may approval po na kailangan? Sino po ang dapat hingan ng permiso?"

> "Pwede po bang humingi ng formal endorsement letter mula sa Office of the Mayor o Admin Office para sa survey at evaluation phase?"

> "Para sa SUS (System Usability Scale) evaluation po, kailangan naming ng 120 respondents na pwedeng sumagot ng survey sa loob ng City Hall. May allowed timeframe po ba o specific arrangement na kailangan?"

---

### C.7 — Logistics

> "Anong araw at oras po ang pinaka-okay para mag-survey kami ng floor? Mas okay po ba na hindi peak hours?"

> "May lugar po ba sa City Hall na pwedeng gawing temporary workstation namin habang nag-eencode kami ng data? Need lang po ng table at outlet."

> "Sino po ang point of contact namin para sa follow-up questions habang nasa fieldwork phase pa kami?"

---

## D. What I Need from the Survey to Build the System

For each office, I need:

| Field | Example | Source |
|---|---|---|
| `floor` | 1 | Confirmed during walk-through |
| `row, col` (0-indexed in 25×25 grid) | (12, 8) | Plotted from floor plan + measurement |
| `name` (canonical) | "City Treasury Office" | Already in departments.json |
| `aliases` | ["Treasury", "Tax Payments"] | What citizens actually call it |
| `services` | Linked from services.json | Confirmed with personnel |
| `door_position` | "south wall" | Visual inspection |
| `qr_anchor_cells` | [(11,8), (13,8)] | Pick wall positions for QR codes |
| `office_hours` | "8AM–5PM Mon-Fri" | Ask personnel |

---

## E. Output for Each Floor After Survey

1. Mark up the printed anonymized floor plan with corrections (red pen)
2. Photograph each corrected plan
3. Fill in the corresponding rows in `departments.json` for that floor
4. Test the pathfinding live on phone before leaving the floor
5. Place sample QR codes on 4–6 walls per floor and verify scanning

---

## F. Red Flags to Watch For

- **Wi-Fi dependency**: if the building has weak/no Wi-Fi, the SUS evaluation must use mobile data — clarify with respondents
- **Construction or renovation**: any floor under construction needs to be excluded
- **Security-restricted areas**: e.g., Mayor's private office, IT server room — should not be navigable
- **Privately-leased offices**: COMELEC, Landbank — confirm they're OK with being shown on a public map
- **Outdated floor plan**: the scanned plan may not reflect recent office moves — always confirm in person

---

## G. Survey Readiness Status (Today)

| Floor | Status | Notes |
|---|---|---|
| Ground (Floor 1) | ✅ **Ready to survey now** | Anonymized plan complete; questions prepared; 7–8 offices manageable |
| Lower Ground (Floor 0) | ⚠️ Needs OSCA/CDRRMD confirmation first | But can be done same day if personnel confirm |
| Second (Floor 2) | ⚠️ Population office duplicate needs resolution | Can be done same day |
| Third (Floor 3) | ⏳ Survey last | Lowest priority — mostly executive offices |

---

## H. After All 4 Floors are Surveyed

- [ ] All 21 entries in `departments.json` have non-null `floor`, `row`, `col`
- [ ] `metresPerCell` calibrated for the building (one measurement is enough)
- [ ] 16–24 QR anchor positions chosen (4–6 per floor)
- [ ] Test pathfinding between every pair of common destinations (e.g., entrance → top 5 offices)
- [ ] Inter-floor pathfinding tested at every stair location
- [ ] Begin RAG corpus expansion: feed services.json into FAISS, test sample queries
- [ ] Schedule SUS evaluation date with City Hall admin

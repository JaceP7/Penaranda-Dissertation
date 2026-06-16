# QR Anchor Placement Plan (PDR repositioning)

**Purpose.** Posted QR codes are the **primary** way a citizen is localised; PDR step-counting is the backup. Each posted QR encodes a deep link (`?qr=floor:row,col`) that a phone's **native camera** opens — it sets both the **position** and the **floor** instantly, resetting accumulated PDR drift to ~0.

**Floor indices:** `0` = Lower Ground, `1` = Ground, `2` = 2nd, `3` = 3rd.
Generate each QR in-app: admin view → Navigate → **🏷 Gen QR** → enter floor/row/col → Save PNG → print → post.

> Coordinates below are derived from the baked floor layout (stair clusters + the configured main entrance + high-traffic offices). Treat them as **design targets**; do a 30-minute on-site check (objective A2) and, if a sign lands more than a few cells off, regenerate that QR with the corrected cell.

---

## Why these spots (the placement logic)

1. **PDR error grows with distance since the last fix.** Anchors reset it. Target: no reachable point is more than ~one wing (~15–20 m) from an anchor, so worst-case drift stays inside a corridor.
2. **Vertical movement is PDR's blind spot.** The phone has no reliable altimeter and floor changes are confirmed manually. A QR at **every stair/elevator landing** fixes *both* position *and* floor in one scan — the single highest-value anchor type.
3. **Put them where people naturally pause** — entrances, service counters, landings. Scanning fits the flow, and there's usually a flat wall/pillar at eye level for the sign.
4. **Self-describing.** Because each QR carries `floor:row,col`, a wrong-floor guess self-corrects the moment a citizen scans on arrival.
5. **Grid scale:** 75×75 ≈ 45 m across → ~0.6 m/cell. A wing ≈ 30 cells ≈ 18 m, so one anchor per wing entrance + per landing keeps typical drift under ~10 m.

---

## Tier 1 — Entry baseline (highest priority, 1 sign)

| Location | Deep link | Reasoning |
|---|---|---|
| Ground-floor main entrance / MOPAC public-assistance counter | `?qr=1:38,72` | Every visitor enters here; it's the configured default start and sits in the MOPAC cluster next to the Citizen's Charter board (21,68). This is the origin for everyone who doesn't scan elsewhere first. |

*(If the real main public door is the bottom-center lobby, also anchor `?qr=1:72,29` and `?qr=1:72,46` — those bottom stair/door cells exist only on the Ground floor, which usually signals the main entrance lobby. Confirm on-site.)*

---

## Tier 2 — Stair / elevator landings (post on EVERY floor)

The five distinct stairwells repeat on every floor. Post one QR at each landing, on each floor, encoding **that floor's** index. This is where drift + floor errors are largest (the user just changed level).

| Stairwell | Cell | Ground (1) | 2nd (2) | 3rd (3) | Lower Ground (0) |
|---|---|---|---|---|---|
| North-center | (12,33) | `1:12,33` | `2:12,33` | `3:12,33` | `0:12,33` |
| East | (26,72) | `1:26,72` | `2:26,72` | `3:26,72` | `0:26,72` |
| West | (26,3) | `1:26,3` | `2:26,3` | `3:26,3` | `0:26,3` |
| South-left | (60,26) | `1:60,26` | `2:60,26` | `3:60,26` | `0:60,26` |
| South-right | (60,49) | `1:60,49` | `2:60,49` | `3:60,49` | `0:60,49` |

*(The north stairwell is actually a pair at (12,33)+(12,41); one sign between them is enough. The 3rd floor has no west stair in the layout — skip `3:26,3`.)*

Full deep link example for the East landing on the 2nd floor: `https://<your-app>/?qr=2:26,72`.

---

## Tier 3 — High-traffic offices far from the entrance (cap wing drift)

These are busy and sit deep in the wings, so by the time a citizen walks there from the east entrance, PDR drift is at its worst. A counter-side QR re-zeroes it right before the "arrive" moment.

| Office (Ground) | Approx. cell | Deep link | Why |
|---|---|---|---|
| Civil Registry (CCRO) | (54,7) | `?qr=1:54,7` | Births/marriages/deaths — very high traffic, far west wing. |
| Business Permit & Taxpayer Assistance (BPATFO) | (54,65) | `?qr=1:54,65` | Permit season volume; east-south wing. |
| Treasurer / Assessor counter (verify office) | mid-wing | regenerate on-site | Payments/RPT — confirm exact office + cell during the survey. |

Repeat the same idea on upper floors for their busiest offices (e.g., 2nd-floor CHRMO/CPDO clusters, 3rd-floor Session Hall).

---

## Tier 4 — Corridor decision junctions (optional, for big wings)

If any wing is longer than ~one anchor-spacing, add a QR at the corridor intersection (the cell where two hallways meet) so a citizen re-zeroes mid-walk. Use the quadrant centers as starting candidates and confirm against the real hallway layout on-site.

---

## Minimum viable set (if you only print a few)

1. `?qr=1:38,72` (main entrance) — **must have.**
2. The five Ground-floor landings (Tier 2, floor 1).
3. One QR at each landing on every other floor you expect visitors to use.

That alone gives every visitor an entry fix plus a fresh fix on each floor change — the two highest-impact corrections.

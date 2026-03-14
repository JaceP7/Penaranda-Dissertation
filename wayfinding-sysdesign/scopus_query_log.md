# Scopus Query Audit Log

**API Key**: b03f05ab148ec77a1db6561b0c78e580
**Date**: 2026-02-24
**API Base**: `https://api.elsevier.com/content/search/scopus`
**Sort**: `citedby-count` (descending)

---

## Query 1 — Data Architecture (Graph Model)

| # | Query | Results | Selected |
|---|-------|---------|----------|
| 1a | `TITLE-ABS-KEY("indoor wayfinding" AND "graph model")` | 0 | — |
| 1b | `TITLE-ABS-KEY("indoor navigation" AND "graph" AND "node" AND "edge")` | 13 | Lorenz2006 (86 cit), Liu2012 (24 cit), Willemsen2015 (24 cit) |
| 1c | `TITLE-ABS-KEY("indoor wayfinding" AND "graph")` | 8 | Zhang2017 (87 cit) |

**Selected papers for Pillar 1**:
- Lorenz et al. (2006) — DOI: 10.1007/11935148_10 — Hybrid spatial indoor model (86 citations)
- Liu & Zlatanova (2012) — DOI: 10.1145/2442616.2442618 — Semantic data model for indoor nav (24 citations)
- Zhang & Ye (2017) — DOI: 10.1109/TNSRE.2017.2682265 — Graph SLAM indoor wayfinding (87 citations)
- Willemsen et al. (2015) — DOI: 10.1109/IPIN.2015.7346952 — Routing-graph with MEMS (24 citations)

---

## Query 2 — Routing Engine (Dijkstra)

| # | Query | Results | Selected |
|---|-------|---------|----------|
| 2a | `TITLE-ABS-KEY("Dijkstra" AND "indoor navigation")` | 66 | Lee2007 (93 cit), Wu2007 (44 cit), Hammadi2012 (39 cit), Jamali2017 (38 cit), Alqahtani2018 (21 cit) |
| 2b | `TITLE-ABS-KEY("multi-floor" AND "shortest path" AND "indoor")` | 3 | Xiong2020 (2 cit) |

**Selected papers for Pillar 2**:
- Lee (2007) — DOI: 10.1111/j.1467-8306.2007.00561.x — 3D navigable data model (93 citations)
- Wu et al. (2007) — DOI: 10.1109/ICIMP.2007.31 — Path planning for visually impaired (44 citations)
- Hammadi et al. (2012) — DOI: 10.1109/WI-IAT.2012.262 — Indoor localization with smartphones (39 citations)
- Jamali et al. (2017) — DOI: 10.1007/s10708-015-9675-x — Automated 3D indoor nav network (38 citations)
- Alqahtani et al. (2018) — DOI: 10.1109/NCG.2018.8593096 — Survey on indoor nav algorithms (21 citations)
- Xiong et al. (2020) — DOI: 10.14188/j.2095-6045.2018107 — Multi-story path planning (2 citations)

---

## Query 3 — Distance Approximation

| # | Query | Results | Selected |
|---|-------|---------|----------|
| 3a | `TITLE-ABS-KEY("indoor localization" AND "scale factor")` | 8 | General IMU/localization papers; not directly applicable to pixel-to-meter |
| 3b | `TITLE-ABS-KEY("indoor wayfinding" AND "graph")` | 8 | Makri2015 (10 cit), Park2020 (7 cit) |
| 3c | `TITLE-ABS-KEY("indoor navigation" AND "WIFI-RSSI")` (from Dijkstra results) | — | Kasantikul2015 (23 cit) |

**Selected papers for Pillar 3**:
- Makri et al. (2015) — DOI: 10.5194/isprsarchives-XL-4-W5-29-2015 — Indoor wayfinding replicating outdoor nav (10 citations)
- Park & Goldberg (2020) — DOI: 10.1111/tgis.12632 — Network model quality comparison (7 citations)
- Kasantikul et al. (2015) — DOI: 10.1109/ICUFN.2015.7182597 — Enhanced indoor nav with distance modeling (23 citations)

---

## Query 4 — Orientation Tracking

| # | Query | Results | Selected |
|---|-------|---------|----------|
| 4a | `TITLE-ABS-KEY("DeviceOrientation" AND "compass" AND "web")` | 0 | — |
| 4b | `TITLE-ABS-KEY("mobile browser" AND "orientation sensor")` | 2 | Mehrnezhad2016 (44 cit), Mehrnezhad2018 (42 cit) |
| 4c | `TITLE-ABS-KEY("device orientation" AND "indoor" AND "web")` | 2 | Not directly relevant |
| 4d | `TITLE-ABS-KEY("compass heading" AND "smartphone" AND "navigation")` | 3 | Mansour2021 (10 cit), Ando2016 (1 cit) |

**Selected papers for Pillar 4**:
- Mehrnezhad et al. (2016) — DOI: 10.1016/j.jisa.2015.11.007 — Mobile sensor access via JavaScript (44 citations)
- Mehrnezhad et al. (2018) — DOI: 10.1007/s10207-017-0369-x — Mobile sensor security perception (42 citations)
- Mansour et al. (2021) — DOI: 10.3390/ecsa-8-11302 — PDR drift control with compass (10 citations)
- Ando et al. (2016) — DOI: 10.1109/I2MTC.2016.7520378 — Compass heading compensation (1 citation)

**Supplementary (non-Scopus)**:
- W3C DeviceOrientation Event Specification (2024)

---

## Query 5 — Mobile-First UX

| # | Query | Results | Selected |
|---|-------|---------|----------|
| 5a | `TITLE-ABS-KEY("mobile-first" AND "wayfinding")` | 0 | — |
| 5b | `TITLE-ABS-KEY("web application" AND "indoor navigation")` | 16 | Ludwig2023 (9 cit), Chitra2023 (0 cit), Sawaby2019 (8 cit), Wang2014 (10 cit) |
| 5c | `TITLE-ABS-KEY("touch target size" AND "mobile")` | 7 | Used for WCAG touch target evidence |
| 5d | `TITLE-ABS-KEY("mobile wayfinding" AND "user interface")` | 3 | Liu2009 (28 cit) |
| 5e | `TITLE-ABS-KEY("indoor wayfinding" AND "graph")` | 8 | DeCock2021 (13 cit) |

**Selected papers for Pillar 5**:
- Ludwig et al. (2023) — DOI: 10.1007/s13218-022-00795-1 — URWalking web-based indoor nav (9 citations)
- Chitra et al. (2023) — DOI: 10.1109/ICCEBS58601.2023.10448673 — Indoor campus web nav (0 citations)
- Liu et al. (2009) — DOI: 10.1145/1639642.1639649 — Wayfinding for cognitive impairment (28 citations)
- De Cock et al. (2021) — DOI: 10.1080/13658816.2020.1719109 — Complexity at indoor decision points (13 citations)
- Sawaby et al. (2019) — DOI: 10.1109/MOCAST.2019.8742061 — Smart BLE indoor nav system (8 citations)
- Wang et al. (2014) — DOI: 10.1007/s11042-013-1656-9 — iNavigation web image-based (10 citations)

**Supplementary (non-Scopus)**:
- W3C WCAG 2.1 (2018) — Touch target sizing
- W3C Pointer Events Level 2 (2019) — Unified input model
- W3C Visual Viewport API (2023) — Keyboard-aware layout

---

## Summary

| Pillar | Scopus Papers | Supplementary | Total |
|--------|:---:|:---:|:---:|
| 1. Data Architecture | 4 | 0 | 4 |
| 2. Routing Engine | 6 | 0 | 6 |
| 3. Distance Approximation | 3 | 0 | 3 |
| 4. Orientation Tracking | 4 | 1 | 5 |
| 5. Mobile-First UX | 6 | 3 | 9 |
| **Total** | **23** | **4** | **27** |

Total unique bibliography entries: **23 Scopus-indexed + 4 W3C standards = 27**

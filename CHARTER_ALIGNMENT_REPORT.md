# Citizen's Charter Alignment — What Changed

_Generated: 2026-06-08T03:25:56+00:00_

This patch aligns the wayfinding app's office list and the RAG corpus's
`department` fields with the official Calamba City Citizen's Charter
(https://www.calambacity.gov.ph/Users/Home/CitizenCharter).

## Summary

| Metric | Before | After |
|---|---|---|
| Services in corpus | 235 | 235 (unchanged) |
| Unique departments in `services.json` | 25 | 25 |
| Canonical offices in `departments.json` | 21 | 31 |
| Department name renames applied | – | 6 |
| Services affected by renames | – | 98 |

## Files modified

| File | What changed |
|---|---|
| `wayfinding-app/data/services.json` | 5 department renames + 1 typo fix applied to 98 service rows |
| `wayfinding-app/data/departments.json` | Replaced with the new 31-office canonical list |
| `wayfinding-app/js/app.js` | `OFFICE_FALLBACK` array expanded from 21 → 31 entries (applied separately) |
| `rag_engine/index/faiss.index` + `metadata.jsonl` | Rebuilt to reflect new department spellings (applied separately) |

Backups left in place:
- `services.json.bak_pre_charter_align`
- `departments.json.bak_pre_charter_align`

## Department renames in `services.json`

These 5 (+ 1 typo) names were updated to match the Citizen's Charter spelling exactly.

| Old name | New (charter) name | Services affected |
|---|---|---|
| CITY SOCIAL SERVICES DEPARTMENT | CITY SOCIAL SERVICES OFFICE | 53 |
| VETERINARY SERVICES AND SLAUGHTERHOUSE MANAGEMENT OFFICE | CITY VETERINARY SERVICES AND SLAUGHTERHOUSE MANAGEMENT OFFICE | 18 |
| CITY DISASTER RISK REDUCTION AND MANAGMENT DIVISION - MO | CITY DISASTER RISK REDUCTION AND MANAGEMENT DIVISION - MO | 8 |
| OFFICE OF THE CITY VICE-MAYOR | OFFICE OF THE VICE MAYOR | 8 |
| OFFICE OF THE CITY MAYOR | OFFICE OF THE MAYOR | 6 |
| BUILDING REGULATORY SERVICES OFFICE | BUILDINGS REGULATORY SERVICES DEPARTMENT | 5 |


## Canonical office list — `departments.json` rebuild

The Capture Mode dropdown now lists all **31 canonical offices**
(28 from the Citizen's Charter + 3 well-known sub-units that citizens and floor plans
label separately).

### Newly added offices (previously not in the dropdown, no service entries yet)

These exist on the Charter page but had no representation in our local files.
On-site, you'll be able to pick them directly from the dropdown:

- CITY AGRICULTURAL SERVICES DEPARTMENT
- CITY BUDGET MANAGEMENT OFFICE
- CITY CIVIL REGISTRY OFFICE
- CITY ENGINEERING AND INFRASTRUCTURE DEVELOPMENT DEPARTMENT
- CITY GENERAL SERVICES OFFICE
- CITY TREASURY MANAGEMENT OFFICE
- CULTURAL AFFAIRS, TOURISM AND SPORTS DEVELOPMENT DEPARTMENT
- HOUSING AND SETTLEMENTS DEPARTMENT
- LEGISLATIVE SERVICES OFFICE
- PUBLIC ORDER AND SAFETY OFFICE


### Renamed offices (same office, charter spelling)

- BUILDING REGULATORY SERVICES OFFICE → **BUILDINGS REGULATORY SERVICES DEPARTMENT**
- CITY DISASTER RISK REDUCTION AND MANAGMENT DIVISION - MO → **CITY DISASTER RISK REDUCTION AND MANAGEMENT DIVISION - MO**
- CITY SOCIAL SERVICES DEPARTMENT → **CITY SOCIAL SERVICES OFFICE**
- VETERINARY SERVICES AND SLAUGHTERHOUSE MANAGEMENT OFFICE → **CITY VETERINARY SERVICES AND SLAUGHTERHOUSE MANAGEMENT OFFICE**
- OFFICE OF THE CITY MAYOR → **OFFICE OF THE MAYOR**
- OFFICE OF THE CITY VICE-MAYOR → **OFFICE OF THE VICE MAYOR**


### Unchanged offices (already matched the charter)

- BUSINESS PERMITS AND TRICYCLE FRANCHISING OFFICE
- CITY ACCOUNTING AND INTERNAL CONTROL OFFICE
- CITY ADMINISTRATION OFFICE
- CITY ASSESSMENT OFFICE
- CITY COLLEGE OF CALAMBA
- CITY ENVIRONMENT AND NATURAL RESOURCES DEPARTMENT
- CITY HEALTH SERVICES DEPARTMENT
- CITY HUMAN RESOURCE AND MANAGEMENT OFFICE
- CITY LEGAL SERVICES OFFICE
- CITY PLANNING AND DEVELOPMENT OFFICE
- CITY POPULATION MANAGEMENT OFFICE
- COOPERATIVES AND LIVELIHOOD DEVELOPMENT DEPARTMENT
- INFORMATION, INVESTMENT PROMOTIONS AND EMPLOYMENT SERVICES OFFICE
- OFFICE FOR THE SENIOR CITIZENS AFFAIRS
- PERSONS WITH DISABILITY AFFAIRS OFFICE


## Categories on the website (FYI — not in dropdown)

The Citizen's Charter exposes services under 12 thematic categories. **10 are populated; 2 are empty on the site itself** (the corresponding offices ARE in the dropdown, they just don't have services yet):

| serviceId | Category | Services on website |
|---|---|---|
| 6 | Certificates, Permits, and IDs | 57 |
| 7 | Business and Trade | 8 |
| 8 | Disaster and Weather | 5 |
| 9 | Registrations, Applications, Ordinances, and Others | 55 |
| 10 | Education, Training, Seminars, and Competencies | 28 |
| 11 | Employment | 2 |
| 12 | Health | 23 |
| 13 | **Housing** | **0** (empty on site) |
| 14 | Veterinary Services | 12 |
| 15 | Social Services | 38 |
| 16 | Tax | 7 |
| 17 | **Agricultural** | **0** (empty on site) |

## Next step — improve PDR

After this patch the office list, corpus, and FAISS index are all
consistent. Next we'll move to improving the PDR (Pedestrian Dead
Reckoning) accuracy: step detection threshold tuning, heading
smoothing, drift correction between QR scans.

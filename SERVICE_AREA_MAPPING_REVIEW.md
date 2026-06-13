# Service-area mapping review

Extracted from the 4 floor photo directories, joined to the 99 stamp placements
and the 31 canonical RAG departments. CONFIRM / CORRECT before it's baked into code.

## A. Canonical RAG department -> routing stamp(s)

| RAG department | Stamp(s) | Floor | Cell(s) found? |
|---|---|---|---|
| BUILDINGS REGULATORY SERVICES DEPARTMENT | 2F 13 OOTBO | 2nd Floor | yes |
| BUSINESS PERMITS AND TRICYCLE FRANCHISING OFFICE | GF 12a BPATFO, GF 12b BPATFO | Ground | yes |
| CITY ACCOUNTING AND INTERNAL CONTROL OFFICE | 2F 01a CAICO, 2F 01b CAICO | 2nd Floor | yes |
| CITY ADMINISTRATION OFFICE | 3F 29 Administration Office, Office of City Admin | 3rd Floor | yes |
| CITY AGRICULTURAL SERVICES DEPARTMENT | LG 17 CASD | Lower Ground | yes |
| CITY ASSESSMENT OFFICE | GF 09a CAO, GF 09b CAO | Ground | yes |
| CITY BUDGET MANAGEMENT OFFICE | 2F 20 CBMO | 2nd Floor | yes |
| CITY CIVIL REGISTRY OFFICE | GF 02a CCRO, GF 02b CCRO | Ground | yes |
| CITY COLLEGE OF CALAMBA | — | — | **MISSING (no stamp)** |
| CITY DISASTER RISK REDUCTION AND MANAGEMENT DIVISION - MO | — | — | **MISSING (no stamp)** |
| CITY ENGINEERING AND INFRASTRUCTURE DEVELOPMENT DEPARTMENT | 2F 14 CEIDD | 2nd Floor | yes |
| CITY ENVIRONMENT AND NATURAL RESOURCES DEPARTMENT | 2F 10a CENRD | 2nd Floor | yes |
| CITY GENERAL SERVICES OFFICE | — | — | **MISSING (no stamp)** |
| CITY HEALTH SERVICES DEPARTMENT | LG 04 CHSD | Lower Ground | yes |
| CITY HUMAN RESOURCE AND MANAGEMENT OFFICE | 2F 03 CHRMO | 2nd Floor | yes |
| CITY LEGAL SERVICES OFFICE | 2F 02 CLSO | 2nd Floor | yes |
| CITY PLANNING AND DEVELOPMENT OFFICE | 2F 19a CPDO, 2F 19b CPDO | 2nd Floor | yes |
| CITY POPULATION MANAGEMENT OFFICE | CPMO | 2nd Floor | yes |
| CITY SOCIAL SERVICES OFFICE | LG 10a CSSD, LG 10b CSSD | Lower Ground | yes |
| CITY TREASURY MANAGEMENT OFFICE | GF 05a CTMO, GF 05b CTMO, LG 08 CTMO | Ground, Lower Ground | yes |
| CITY VETERINARY SERVICES AND SLAUGHTERHOUSE MANAGEMENT OFFICE | LG 16 CVASMD | Lower Ground | yes |
| COOPERATIVES AND LIVELIHOOD DEVELOPMENT DEPARTMENT | LG 24 CALDD | Lower Ground | yes |
| CULTURAL AFFAIRS, TOURISM AND SPORTS DEVELOPMENT DEPARTMENT | GF 01 CATSDD | Ground | yes |
| HOUSING AND SETTLEMENTS DEPARTMENT | LG 01 HASD, HSD Services | Lower Ground | yes |
| INFORMATION, INVESTMENT PROMOTIONS AND EMPLOYMENT SERVICES OFFICE | LG 09, Local Recruitment | Lower Ground | yes |
| LEGISLATIVE SERVICES OFFICE | SP Secretariat | 3rd Floor | yes |
| OFFICE FOR THE SENIOR CITIZENS AFFAIRS | — | — | **MISSING (no stamp)** |
| OFFICE OF THE MAYOR | Office of City Mayor | 3rd Floor | yes |
| OFFICE OF THE VICE MAYOR | Vice Mayor | 3rd Floor | yes |
| PERSONS WITH DISABILITY AFFAIRS OFFICE | PWD Office | Lower Ground | yes |
| PUBLIC ORDER AND SAFETY OFFICE | — | — | **MISSING (no stamp)** |

**Coverage: 26/31 canonical departments have a routable stamp.**

## B. Departments with NO stamp (need a decision)

- CITY COLLEGE OF CALAMBA
- CITY DISASTER RISK REDUCTION AND MANAGEMENT DIVISION - MO
- CITY GENERAL SERVICES OFFICE
- OFFICE FOR THE SENIOR CITIZENS AFFAIRS
- PUBLIC ORDER AND SAFETY OFFICE

Options for each: (a) it's not physically in City Hall (e.g. City College = separate campus);
(b) it exists but wasn't stamped — tell me the floor + I'll add it; (c) route to a fallback
(e.g. the Information/MOPAC desk) with a 'ask here' note.

## C. Corpus coverage — how many of the 235 services would route?

- Services whose department HAS a stamp: **197 / 235**
- Services whose department has NO stamp: **38**

Unroutable services by department:
  - CITY COLLEGE OF CALAMBA: 19 services
  - CITY DISASTER RISK REDUCTION AND MANAGEMENT DIVISION - MO: 8 services
  - OFFICE FOR THE SENIOR CITIZENS AFFAIRS: 6 services
  - CITY GENERAL SERVICES OFFICE: 3 services
  - PUBLIC ORDER AND SAFETY OFFICE: 2 services

## D. Ambiguities I need you to confirm

1. **IIPESO** (Information, Investment Promotions & Employment Services Office) — the note
   grouped it with CTMO near LG 08; I tentatively mapped it to the unlabeled `LG 09` stamp +
   the `Local Recruitment` window. Is LG 09 = IIPESO? Or is IIPESO elsewhere?
2. **Mayor's Clearance** — corpus says IIPESO issues it, but there's a physical `Mayor's
   Clearance` window on the 3rd floor. I set a service-override so that specific service
   routes to the 3F window. OK?
3. **LG 19 'COA'** — the door says *Commission on Elections (COMELEC)*, but your stamp
   abbreviation is COA. Confirmed it's COMELEC, not Commission on Audit? (There's a separate
   `COA` / 2F 05 Commission on Audit on the 2nd floor.)
4. **Legislative Services Office** = `SP Secretariat` (3F)? The charter lists 'Legislative
   Services Office'; the building has 'Sangguniang Panlungsod Secretariat'. Same thing?
5. **City General Services Office, Public Order & Safety, OSCA, CDRRMD-MO** — no stamps found.
   Are these in City Hall (which floor) or elsewhere?

## E. Stamps with NO department mapping (markers / tenants / sub-units)

- `2F 07 DILG` → Department of the Interior and Local Government
- `2F 11` → Maintenance Office
- `2F 16 MOIAS` → Mayor's Office Internal Audit Services
- `2nd Floor` → (floor centre marker)
- `3F 17a Session Hall` → SP Session Hall
- `3F 17d Session Hall` → SP Session Hall
- `3F 19 MOBAS` → 3F-19 (MOBAS)
- `3F 20 OEA` → Office of the Executive Assistant
- `3F 21` → 3F-21 (unlabeled)
- `3F 22` → 3F-22 (unlabeled)
- `3F 23` → 3F-23 (unlabeled)
- `3F 24` → Office of the Executive Assistant (3F-24)
- `3rd Floor` → (floor centre marker)
- `ABC Pres` → Association of Barangay Captains - President
- `CC Aldabe-Cortez` → (unknown)
- `CC Cabrera` → (unknown)
- `CC Catindig` → (unknown)
- `CC Dimapilis` → (unknown)
- `CC Lajara` → (unknown)
- `CC Lazaro` → (unknown)
- `CC Mangiat` → (unknown)
- `CC Morales` → (unknown)
- `CC Oruga` → (unknown)
- `CC Silva` → (unknown)
- `CC Soliman` → (unknown)
- `COA` → Commission on Audit
- `CR` → (unknown)
- `Chapel` → Mini Chapel
- `Citizen Charter` → Citizen's Charter board
- `DOC Cha Hernandez` → District Office of Congresswoman Cha Hernandez
- `DTI` → Department of Trade and Industry
- `GF 06` → Communication Room
- `GF 07` → Server Room
- `GF 13a and 13b M-PH` → Multi-purpose Hall
- `Ground Floor` → (floor centre marker)
- `Kasalang Bayan` → Kasalang Bayan (civil wedding)
- `LG 02a LandBank` → LandBank
- `LG 02b LandBank` → LandBank
- `LG 11 CPU` → Child Protection Unit
- `LG 19 COA` → Commission on Elections (COMELEC)
- `LG 20 OOTPP` → Office of the Provincial Prosecutor
- `LG 23 PPOPOL` → Provincial Prosecution Office, Province of Laguna
- `LG 25 BAC` → Bids and Awards Committee
- `Lower Ground Floor` → (floor centre marker)
- `MOPAC` → Mayor's Office Public Assistance Center
- `Mayor's Clearance` → Mayor's Clearance window
- `Office City Mayor Office-Sectoral Affair` → Mayor's Office - Sectoral Affairs
- `SNMSCGOC` → Samahan ng mga Manggagawa sa City Government of Calamba
- `Sangguniang Panglungsod Record` → Sangguniang Panlungsod Records
- `room 1` → (unlabeled room)
- `room 2` → (unlabeled room)
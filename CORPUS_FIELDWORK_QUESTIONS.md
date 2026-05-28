# Corpus Fieldwork Guide — Establishments to Visit + Clarification Questions
### Calamba City Hall · Geo-Agentic RAG · 2026

**Purpose:** Improve the RAG corpus (`services.json`) by collecting, per office:
1. The **complete list of services** offered
2. Per service: **requirements, steps, fees, processing time**
3. **Aliases** — what citizens informally call the office/service
4. **Disambiguation** — what people mistakenly come for + where they should go

Bring this printed. Ask in Taglish. Record answers in your notebook or record audio (with permission).

---

## 🎯 Why this matters (evidence from the RAG test)

A pre-fieldwork test of 30 citizen queries showed **4 retrieval failures** — all caused by the corpus lacking common-language terms:

| Citizen asked | System wrongly returned | Real office | Fix |
|---|---|---|---|
| "real property tax" | Building Regulatory | Assessment / Treasury | add tax aliases |
| "marriage license" | Legal | Civil Registry / Population | add civil-registry terms |
| "office ng mayor" | IIPESO | Office of the Mayor | enrich mayor entry |
| "magpa-check ng aso at pusa" (vet) | Assessment | Veterinary | add animal-care terms |

Also, **10 of 21 offices have only 1–2 services documented** — too thin for reliable retrieval. These are flagged ⚠️ below and are the **top priority** for enrichment.

---

## 📋 Universal questions — ask these at EVERY office

Ask the staff (in Taglish):

> **Q1 (services):** "Ano-ano po lahat ng serbisyo na pwedeng kunin dito sa opisina ninyo?"
> *(List every service. Get the complete set — the corpus is incomplete.)*

> **Q2 (per service):** "Para sa bawat serbisyo po, ano ang mga requirements, ang mga hakbang, magkano ang bayad, at gaano katagal ang proseso?"
> *(Requirements + steps + fee + processing time, per service.)*

> **Q3 (aliases):** "Ano po ang madalas na tawag ng mga tao sa opisina o serbisyo na ito? May ibang pangalan o palayaw ba?"
> *(Informal names → these become search aliases.)*

> **Q4 (disambiguation):** "Ano po ang madalas na MALING punta dito? Yung mga tao na akala dito kukuha pero dapat nasa ibang opisina — saan po dapat sila pumunta?"
> *(Captures overlap/confusion between offices.)*

> **Q5 (frequency):** "Ano po ang pinaka-madalas hingin dito? At may peak days/hours ba?"
> *(Helps prioritize corpus depth + informs analytics expectations.)*

---

## 🗺️ Establishments by floor (walk order)

> Floor index = internal system floor (0=Lower Ground … 3=Third).
> ⚠️ = thin corpus (1–2 services documented) → **priority enrichment**.

### FLOOR 1 — GROUND (do first; public entry, highest traffic)

| Office | Corpus depth | Priority extra questions |
|---|---|---|
| **City Treasury Office (Main)** | — | "Dito po ba ang bayad ng real property tax (amilyar)? O sa Assessment? Ano-ano ang binabayaran dito — RPT, business tax, fees?" |
| **City Assessment Office** | 7 (ok) | "Ano ang pagkakaiba ng ginagawa ninyo vs. Treasury para sa property? Sino ang nag-a-assess at sino ang naniningil?" |
| **Business Permits & Tricycle Franchising Office (BPLO)** | 6 (ok) | "Bukod sa business permit at tricycle franchise, ano pa? New vs renewal — magkaiba ba ang requirements?" |
| **Local Civil Registry** | — | "Dito po ba kumukuha ng marriage license, birth/death/marriage certificate? Ano ang requirements ng marriage license?" |
| **General Services Office (GSO)** | — | "Anong serbisyo ang para sa publiko dito? O internal lang sa city hall? (i-confirm kung dapat ba sa system)" |
| **Tourism Office** | — | "Anong serbisyo ang hinihingi ng publiko dito?" |
| **MOPAC** | ⚠️ verify | "Ano po ang MOPAC? Ano ang ibig sabihin ng letters? Anong serbisyo? **Ito po ba ang City Legal Services Office o magkaiba?**" |

### FLOOR 0 — LOWER GROUND

| Office | Corpus depth | Priority extra questions |
|---|---|---|
| **City Social Services Department** | 6 (ok) | "**CSSYDO po ba kayo o magkaiba?** Ano ang para sa burial assistance, financial aid, AICS? Sino dapat puntahan para sa social aid?" |
| **Persons with Disability Affairs (PDAO)** | ⚠️ 1 | "Bukod sa PWD ID, ano pa ang serbisyo? Renewal, benefits, discounts assistance?" |
| **City Health Services Department** | 6 (ok) | "Vaccination — tao lang ba dito? Health cert, medical, sanitary permit? Ano ang requirements?" |
| **IIPESO** (Investment, Promotions, Employment) | 4 (ok) | "Job placement, PESO, scholarship? Ano ang ibig sabihin ng IIPESO? Ano ang tawag dito ng karaniwang tao?" |
| **City Treasury Annex** (if separate) | — | "Ano ang ginagawa dito vs. Treasury sa Ground floor?" |
| **Cooperatives & Livelihood Dev't Dept (COOP)** | 3 (ok) | "Cooperative registration, livelihood programs — ano ang requirements at steps?" |
| **Veterinary Services & Slaughterhouse Mgmt** | 6 (ok) | "Para sa aso/pusa/hayop — check-up, vaccine (anti-rabies), pet registration? Ano tawag ng tao? (e.g. 'pa-bakuna ng aso')" |

### FLOOR 2 — SECOND

| Office | Corpus depth | Priority extra questions |
|---|---|---|
| **City Planning & Development Office (CPDO)** | 5 (ok) | "Zoning, locational clearance, subdivision? Ano ang pagkakaiba sa Building Regulatory?" |
| **City Accounting & Internal Control** | ⚠️ 2 | "Anong serbisyo ang para sa publiko? O internal lang? Confirm kung dapat ba sa system." |
| **Building Regulatory Services Office (BRSO)** | 5 (ok) | "Building permit, occupancy, electrical inspection — steps at requirements? Kailan dito vs. Planning?" |
| **City Human Resource Mgmt Office (HR)** | ⚠️ 1 | "Para sa publiko: job application sa city hall? Civil service? Ano ang serbisyo na pwedeng hingin ng tao?" |
| **City Environment & Natural Resources (CENRO)** | ⚠️ 2 | "Tree cutting permit, environmental clearance, waste? Ano-ano ang serbisyo at requirements?" |
| **City Population Management Office** | ⚠️ 2 | "**Nasa 2nd floor po ba o 3rd ang main counter?** Ano ang serbisyo — RH, PopCom, family planning? **May kinalaman ba sa marriage license?**" |
| **City Budget Office** | — | "Para sa publiko ba ito o internal? Confirm kung dapat sa system." |

### FLOOR 3 — THIRD (executive)

| Office | Corpus depth | Priority extra questions |
|---|---|---|
| **Office of the City Mayor** | ⚠️ 2 | "Anong serbisyo ang pwedeng hingin ng karaniwang tao dito? Mayor's clearance, endorsement, appointment, assistance? Ano ang tawag dito?" |
| **Office of the City Vice-Mayor** | ⚠️ 1 | "Anong serbisyo para sa publiko? Sangguniang Panlungsod / ordinance requests?" |
| **City Administration Office** | 4 (ok) | "Anong serbisyo para sa publiko? **Dito ba ang barangay clearance / certifications?**" |

---

## ❓ Cross-cutting disambiguation (resolve these explicitly)

Ask whoever can answer (info desk, admin, or the specific office):

1. **CSSYDO = City Social Services Department?** Same office or two different? (corpus uses "CITY SOCIAL SERVICES DEPARTMENT")
2. **Prosecutor / MOPAC = City Legal Services Office?** Same or separate? Where is each?
3. **Office for Senior Citizens Affairs (OSCA)** — anong floor, saang office? (corpus has it but blueprint unclear)
4. **City Disaster Risk Reduction & Management (CDRRMD)** — nasa main building po ba? Anong floor?
5. **City College of Calamba** — nasa City Hall building po ba o hiwalay na campus? (likely separate)
6. **City Population Office** — 2nd floor o 3rd ang public counter? May annex ba?
7. **Real property tax (amilyar)** — Treasury ba o Assessment ang bayaran? (RAG failed here)
8. **Marriage license** — Civil Registry ba o Population? Ano ang exactong requirements? (RAG failed here)
9. **Barangay clearance** — Administration ba, Population, o sa barangay mismo? (RAG failed here)
10. **Numbers in parentheses on the blueprint** (e.g., "Treasury (20)") — ano ibig sabihin? Bilang ng tao? Upuan?

---

## 🏢 Offices to confirm IN/OUT of system scope

The blueprint shows offices NOT in the 21-department corpus. Confirm whether walk-in citizens transact there (include) or they're internal/partner (exclude):

- COMELEC — *(partner agency — likely exclude, but confirm)*
- Landbank — *(partner bank — likely exclude)*
- Housing Office — *(include?)*
- DILG — *(partner — likely exclude)*
- Engineering / Services Office — *(include?)*
- Sectoral Affairs — *(include?)*
- Sangguniang Bayan / Panlungsod Secretariat — *(include?)*
- Agriculture Office — *(include? has services in some LGUs)*

Question: "Pumupunta po ba dito ang ordinaryong mamamayan para mag-transact, o internal/partner agency lang po ito?"

---

## 📝 What to bring back for the corpus

For each office, you should leave with:

```
OFFICE: ________________________________  (official name)
ALIASES: _______________________________  (informal names citizens use)
SERVICES (complete list):
  1. ____________  | requirements: ______ | steps: ______ | fee: ____ | time: ____
  2. ____________  | ...
  3. ...
MISTAKEN-FOR: people often come here for ______ but should go to ______
PEAK: busiest day/hour ______
IN SYSTEM SCOPE? Y / N
```

The richer this is, the better the RAG retrieval. **Prioritize the ⚠️ thin offices** — they're currently the weakest part of the corpus.

---

## 🔗 Best source: the Citizen's Charter

Ask each office (or the admin office) for their **2024–2025 Citizen's Charter** entry — it already lists services, requirements, steps, and fees in official form. If you can get a digital/printed copy, that's the gold-standard corpus source and reduces guesswork.

> "Meron po ba kayong kopya ng Citizen's Charter ninyo? Yung naglilista ng services, requirements, at steps? Pwede po bang makakuha ng kopya para sa research?"

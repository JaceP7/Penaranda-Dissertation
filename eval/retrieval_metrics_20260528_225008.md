# Retrieval Metrics — 2026-05-28 22:50

- Pipeline: multilingual-e5-large + FAISS + bge-reranker (CPU, local)
- Query rewriting: OFF (raw queries — isolates retrieval)
- Relevance: department-level (correct office surfaced)
- Scored queries: 28 (ambiguous/out-of-scope excluded)

## Aggregate (macro-average)

| Metric | @1 | @3 | @5 |
|---|---|---|---|
| Recall | 0.079 | 0.215 | 0.318 |
| Precision | 0.607 | 0.619 | 0.614 |
| NDCG | 0.607 | 0.623 | 0.627 |

**MRR: 0.714**

## Per-query

| ID | Query | Expected | Top-1 retrieved | R@1 | MRR |
|---|---|---|---|---|---|
| Q01 | Saan po pwedeng mag-apply ng b | BUSINESS PERMITS AND TRI | BUSINESS PERMITS AND TRI | 0.07 | 1.00 |
| Q02 | Pano kumuha ng building permit | BUILDING REGULATORY SERV | BUILDING REGULATORY SERV | 0.20 | 1.00 |
| Q03 | Saan po nagbabayad ng real pro | CITY ASSESSMENT OFFICE | CITY ASSESSMENT OFFICE | 0.08 | 1.00 |
| Q04 | Pano mag-apply ng senior citiz | OFFICE FOR THE SENIOR CI | OFFICE FOR THE SENIOR CI | 0.17 | 1.00 |
| Q05 | Saan kukuha ng PWD ID? | PERSONS WITH DISABILITY  | PERSONS WITH DISABILITY  | 0.50 | 1.00 |
| Q06 | Where to get marriage license? | CITY POPULATION MANAGEME | OFFICE FOR THE SENIOR CI | 0.00 | 0.33 |
| Q07 | Saan ang office ng mayor? | OFFICE OF THE CITY MAYOR | OFFICE OF THE CITY MAYOR | 0.17 | 1.00 |
| Q08 | Saan magpa-check ng aso at pus | VETERINARY SERVICES AND  | OFFICE OF THE CITY VICE- | 0.00 | 0.33 |
| Q09 | Pano mag-renew ng business per | BUSINESS PERMITS AND TRI | BUSINESS PERMITS AND TRI | 0.07 | 1.00 |
| Q10 | Saan ang health office? | CITY HEALTH SERVICES DEP | OFFICE FOR THE SENIOR CI | 0.00 | 0.25 |
| Q11 | Saan mag-apply ng tricycle fra | BUSINESS PERMITS AND TRI | BUSINESS PERMITS AND TRI | 0.07 | 1.00 |
| Q12 | Pano mag-register ng cooperati | COOPERATIVES AND LIVELIH | COOPERATIVES AND LIVELIH | 0.17 | 1.00 |
| Q13 | Saan ang job placement office? | INFORMATION, INVESTMENT  | CITY ADMINISTRATION OFFI | 0.00 | 0.20 |
| Q14 | Saan magtanong tungkol sa baha | CITY DISASTER RISK REDUC | CITY DISASTER RISK REDUC | 0.00 | 0.00 |
| Q15 | Saan po para sa burial assista | CITY SOCIAL SERVICES DEP | OFFICE FOR THE SENIOR CI | 0.00 | 0.33 |
| Q16 | Where can I get a barangay cle | CITY ADMINISTRATION OFFI | CITY ASSESSMENT OFFICE | 0.00 | 0.20 |
| Q17 | How do I apply for a business  | BUSINESS PERMITS AND TRI | BUSINESS PERMITS AND TRI | 0.07 | 1.00 |
| Q18 | Saan office ng vice mayor? | OFFICE OF THE CITY VICE- | OFFICE OF THE CITY VICE- | 0.12 | 1.00 |
| Q19 | Saan mag-pa-assess ng property | CITY ASSESSMENT OFFICE | CITY ASSESSMENT OFFICE | 0.09 | 1.00 |
| Q20 | Pano mag-apply ng work sa city | CITY HUMAN RESOURCE AND  | CITY ADMINISTRATION OFFI | 0.00 | 0.00 |
| Q21 | Saan po ang office para sa env | CITY ENVIRONMENT AND NAT | CITY ENVIRONMENT AND NAT | 0.20 | 1.00 |
| Q23 | Where office ng business permi | BUSINESS PERMITS AND TRI | BUSINESS PERMITS AND TRI | 0.07 | 1.00 |
| Q25 | treasry?? | CITY ACCOUNTING AND INTE | BUSINESS PERMITS AND TRI | 0.00 | 0.50 |
| Q26 | Saan ang opisina para sa pagpa | CITY PLANNING AND DEVELO | OFFICE OF THE CITY MAYOR | 0.00 | 0.50 |
| Q27 | Pano mag-enroll sa City Colleg | CITY COLLEGE OF CALAMBA | CITY COLLEGE OF CALAMBA | 0.05 | 1.00 |
| Q28 | Saan magpa-konsulta tungkol sa | CITY LEGAL SERVICES OFFI | CITY SOCIAL SERVICES DEP | 0.00 | 0.33 |
| Q29 | Mayroon ba kayong vaccination  | CITY HEALTH SERVICES DEP | VETERINARY SERVICES AND  | 0.02 | 1.00 |
| Q30 | I need help finding the office | BUILDING REGULATORY SERV | CITY PLANNING AND DEVELO | 0.09 | 1.00 |
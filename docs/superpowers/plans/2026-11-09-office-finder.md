# Office finder: implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Answer "where is [office]" from the map instead of the assistant, and stop "Take me there" from appearing on answers that found nothing or that ask the user to choose.

**Architecture:**
- A pure detection module, `lib/office_finder.js`, called first in `api/chat.js`.
- A guard on the existing `resolveDept()` fallback.
- A client function, `describeOfficeLocation()` in `service_locations.js`, that writes the sentence from the live stamps. `chat.js` uses it for `kind: 'location'` replies.

**Tech Stack:** Vercel Node serverless (CommonJS), vanilla browser JS, and Node test scripts in `tools/` with a fake `fetch`.

**Spec:** `docs/superpowers/specs/2026-11-09-office-finder-design.md`

## Global Constraints

- **Canonical department strings** are the 31 values of `department` in `wayfinding-app/data/services.json`, copied exactly. The Public Assistance Center entry uses `MAYOR'S OFFICE PUBLIC ASSISTANCE CENTER`.
- **A location question never calls Upstash Vector or Groq.**
- **Response shape stays backward compatible:** `answer`, `department`, `subservice`, `needsContext`, `options` and `rate_limited` are always present. New fields: `kind`, `lang`, `office`.
- **Copy:** use the sentences in the spec's decisions 4 and 6–8 exactly. Use no emoji in the new strings.
- **Cache-busting:** bump `index.html` to `service_locations.js?v=8` and `chat.js?v=41`.
- **Commits:** authored by JCEPenaranda with no `Co-Authored-By` line. Commit on `main`, and push only in Task 4.
- **Tests:** after every task, run the full suite from the repo root:
  ```bash
  for t in tools/test_*.js; do node "$t" . || exit 1; done; python tools/test_analytics_range_local.py .
  ```

## Review Focus

1. **Common words caught as office names:**
   - "where do I get a health certificate" names no office alias, so it stays with the assistant.
   - "saan ang sp" matches "sp" only as a whole word.
   - "San Pedro" without an office stays with the assistant.

   Tests are in Task 1.
2. **Questions about a service at an office,** like "saan kukuha ng cedula sa treasury", stay with the assistant, because that answer carries the requirements. Test in Task 1.
3. **A resolved answer that happens to contain "which" mid-sentence,** such as "the form, which you can get at the window", must keep its fallback button. Only a final question mark or the listed phrases count as a clarification. Test in Task 2.
4. **Old cached clients (`chat.js` v40)** receive a location reply. They show the server's fallback sentence and a working button. Test in Task 2: the fallback `answer` is non-empty and `department` is set.
5. **An office whose stamps were removed** in a republished map gets the not-on-map sentence, not an error. Test in Task 3: stub `STAMP_PLACEMENTS` without BPLO.

---

### Task 1: `lib/office_finder.js`

**Files:**
- Create: `lib/office_finder.js`
- Test: `tools/test_office_finder.js`

**Interfaces (Produces):**
- **`OFFICES: { dept, name, abbr: string[], aliases: string[] }[]`:** 32 entries, one per canonical department plus the Public Assistance Center. `name` is the display name.
- **`CLASH: { [alias]: dept[] }`:** `{ cao: [CITY ASSESSMENT OFFICE, CITY ADMINISTRATION OFFICE, CITY AGRICULTURAL SERVICES DEPARTMENT], chsd: [CITY HEALTH SERVICES DEPARTMENT, HOUSING AND SETTLEMENTS DEPARTMENT] }`
- **`normalise(s) → string`**
- **`findOfficeQuestion(query) → null | { kind: 'location', office: { dept, name, abbr: string|null }, clash: null } | { kind: 'location', office: null, clash: { alias: 'CAO', offices: { dept, name }[] } }`**. `abbr` is the abbreviation as the user typed it, uppercased, or null when they typed a name.

- [ ] **Step 1:** Write the tests:
  - **Each live question → the right department:** BPLO → `BUSINESS PERMITS AND TRICYCLE FRANCHISING OFFICE` (abbr `BPLO`), PESO → IIPESO, POSO → `PUBLIC ORDER AND SAFETY OFFICE`, CCRO by full name (abbr null), "saan ang City Treasury?" → CTMO, "where is the city health office" → CHSD.
  - **Filipino and Taglish:** "nasan po yung assessor", "asan ang building official", "san ang cswdo".
  - **Bare names:** "BPLO", "bplo po", "Treasury office?".
  - **Questions that must not be caught:**
    - "where do I get a health certificate";
    - "saan kukuha ng cedula sa treasury";
    - "requirements for business permit BPLO";
    - "San Pedro";
    - "how much is the fee at the assessor".
  - **Clashes:** "where is CAO" → clash with 3 offices; "nasaan ang chsd" → clash with 2.
  - **Overlap:** "where is the vice mayor" → `OFFICE OF THE VICE MAYOR`.
  - **Public Assistance Center:** "where is the information desk" → the Public Assistance Center.
  - **Every name is findable:** for every entry, `findOfficeQuestion('where is the ' + name)` returns that `dept`.
  - **Coverage:** the canonical departments in `services.json` all appear in `OFFICES`.
- [ ] **Step 2:** Run `node tools/test_office_finder.js .`. Expected: FAIL, the module is missing.
- [ ] **Step 3:** Implement it. Build the alias index once at load. Match ` alias ` against the padded, normalised query. Drop matches inside a longer match's span, and take the earliest one left.
- [ ] **Step 4:** Run the full suite. Expected: all pass.
- [ ] **Step 5:** Commit: `Recognise where-is questions and the names people use for each office`.

### Task 2: Wire the finder and the fallback guard into `api/chat.js`

**Files:**
- Modify: `api/chat.js` (handler before step 1, and `resolveDept`)
- Test: `tools/test_chat_handler.js` (new; the fake `fetch` answers the Upstash Vector, Groq and Redis URLs, and records each call)

**Interfaces:**
- **Consumes:** `findOfficeQuestion` (Task 1).
- **Produces:**
  - **A location reply:** `{ answer, department, subservice: null, needsContext, options, rate_limited: false, kind: 'location', lang, office }`.
    - `answer` is the fallback sentence in the right language.
    - In a clash: `department: null`, `needsContext: true`, and `options` are the "Where is the …?" or "Nasaan ang …?" strings.
  - **The log entry** gains `kind: 'location'`.
  - **`resolveDept(answer, results) → { dept: string|null, needsContext: boolean }`:** this replaces the current string return. The handler's `needsContext` comes from it.

- [ ] **Step 1:** Write the tests:
  - `location question: no vector or Groq fetch, 200, kind location, department set, answer non-empty` (Review Focus 4).
  - `log entry has kind location and lang`.
  - `clash: needsContext true, 3 options, department null`.
  - `not-found answer without Go to: department null, needsContext false`.
  - `clarification answer ending in "?": department null, needsContext true, options from results`.
  - `"Alin sa mga ito ang gusto mong malaman" (no "?") counts as clarification`.
  - `resolved answer containing "which you can get" with no Go to line → top result` (Review Focus 3).
  - `Go to line still wins`.
- [ ] **Step 2:** Run it. Expected: FAIL.
- [ ] **Step 3:** Implement the changes.
- [ ] **Step 4:** Run the full suite. Expected: all pass.
- [ ] **Step 5:** Commit: `Answer where-is questions from the office list and drop buttons from non-answers`.

### Task 3: The client writes the location sentence

**Files:**
- Modify: `wayfinding-app/js/service_locations.js`:
  - add `"MAYOR'S OFFICE PUBLIC ASSISTANCE CENTER": ["MOPAC"]` to `DEPT_STAMP_NAMES`;
  - add `describeOfficeLocation`;
  - bump `SERVICE_LOCATIONS_VERSION` to 2.
- Modify: `wayfinding-app/js/chat.js`. For `kind: 'location'`, replace the text with `describeOfficeLocation(...)`, use its `navDept` and `navLabel`, and store `navLabel` on the message. The department label shows `navLabel` when present.
- Modify: `wayfinding-app/index.html` (the version bumps).
- Test: `tools/test_office_sentence.js` (new; runs `floor_presets.js`, `stamp_presets.js` and `service_locations.js` in `vm`)

**Interfaces:**
- **Consumes:** `office` and `lang` from Task 2.
- **Produces:** `describeOfficeLocation(office: { dept, name, abbr }, lang: 'en'|'fil') → { text: string, navDept: string|null, navLabel: string|null }`:
  - **a mapped office:** `navDept = office.dept`, `navLabel = office.name`;
  - **an office not on the map:** `navDept` is the Public Assistance Center, `navLabel = 'Public Assistance Center'`;
  - **the City College:** both null.

- [ ] **Step 1:** Write the tests:
  - **BPLO in English:** the text starts `BPLO (Business Permits and Tricycle Franchising Office) is on the Ground Floor` and contains `right side`, `2 windows`.
  - **BPLO in Filipino:** the text starts `Ang BPLO` and contains `nasa Ground Floor` and `kanan`.
  - **Treasury:** the text names both the Ground Floor and the Lower Ground Floor.
  - **City Health:** the text contains `one floor below the main entrance`.
  - **POSO:** the text contains `isn't on the map yet` and `Public Assistance Center`. The result has `navLabel === 'Public Assistance Center'` and `navDept === "MAYOR'S OFFICE PUBLIC ASSISTANCE CENTER"`.
  - **The City College:** the text contains `own campus`, and `navDept === null`.
  - **BPLO with its stamps removed:** gives the not-on-map sentence (Review Focus 5).
  - **chat.js:** a static check that it calls `describeOfficeLocation` and renders `navLabel`.
  - **index.html:** loads `service_locations.js?v=8` and `chat.js?v=41`.
- [ ] **Step 2:** Run it. Expected: FAIL.
- [ ] **Step 3:** Implement the changes.
- [ ] **Step 4:** Run the full suite. Expected: all pass.
- [ ] **Step 5:** Commit: `Describe where an office is from the live map`.

### Task 4: Deploy and check live

- [ ] **Step 1:** Push `main`.
- [ ] **Step 2:** Once Vercel has deployed, send the six spec questions plus "certificate", "permit" and "where is CAO" to `/api/chat` with `x-health-check: 1`. Expected:
  - the six return `kind: 'location'` with the right departments;
  - "certificate" and "permit" return `department: null` and `needsContext: true`;
  - CAO returns 3 options.
- [ ] **Step 3:** Open the live site at phone width in the browser pane. Ask "where is BPLO?". Expected: the sentence and a Take me there button labelled with the office name. Tapping it draws the route. Take a screenshot.
- [ ] **Step 4:** Add to the analytics plan:
  - Task 9 gets `kinds: { service, location }` counts;
  - Task 10 gets a `kind` filter;
  - Task 14 shows "Location question" on Questions rows.
- [ ] **Step 5:** Note the 0% clarification rate since 2026-09-28 in `IMPLEMENTATION_AUDIT.md`, and update `SYSTEM_CONTEXT.md`. Commit and push.

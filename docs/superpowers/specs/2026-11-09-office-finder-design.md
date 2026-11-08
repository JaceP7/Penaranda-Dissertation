# Office finder: design

**Date:** 2026-11-09
**Status:** approved by Jace. He pasted the five-point proposal back, then said "go with the office finder first". The two clash rules below were offered as Claude's defaults and drew no objection.
**Scope:**
- the chat's handling of "where is [office]" questions;
- the "Take me there" button on answers that found nothing or that ask a follow-up question;
- the clarification flag those answers log.

## Why

### What six "where is" questions did on the live site (2026-11-09, sent as health checks)

| Question | Answer text | Where "Take me there" sent them |
|---|---|---|
| where is BPLO? | "couldn't find that, ask at the Information desk" | Housing and Settlements (wrong) |
| nasaan ang PESO? | same | City Treasury (wrong) |
| where is POSO? | same | City Treasury (wrong) |
| where is the City Civil Registry Office? | same | CCRO (right; the text contradicts it) |
| saan ang City Treasury? | same | Treasury (right; same contradiction) |
| where is the city health office | same | City Health (right; same contradiction) |

### Two vague questions on the same day

- **"certificate"** and **"permit":** the assistant correctly asked which certificate or permit was meant.
- But each answer also carried a button to an office (Social Services, City Administration), offered no tappable choices, and logged `needsContext: false`.
- All 37 questions in the live log have `needsContext: false`. So the clarification rate the paper reports under SOP 4.2.4 has read 0% since commit `2af3a7c` (2026-09-28).

### Causes

1. **The assistant has no location data.** Retrieval covers the 305 service records. The floors and positions live in the client's map.
2. **The fallback is too broad.** `resolveDept()` in `api/chat.js` falls back to the top search result whenever the answer has no "Go to:" line. That includes answers that found nothing, and answers that ask the user to choose. Because `needsContext` is computed as `!dept && …`, it can then never be true.
3. **Short names aren't in the service text.** BPLO, PESO, POSO and CSWDO are missing, so the vector search guesses.

## Decisions

1. **Detection runs on the server,** in `api/chat.js`, before the vector search. It uses a pure module, `lib/office_finder.js`. A location question makes no vector call and no Groq call.
2. **What counts as a location question:**
   - the question names an office (by alias), **and**:
     - it contains a location cue; **and**
     - it contains no service-request word, because "saan kukuha ng business permit sa BPLO" is a service question and stays with the assistant;
   - **or** the whole question is just an office name, ignoring filler words like *po, the, ang, sa, office, opisina, ba, please*.
   - **Location cues:** where, where's, located, location, floor, saan, saang, nasaan, nasan, asan, san, papunta, pumunta, punta, direction(s), how do I get to, how to get to, go to, take me to, dalhin mo ako.
   - **Service-request words:** requirement(s), require, kailangan, magkano, how much, fee(s), bayad, magbayad, pay, payment, apply, application, renew, renewal, kumuha, kukuha, makakuha, kuha, get a, request, process.
3. **Aliases:**
   - Each of the 31 departments in the live index (`wayfinding-app/data/services.json`) has an entry, and so does a new **Public Assistance Center** (the `MOPAC` stamp). It covers "information desk", "info desk", "help desk", "public assistance" and "MOPAC".
   - Each entry has a display name, its abbreviations, and its other names (titles like "Assessor", "Building Official" and "City Engineer"; older names like BPLO, PESO, CSWDO and OBO).
   - An office's display name is always one of its aliases.
   - Matching runs on normalised text: lowercase, apostrophes removed, other punctuation turned into spaces.
   - Where two aliases overlap, the longest wins ("vice mayor" beats "mayor"). Otherwise the first office mentioned wins.
   - The full table lives in `lib/office_finder.js`.
4. **Clash aliases ask which office is meant:**
   - **"CAO"** could be City Assessment, City Administration or City Agriculture.
   - **"CHSD"** could be City Health Services or Housing and Settlements.
   - The answer is "CAO can mean more than one office. Which one do you need?", or in Filipino "Higit sa isang office ang tinatawag na CAO. Alin ang kailangan mo?".
   - It offers one choice button per office, worded "Where is the City Assessment Office?" (Filipino: "Nasaan ang City Assessment Office?"). Tapping one comes back through the office finder.
   - It logs `needsContext: true` with no department.
5. **The client writes the sentence.** The editor can republish the map, so only the client knows where stamps are now.
   - The server returns `kind: 'location'`, `lang`, and `office: { dept, name, abbr }`, plus a plain fallback sentence for older cached clients: "BPLO (Business Permits and Tricycle Franchising Office). Tap Take me there and I'll show you the way."
   - `describeOfficeLocation(office, lang)` in `service_locations.js` builds the real sentence from the live stamps.
6. **The sentence:**
   - **Who:** `ABBR (Name)` when the user typed an abbreviation, else the name.
   - **Floor:** the floor name. For any floor but the Ground Floor, add how it relates to the entrance: "one floor below the main entrance", "one floor up", "two floors up".
   - **Position,** as you face in from the main entrance (73,37, facing up the grid):
     - **side** by column thirds: 0–24 is left, 25–49 the middle, 50–74 right;
     - **depth** by row thirds: 0–24 is toward the back, 25–49 the middle, 50–74 toward the front.
   - **Windows:** "It has N windows; I'll take you to the nearest one." when there is more than one. When the windows span floors, name each floor and describe the one nearest the entrance.
   - **Language:** Taglish when the server tags the question `fil` (the existing `langTag`), else English.
7. **Offices not on the map** (CDRRMD, General Services, OSCA, POSO) say so, and point to the Public Assistance Center:
   - English: "POSO (Public Order and Safety Office) isn't on the map yet. Ask at the Public Assistance Center: Ground Floor, …"
   - The button is labelled "Public Assistance Center" and routes there.
   - Navigation logs record the Public Assistance Center as the destination, not POSO.
8. **The City College of Calamba** gets "has its own campus. It isn't inside City Hall." with no button.
9. **Guard on the fallback.** When an answer has no "Go to:" line:
   - **Asks the user to choose** (it ends with a question mark, or contains *which one, which of these, alin, tukuyin, could you specify, please specify, please clarify, anong serbisyo*): no department, `needsContext: true`. The existing chip extraction then turns the listed options into buttons.
   - **Found nothing** (could not / couldn't / cannot / unable to find, not in the provided, hindi … mahanap/makita/nakita, walang … impormasyon/nakitang, information desk): no department, no button.
   - **Otherwise:** the top search result, as today.
10. **Logging:** location questions go in `wf:querylog` with `kind: 'location'`. The analytics plan gets a matching change: a count of location questions and a `kind` filter on the Questions page.

## Non-goals

- Restrooms, ATMs and other places that aren't offices.
- Opening hours.
- Turn-by-turn directions in the chat. The map already does that.
- Changing the assistant's prompt or retrieval.
- Rewriting past log entries.

## Verification

- **Unit tests for `lib/office_finder.js`:**
  - the six live questions;
  - Filipino and Taglish forms;
  - bare office names;
  - service questions that must not be caught;
  - both clashes;
  - "vice mayor" over "mayor";
  - every display name matching its own entry.
- **Handler tests for `api/chat.js`, with a fake `fetch`:**
  - a location question makes no vector or Groq call and logs `kind: 'location'`;
  - a not-found answer has no department;
  - a clarification answer has no department and `needsContext: true`;
  - a resolved answer that is missing its "Go to:" line still falls back to the top result.
- **Client tests:** `describeOfficeLocation` against the bundled stamps, for BPLO, Treasury (two floors), POSO (fallback), the City College and the Public Assistance Center.
- **After deploying:** rerun the six questions plus "certificate" and "permit" against the live site, as health checks.

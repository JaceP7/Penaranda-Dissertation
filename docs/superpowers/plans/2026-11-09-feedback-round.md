# Feedback round of 2026-11-09: implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Act on Jace's nine feedback items from the 2026-11-09 test session, and on what that day's 198 real questions showed.

**Decisions (Jace, 2026-11-09):**
- **Outside offices (#5):** say the office isn't in the building, offer a help-desk button, then show the nearest exits. Jace didn't confirm which unmapped offices are outside (CDRRMD, OSCA, CGSO, POSO). So those get "not on this map, may be outside City Hall"; only City College is called outside.
- **Pins (#7):** tap the map, then choose "I'm here" or "Go here".
- **Analytics (#9):** build the revamp now behind the staff PIN. Google sign-in comes later. This has its own plan (`2026-11-09-admin-analytics-revamp.md`, Phase 2).

**Evidence (2026-11-09; raw rows in the gitignored `analytics_backups/`):**
- **Chips:**
  - 121 of the 198 questions (61%) were chip taps.
  - The "most asked" chips are ranked from those same taps, so they feed themselves. For example, CDRRMD food assistance was asked 29 times, but typed only once.
  - The hospitalization chip came back as a clarifying question 3 times.
- **Typed questions:** 77.
  - 13 found nothing (canteen ×2, cafeteria, CR, exit, LandBank, COMELEC, DPWH, the mayor's name, a department head, the PIN, TUPAD, housing loan).
  - Misroutes: "exit" went to the City College clearance, "voter's ID" to OSCA, "4P's" to City Administration, and a nonsense word to Veterinary.
- **Silent redirects:** 37 of 173 trips (21%) for offices that aren't on the map (CDRRMD, OSCA) were sent to the Public Assistance Center without saying so.
- **Match scores:**
  - Every genuine typed question scored 0.630 or higher.
  - Nonsense and the "PIN" request scored below 0.625.
- **The centre:** 19 of the Ground Floor's routes are shortest through it. A door at down 13, across 33 on every floor, plus one at down 60, across 27 on the Ground Floor, open into it. Closing those 5 cells keeps all 95 offices reachable from each other and from the entrance (2,223 routes checked).

## Global Constraints
- **Pages and tap targets:** citizen pages work from 320 px wide. Tap targets are at least 44 px. No emoji in citizen UI.
- **Language:** replies that tell a citizen something is out of scope are in Filipino when the question was, else English.
- **Public repo:** no real citizen queries committed. Test fixtures use invented text or generic single words.
- **Commits:** authored by JCEPenaranda with no `Co-Authored-By`. Don't reset the analytics database.

## Tasks
1. **Map legend (#1)** (`renderer.js`, citizen view only):
   - doors are drawn as openings, with no "D";
   - each stairwell gets a "Stairs" label (`stairClusters()`), and stairs no longer show an "S";
   - the destination becomes a pin, not "E";
   - Ground Floor exits are labelled "Exit".
2. **Close the centre (#6):** turn the 5 door cells into walls in `floor_presets.js` and bump `FLOOR_PRESETS_VERSION` to 11. Test with `tools/test_centre_closed.js`.
3. **Pins (#7):**
   - Tapping the citizen map drops a pin and opens a small menu: "Nandito ako · I'm here" and "Pumunta dito · Go here".
   - "Go here" uses the new `navigateToDepartment(label, null, null, presetLoc)`.
4. **Exits and outside offices (#5):**
   - `BUILDING_EXITS` holds the 4 Ground Floor doors, and `navigateToNearestExit()` routes to the nearest one.
   - `serviceLocationStatus(dept)` returns `mapped|outside|unmapped`.
   - Chat replies about outside or unmapped offices show a note plus "Public Assistance Center" and "Nearest exit" buttons, instead of "Take me there".
   - `navigateToDepartment` never routes silently to the Public Assistance Center again.
5. **Scope (#4) and learned guards** (`lib/scope_guard.js`, before search):
   - amenities (CR, canteen, bank or ATM, parking, photocopy) get a short explanation plus the help desk;
   - national agencies (COMELEC or voter's ID, DPWH, LTO, SSS, PhilHealth, Pag-IBIG, BIR, NBI, passport) get the same;
   - questions about officials get the same;
   - a question about the building exit gets the nearest exit;
   - "what can you do" gets a capability sentence;
   - greetings and thanks get a short reply.
   - A top match below 0.625 is treated as not understood.
   - New office finder aliases: 4Ps/Pantawid go to CSSD, and TUPAD goes to PESO.
6. **Chips (#2, #3):**
   - A chip sends `source: 'chip'`. When its text is an exact service name, the server answers from `services.json` (`lib/service_lookup.js`) without search or the LLM.
   - Every service answer carries `related` (other services from the same office).
   - After the first answer the chip row stays, as one scrolling line above the input: related services first, then the top chips.
   - Chip taps are logged with `source: 'chip'`. `api/analytics.js` adds `typedSubservices`, which excludes chip taps (including the older rows, recognised as query equal to subservice), and the citizen chips are ranked from it.
7. **Query review (#8):** a private report with conclusions in `analytics_backups/`. The aggregate findings go into `IMPLEMENTATION_AUDIT.md`.

Tests: `tools/test_map_legibility.js`, `tools/test_centre_closed.js`, `tools/test_chat_scope.js`. Each is written first and watched failing.

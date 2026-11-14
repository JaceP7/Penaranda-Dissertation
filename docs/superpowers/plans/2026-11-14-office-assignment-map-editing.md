# Office Assignment Map Editing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A non-technical admin can tap a spot on the map and set which office is there, what it handles and each service's requirements (Charter only). They can also add and remove corridor desks. Routing and the chat follow the published result without a deploy.

**Architecture:** Today's 99 stamp placements become *spots* by gaining a few fields. They stay in `STAMP_PLACEMENTS` and in the published map state (`wf:mapstate`), so drafts, publishing, conflict refusal, rollback and preview all keep working unchanged. The pure logic lives in two new browser/Node files, `wayfinding-app/js/spots.js` and `wayfinding-app/js/charter_pick.js`. The editor UI goes in `wayfinding-app/js/spot_editor.js`. The server reads the published map to drop the requirements an admin removed.

**Tech Stack:**
- Vanilla JS (browser globals, plus `module.exports` for Node tests).
- Vercel serverless functions (Node 22).
- Upstash Redis REST.
- Tests are plain Node scripts in `tools/`, using the `ok()` harness and the `lift()`/`vm` pattern of `tools/test_map_legibility.js`.

**Spec:** `docs/superpowers/specs/2026-11-13-room-assignment-design.md` (approved by Jace on 2026-11-14).

**Scope:** this plan covers spec sections 1–4, 6 and 7. Section 5, the Charter update button, gets its own plan, because it is independent: it replaces the Charter data that this plan only reads. Until then the editor reads the bundled `wayfinding-app/data/services.json`.

## Global Constraints

- **Branch:** all work is on `map-editor-redesign`. Never push to `main` from this plan.
- **Commits:** under Jace's name only. No `Co-Authored-By`, no "Generated with", and no Claude or Anthropic author line.
- **UI:** no emoji. Plain wording for a non-technical user. Tap targets of at least 44 px, and no hover-only controls.
- **Cache versions:** every edited file under `wayfinding-app/js/` or `wayfinding-app/css/` gets its `?v=` bumped in `wayfinding-app/index.html`. New scripts start at `?v=1`.
- **Charter only:**
  - Office, service and requirement values must come from the Charter.
  - Only an "Other place" name is typed freely, and an Other place has no services.
  - No-match message, exactly: `Not in the Charter. Only items in the Citizen's Charter can be added. If the office now asks for this, the Charter has to be updated first.`
- **"Still here?":** a desk not confirmed for **30 days** is listed with **Confirm** and **Remove**.
- **Preview deployments** use their own Redis key prefix (`WF_KEY_PREFIX`) and their own vector namespace (`UPSTASH_VECTOR_NAMESPACE`). A preview may never write the live `wf:mapstate` or the live logs.
- **Chat API shape:** unchanged. The server's "Go to:" line stays the department name, because `resolveDept()` and the client parse it. The spot or desk wording ("OSCA desk, in front of CSWD, Ground Floor") comes from the client, which holds the live map (`describeOfficeLocation`).
- **Test suite:** `node tools/run_all_tests.js .`. Every file must report `0 failed`.

## Data model (shared by every task)

A **spot** is a `STAMP_PLACEMENTS` entry. The existing fields `{id, name, row, col, size, floor, source}` stay, and these optional fields are added:

| field | type | meaning |
|---|---|---|
| `kind` | `'office' \| 'other' \| 'desk' \| undefined` | `undefined` means "No office yet" |
| `dept` | `string` | Charter department (office and desk) |
| `services` | `string[]` | subservice names handled here. Office: what this spot handles. Desk: the ticked services. |
| `otherKey` | `'public-assistance' \| 'comelec' \| null` | fixed key for Other places the code depends on |
| `deskBehind` | `boolean` | desk only. `true` means it serves the office behind it. |
| `confirmedAt` | ISO string | desk only. The last "Still here?" confirmation, set on creation. |

The published map state gains two fields:

- `schema: 2`
- `removedRequirements: { "<subservice>|<dept>": string[] }`. These are the requirement texts an admin removed. Storing what was *removed* means that new or reworded Charter items still show.

Fixed keys:

- `"MAYOR'S OFFICE PUBLIC ASSISTANCE CENTER"` maps to `'public-assistance'`;
- `"COMMISSION ON ELECTIONS"` maps to `'comelec'`.

## Review Focus

1. **A device or published map still on the old schema** (stamps without `kind`): routing and office sentences must work exactly as today, through the old `DEPT_STAMP_NAMES` lookup. Tested in Task 4.
2. **A requirement removed, then reworded by a later Charter:** the reworded item must show, because only exact removed texts are hidden. Tested in Task 2.
3. **An office whose spots have all their services unticked, or none listing the asked service:** the citizen is still routed to the office's nearest spot, not told "not on this map". Tested in Task 2.
4. **A desk that cuts the only walkway** between the entrance and an office spot on that floor: the editor warns before saving ("This desk blocks the way to <office>. Save anyway?"). Tested in Task 7.
5. **The server can't read the published map** (Redis down, empty or malformed): the chat answers with the full Charter requirements and never errors. Tested in Task 8.

---

### Task 1: Preview storage isolation and a whole-suite runner

**Files:**
- Create: `lib/keys.js`, `tools/run_all_tests.js`, `tools/test_storage_prefix.js`
- Modify: every Redis key literal in `api/adminauth.js`, `api/analytics.js`, `api/chat.js`, `api/data.js`, `api/mapstate.js`, `api/navlog.js`
- Modify: `ADMIN_GUIDE.md`, to add a "Testing on a preview deployment" section with the two env vars

**Interfaces:**
- Produces: `key(name: string): string`. It returns `(process.env.WF_KEY_PREFIX || '') + name` and reads the env on every call.
- Produces: `previewUnisolated(): boolean`. It is true when `process.env.VERCEL_ENV === 'preview'` and `WF_KEY_PREFIX` is empty.

- [ ] **Step 1: Write the failing test** `tools/test_storage_prefix.js`:
  - `key('wf:mapstate')` is `'wf:mapstate'` with no prefix, and `'pv1:wf:mapstate'` with `WF_KEY_PREFIX=pv1:`.
  - **No literal keys left:** a regex over the six `api/*.js` files finds no string literal starting `'wf:` or `` `wf: `` outside a `key(` call.
  - **Publishing is refused on an unisolated preview:** `api/mapstate.js` with `VERCEL_ENV=preview` and no prefix answers a POST with status 503. The body contains `WF_KEY_PREFIX`. Use the fake-fetch Redis pattern from `tools/test_admin_publishing.js`.
  - **Logging is skipped on an unisolated preview:** `api/chat.js` and `api/navlog.js` don't call `LPUSH` there (fake fetch records commands).
- [ ] **Step 2: Run it.** `node tools/test_storage_prefix.js .`. Expected: FAIL, because `lib/keys.js` is missing.
- [ ] **Step 3: Implement.**
  - Write `lib/keys.js`.
  - Wrap every key literal in the six files in `key(...)`. In `api/mapstate.js`, move `KEY` and `HIST_KEY` into functions so the prefix is read per request.
  - Add the 503 guard at the top of the mapstate POST branch.
  - Add the logging skip where chat and navlog push.
- [ ] **Step 4: Write `tools/run_all_tests.js`.** It runs every `tools/test_*.js` with `node <file> <root>`, prints each file's last line, and exits non-zero if any line lacks `0 failed` or a process exits non-zero.
- [ ] **Step 5: Run the suite.** `node tools/run_all_tests.js .`. Expected: every line ends `0 failed`, and the new test passes.
- [ ] **Step 6: Commit.** `git add lib/keys.js api tools/run_all_tests.js tools/test_storage_prefix.js ADMIN_GUIDE.md && git commit -m "Keep preview deployments off the live map and logs (WF_KEY_PREFIX)"`

### Task 2: Spot model: migration, lookup, desks and removed requirements

**Files:**
- Create: `wayfinding-app/js/spots.js`, `tools/test_spots_model.js`

**Interfaces:**
- Produces the global `SPOTS` (and `module.exports = SPOTS` under Node), with:
  - `FIXED_KEYS: { [dept: string]: 'public-assistance' | 'comelec' }`
  - `isMigrated(state: {schema?: number}): boolean`. True when `state.schema === 2`.
  - `migrateStamps(placements, deptStampNames, servicesByDept) -> { placements: Spot[], checkThese: {id, name, reason: 'unnamed' | 'two offices'}[] }`. It never mutates its input, and it leaves entries that already have `kind` untouched.
  - `spotAt(placements, floor, row, col) -> Spot | null`. Hit-tests `row..row+size-1` and `col..col+size-1`.
  - `placesFor(placements, dept, subservice) -> Spot[]`
  - `deskCells(placements, floor) -> string[]`. Node ids `"r,c"` covered by desks on that floor.
  - `frontOf(placements, desk) -> Spot | null`. The nearest office spot on the desk's floor, by Manhattan distance between centres.
  - `unplacedOffices(placements, depts: string[]) -> string[]`. Departments with no office spot and no other-office desk.
  - `staleDesks(placements, nowMs: number, days = 30) -> Spot[]`
  - `requirementsFor(removed, subservice, dept, reqs) -> reqs`. Hides only requirements whose folded text equals a removed text.
  - `labelStyle(spot) -> { text: string, look: 'office' | 'other' | 'empty' | 'desk' }`. An empty spot gets the text `No office yet`.

- [ ] **Step 1: Write the failing test** `tools/test_spots_model.js`. Load the file with `require`. Fixtures:
  - three stamps: `GF 02a CCRO`, `GF 06` and `MOPAC`;
  - `deptStampNames = {"CITY CIVIL REGISTRY OFFICE": ["GF 02a CCRO"], "MAYOR'S OFFICE PUBLIC ASSISTANCE CENTER": ["MOPAC"]}`;
  - `servicesByDept = {"CITY CIVIL REGISTRY OFFICE": ["Birth Certificate", "Marriage License"]}`.

  Assertions:
  - **Migration:**
    - CCRO becomes `kind 'office'`, with `dept` and `services` equal to both names.
    - MOPAC becomes `kind 'other'` with `otherKey 'public-assistance'`.
    - `GF 06` keeps no `kind` and appears in `checkThese` with reason `'unnamed'`.
    - A floor label like `Ground Floor` becomes `kind 'other'`.
    - A second run is a no-op.
  - **placesFor:**
    - **Review Focus 3:** with two CCRO spots whose `services` are `[]` and `["Birth Certificate"]`, asking "Marriage License" returns both CCRO spots.
    - Asking "Birth Certificate" returns only the second.
    - An OSCA desk (`kind 'desk'`, `dept` OSCA, `deskBehind false`) is a place for OSCA.
    - A CTMO desk with `deskBehind true` and `services ["Cedula"]` is the only place for "Cedula". For any other CTMO service it isn't a place.
  - **requirementsFor:**
    - With removed `["2. Voter's Certification"]` and reqs `["1. Form", "2. Voter's Certification"]`, it returns only `"1. Form"`. Folding ignores numbering, case and spacing.
    - **Review Focus 2:** a reworded `"2. Voter's Certificate (photocopy)"` is NOT hidden.
  - **staleDesks:** a desk with `confirmedAt` 31 days old is stale; one 29 days old isn't.
  - **unplacedOffices:** `['OFFICE FOR THE SENIOR CITIZENS AFFAIRS']` when no spot or desk has it.
- [ ] **Step 2: Run it.** `node tools/test_spots_model.js .`. Expected: FAIL, because `spots.js` is missing.
- [ ] **Step 3: Implement `wayfinding-app/js/spots.js`.** Use a single `const SPOTS = (() => { ... })();` plus `if (typeof module !== 'undefined') module.exports = SPOTS;`.
  - **Migration rules:**
    - a name listed in `deptStampNames` under exactly one department becomes an office, or an Other place if that department is in `FIXED_KEYS`;
    - a name matching `/^(GF|LG|2F|3F)\s*\d+[a-z]?$/i` stays with no kind, reason `'unnamed'`;
    - a name listed under two departments stays with no kind, reason `'two offices'`;
    - any other name becomes an Other place with its own name.
  - **placesFor order:**
    - an own-office desk (`deskBehind true`) whose `services` includes the subservice;
    - otherwise the office spots whose `services` include it;
    - otherwise all office spots of the department;
    - plus other-office desks (`deskBehind false`) for the department whose `services` include the subservice or are empty.
- [ ] **Step 4: Run it.** Expected: all PASS.
- [ ] **Step 5: Commit.** `git add wayfinding-app/js/spots.js tools/test_spots_model.js && git commit -m "Spot model: migrate stamps, find places for a service, desks, removed requirements"`

### Task 3: Charter-only type-ahead

**Files:**
- Create: `wayfinding-app/js/charter_pick.js`, `tools/test_charter_pick.js`

**Interfaces:**
- Produces the global `CHARTER_PICK` (and `module.exports`), with:
  - `fold(text) -> string`. Lower case, accents stripped (NFD), non-alphanumerics become spaces, collapsed.
  - `buildIndex(services, glossary) -> Index`. Offices, services by department, and requirement texts by service key `"<subservice>|<dept>"`. Duplicate names at one office count once.
  - `suggest(index, kind: 'office' | 'service' | 'requirement', text, opts = { dept?, serviceKey? }, limit = 6) -> { value, label, own: boolean }[]`
  - `isCharterItem(index, kind, value, opts) -> boolean`
  - `closest(index, kind, text, opts, n = 3) -> { value, label }[]`. 4-gram similarity, used for the no-match line.
  - `NO_MATCH`: the exact string from Global Constraints.

- [ ] **Step 1: Write the failing test** `tools/test_charter_pick.js`, against the real `wayfinding-app/data/services.json` and `service_glossary.json`:
  - `suggest(idx, 'office', 'sen')[0].value` is `'OFFICE FOR THE SENIOR CITIZENS AFFAIRS'`.
  - `suggest(idx, 'service', 'phil', {dept: 'OFFICE FOR THE SENIOR CITIZENS AFFAIRS'})[0]` has `own === true` and a value containing `PhilHealth`.
  - **Glossary terms match:** `suggest(idx, 'service', 'cctv')` includes `Request to View or Get a Copy of CCTV Footage`.
  - **Accent-insensitive:** `fold('Bañadero') === 'banadero'`.
  - `isCharterItem(idx, 'requirement', 'barangay cert', {serviceKey: 'Senior Citizens ID|OFFICE FOR THE SENIOR CITIZENS AFFAIRS'})` is `false`, and `closest(...)` returns at least one item.
  - `isCharterItem(idx, 'office', 'Office for the Senior Citizens Affairs')` is `true` (case-insensitive).
  - `CHARTER_PICK.NO_MATCH` equals the Global Constraints string.
- [ ] **Step 2: Run it.** `node tools/test_charter_pick.js .`. Expected: FAIL, because the module is missing.
- [ ] **Step 3: Implement `charter_pick.js`.**
  - A match is any query word that is a prefix of any word in the label or, for services, in the glossary `en`, `fil` and `terms`.
  - Rank the given department's own items first, then by how many words match.
- [ ] **Step 4: Run it.** Expected: all PASS.
- [ ] **Step 5: Commit.** `git add wayfinding-app/js/charter_pick.js tools/test_charter_pick.js && git commit -m "Charter-only type-ahead for offices, services and requirements"`

### Task 4: Routing, office sentences and the map drawing use spots

**Files:**
- Modify: `wayfinding-app/js/service_locations.js`
  - `resolveServiceLocation`, `serviceLocationStatus` and `_officeCells` use `SPOTS.placesFor` when the placements are migrated.
  - With no spot carrying `kind`, they fall back to the current `DEPT_STAMP_NAMES` path.
  - `OFFICE_HELP_DEPT` and COMELEC resolve through `otherKey`.
- Modify: `wayfinding-app/js/data.js`, to give `buildAdjacency(extraBlocked)` an optional `Set<string>` of extra blocked node ids.
- Modify: `wayfinding-app/js/app.js`
  - `recompute()` passes `new Set(SPOTS.deskCells(STAMP_PLACEMENTS, STATE.currentFloor))`.
  - `navigateToDepartment()` shows the own-desk note when the chosen place is an office spot and the department has an own desk.
- Modify: `wayfinding-app/js/renderer.js`, so the stamp label block uses `SPOTS.labelStyle`:
  - `empty` is drawn as an amber-striped box, only in admin view;
  - `desk` is drawn as a filled block over its cells, in both views;
  - the others keep today's pill;
  - while a citizen route is active, the destination spot (`resolveServiceLocation(...).spotId`) gets a 2 px outline in the route colour (spec section 4: "the spot is highlighted").
- Modify: `wayfinding-app/index.html`, to add `<script src="js/spots.js?v=1">` after `stamp_presets.js` and bump `data.js`, `service_locations.js`, `renderer.js` and `app.js`.
- Modify: `tools/test_crossfloor.js`, `tools/test_map_legibility.js` and `tools/test_office_sentence.js`, to load `spots.js` into their vm contexts.
- Create: `tools/test_spot_routing.js`

**Interfaces:**
- Consumes: `SPOTS.placesFor`, `SPOTS.deskCells`, `SPOTS.frontOf`, `SPOTS.labelStyle` (Task 2).
- Produces: `resolveServiceLocation(dept, subservice, from)` returns the same shape as today, plus optional `spotId`, `kind` and `deskPhrase` (for example `"OSCA desk, in front of CSWD"`).
- Produces: `describeOfficeLocation(office, lang)` uses `deskPhrase` when the place is a desk.
- Desk text is fixed:
  - **English:** `"<Office> also has a desk in the corridor in front of the office. You may be asked to line up there first."`
  - **Filipino:** `"May mesa rin ang <Office> sa pasilyo sa harap ng opisina. Baka doon ka muna papipilahin."`

- [ ] **Step 1: Write the failing test** `tools/test_spot_routing.js`. Load `data.js`, `spots.js` and `service_locations.js` into one vm context, with the test setting a global `STAMP_PLACEMENTS`.
  - **Migrated placements:**
    - "Senior Citizens ID" for OSCA resolves to the OSCA desk's cell, and `deskPhrase` contains `in front of`.
    - `serviceLocationStatus('OFFICE FOR THE SENIOR CITIZENS AFFAIRS')` is `'mapped'`.
  - **Review Focus 1:** with today's unmigrated `stamp_presets.js` placements, `resolveServiceLocation('CITY CIVIL REGISTRY OFFICE')` returns a cell on a `GF 02` stamp, the same as before this change.
  - **Desks block routing:** `buildAdjacency(new Set(['10,10']))` gives node `10,10` no edges, and no neighbour lists it.
  - **The Public Assistance Center moves with its spot:** `OFFICE_HELP_DEPT` resolves through the spot with `otherKey 'public-assistance'` even after it is renamed to `"Help Desk"`.
  - **Highlight:** `renderer.js` reads `destSpotId`. A static check finds `destSpotId` in both `renderer.js` and `app.js`.
- [ ] **Step 2: Run it.** `node tools/test_spot_routing.js .`. Expected: FAIL.
- [ ] **Step 3: Implement the changes listed under Files.**
- [ ] **Step 4: Run the suite.** `node tools/run_all_tests.js .`. Expected: all `0 failed`, including the three existing map tests.
- [ ] **Step 5: Commit.** `git add wayfinding-app tools && git commit -m "Route to spots and desks; desks block the walkway; old maps still route"`

### Task 5: Map state schema 2: publish, diff, migration review, Offices panel

**Files:**
- Modify: `wayfinding-app/js/app.js`
  - `_buildStatePayload` adds `schema: 2`, but only once the local placements are migrated, plus `removedRequirements`.
  - `_applyCloudState` and `_applyStatePayload` restore `removedRequirements`.
  - `_diffMapStates` and `_describeDiff` gain the counters `officesAssigned`, `desksAdded`, `desksRemoved` and `requirementsChanged`. Their lines read exactly:
    - `"<short name> assigned to <floor short> spot <name>"`
    - `"Desk added in front of <front name> (<short name>)"`
    - `"<service>: <n> requirement(s) removed"`
- Create: `wayfinding-app/js/spot_editor.js`. In this task it holds only the Offices panel: the migration banner, "Check these", "Not on the map yet" and "Still here?".
- Modify: `wayfinding-app/index.html`
  - add the `#officesPanel` markup and `<script src="js/spot_editor.js?v=1">` after `app.js`;
  - add `dockOffices` to `#editorDock` with the label `Offices`;
  - bump `app.js`.
- Modify: `wayfinding-app/css/app.css` and bump its version.
- Modify: `api/mapstate.js`, to keep `schema` and `removedRequirements` through publish and rollback (no whitelist drops them).
- Create: `tools/test_map_state_v2.js`

**Interfaces:**
- Consumes: `SPOTS.migrateStamps`, `SPOTS.isMigrated`, `SPOTS.unplacedOffices`, `SPOTS.staleDesks` (Task 2).
- Produces the global `REMOVED_REQUIREMENTS`, an object read and written by Task 6 and published.
- Produces the global `SPOT_EDITOR` with `openPanel()`, `closePanel()`, `refreshPanel()`, `loadCharter() -> Promise<Index>` and `runMigration() -> Promise<{checkThese}>`.
  - `loadCharter()` fetches `data/services.json` and `data/service_glossary.json` once and caches `CHARTER_PICK.buildIndex(...)`. Add `<script src="js/charter_pick.js?v=1">` before `spot_editor.js`.
  - `runMigration()` builds `servicesByDept` from that index and passes `DEPT_STAMP_NAMES` as the stamp map.
- Diff lines use the existing `_shortName(dept)` from `app.js` for `<short name>`.
  - `runMigration()` replaces `STAMP_PLACEMENTS` in place.
  - It leaves the map dirty: nothing is published.
- The banner text is exactly: `This map still uses the old office markers. Move them to office spots now? Nothing changes for citizens until you publish.`, with the buttons `Move them` and `Not now`.

- [ ] **Step 1: Write the failing test** `tools/test_map_state_v2.js`, lifting `_buildStatePayload`, `_diffMapStates` and `_describeDiff` from `app.js` with `lift()`:
  - **Payload:** after a migrated set, the payload has `schema === 2` and carries `removedRequirements`. Unmigrated, it has no `schema`.
  - **Diff:** an OSCA spot assignment produces the line `OSCA assigned to GF spot GF 14`. A new desk produces a `Desk added in front of` line.
  - **Server:** `api/mapstate.js` (fake Redis) publishes a state with `schema` and `removedRequirements`, and a GET returns both unchanged.
  - **Markup:** `index.html` has `id="officesPanel"`, `id="dockOffices"` and the exact banner text, and the panel markup has no emoji.
- [ ] **Step 2: Run it.** `node tools/test_map_state_v2.js .`. Expected: FAIL.
- [ ] **Step 3: Implement the changes listed under Files.**
  - The Offices panel lists, each with a count:
    - **Check these:** each entry's name and reason, and tapping one centres the map on it;
    - **Not on the map yet:** `SPOTS.unplacedOffices` against the department list from `wayfinding-app/data/departments.json`;
    - **Still here?:** stale desks with Confirm, which sets `confirmedAt` to now, and Remove.
  - This panel is the spec's "admin dashboard" list, because confirming or removing a desk is a map edit that has to be published from the editor.
- [ ] **Step 4: Run the suite.** `node tools/run_all_tests.js .`. Expected: all `0 failed`.
- [ ] **Step 5: Commit.** `git add wayfinding-app api tools && git commit -m "Publish office spots (schema 2), describe them in the change summary, Offices panel"`

### Task 6: The spot sheet: tap a spot, then office, services, requirements

**Files:**
- Modify: `wayfinding-app/js/spot_editor.js`. Adds the sheet, wired from `handleCellTap` in `app.js` when `STATE.spotMode`, which the `dockOffices` tool sets.
- Modify: `wayfinding-app/js/app.js`. The `handleCellTap` branch, `_dockTool` returning `'offices'`, and the cache bump.
- Modify: `wayfinding-app/index.html` (the `#spotSheet` markup), `wayfinding-app/css/app.css`
- Create: `tools/test_spot_editor.js`

**Interfaces:**
- Consumes:
  - `SPOTS.spotAt` and `SPOTS.labelStyle` (Task 2);
  - `CHARTER_PICK.buildIndex`, `suggest`, `isCharterItem`, `closest` and `NO_MATCH` (Task 3);
  - `REMOVED_REQUIREMENTS` and `SPOT_EDITOR.refreshPanel` (Task 5).
- Consumes `SPOT_EDITOR.loadCharter()` (Task 5).
- Produces `SPOT_EDITOR.onTap(row, col)` and the pure helpers on `SPOT_EDITOR`:
  - `applyAssignment(placements, spotId, { kind, dept, services, name, otherKey }) -> Spot[]`. When an office moves to a new spot, the old spot of that department isn't touched, because an office may have several spots. Clearing a spot sets `kind` to undefined and `dept` and `services` to undefined.
  - `toggleRequirement(removed, key, text, keep: boolean) -> removed`

- [ ] **Step 1: Write the failing test** `tools/test_spot_editor.js`. Load `spots.js`, `charter_pick.js` and `spot_editor.js` in a vm context with a minimal `document` stub, or lift the pure helpers with `lift()`.
  - **Assigning OSCA:** `applyAssignment` on a migrated set gives the target spot `kind 'office'` and `dept 'OFFICE FOR THE SENIOR CITIZENS AFFAIRS'`.
  - **Clearing a spot:** it returns to `labelStyle(...).look === 'empty'`.
  - **toggleRequirement:**
    - removing `"5. Voter's ID / Voter's Certificate (Photocopy)"` from `Senior Citizens ID|OFFICE FOR THE SENIOR CITIZENS AFFAIRS` adds it to `removed[key]`;
    - keeping it again deletes it, and an empty key is dropped.
  - **Markup:**
    - `#spotSheet` contains the buttons `Assign an office`, `Other place`, `Move`, `Remove` and `Save`;
    - it contains the note `These requirements apply to this service everywhere this office offers it.`;
    - it contains `From the Citizen's Charter:`;
    - it has no emoji;
    - the CSS gives `.spot-sheet button` a `min-height` of at least `44px`.
- [ ] **Step 2: Run it.** `node tools/test_spot_editor.js .`. Expected: FAIL.
- [ ] **Step 3: Implement the sheet.**
  - **Tapping:**
    - Tapping an existing spot opens it.
    - Tapping an empty wall cell offers `Add a spot here`.
    - Tapping an empty walkable cell offers `Add desk here` (Task 7) and `Add a spot here`.
  - **Office step:** a type-ahead from `suggest('office')`.
    - On pick, the services chips are pre-filled with that department's Charter services.
    - **Other place** shows a free-text name box and no services.
  - **Services step:** chips removable with an `x` button (the letter, not an emoji). The type-ahead adds services, with the office's own first.
  - **Requirements step:** tapping a service chip opens its requirements, pre-filled from the Charter minus `REMOVED_REQUIREMENTS`.
    - Removing a chip records it in `REMOVED_REQUIREMENTS`.
    - Adding one only accepts `isCharterItem`.
    - A no-match shows `NO_MATCH` and the `closest` items.
  - **Source line:** under each service's requirements, `From the Citizen's Charter: <link>`, using the service's `source_url` and opening in a new tab. Plan 2 adds the Charter version label.
  - **Save** writes the placements, calls `saveStampPlacements()`, `recompute()`, `renderer._draw()`, `renderCatalogue()` and `SPOT_EDITOR.refreshPanel()`, and marks the map dirty.
  - **Move** waits for the next tap and sets `row` and `col` there.
  - **Remove** asks `Remove this spot?` first.
- [ ] **Step 4: Run the suite.** `node tools/run_all_tests.js .`. Expected: all `0 failed`.
- [ ] **Step 5: Commit.** `git add wayfinding-app tools && git commit -m "Spot sheet: tap a spot, assign an office or other place, set services and requirements"`

### Task 7: Desks

**Files:**
- Modify: `wayfinding-app/js/spot_editor.js`, `wayfinding-app/index.html` (`#deskSheet` markup), `wayfinding-app/css/app.css`
- Modify: `wayfinding-app/js/spots.js`, adding `blocksWay(nodes, placements, floor, desk, entrance) -> string[]`. It returns the office spot names a desk would cut off from the entrance on that floor, by BFS over the open cells minus all desk cells. It reuses `buildAdjacency`'s 4-neighbour rule.
- Create: `tools/test_desks.js`

**Interfaces:**
- Consumes: `SPOTS.frontOf`, `SPOTS.deskCells` (Task 2), the `CHARTER_PICK` suggestions (Task 3) and the sheet plumbing (Task 6).
- Produces: `SPOT_EDITOR.addDesk(row, col, { dept, deskBehind, services, size }) -> Spot`. The default `size` is 2, it sets `confirmedAt` to the current ISO time, and it gives the name `"<short> desk"`.

- [ ] **Step 1: Write the failing test** `tools/test_desks.js`:
  - `addDesk` returns `kind 'desk'` and a `confirmedAt` within one second of now.
  - **Review Focus 4:** on a 10×10 fixture with a one-cell-wide corridor from the entrance at `9,5` to an office spot at `0,5`, a desk on `5,5` makes `blocksWay` return `[that office's name]`. A desk beside the corridor returns `[]`.
  - **Markup:**
    - `#deskSheet` contains `Whose desk is this?`, `The office behind it`, `Another office`, `Smaller`, `Larger` and `Remove desk`;
    - it contains the warning template `This desk blocks the way to`;
    - it has no emoji.
- [ ] **Step 2: Run it.** `node tools/test_desks.js .`. Expected: FAIL.
- [ ] **Step 3: Implement.**
  - **Behind it:** the department is preset to `SPOTS.frontOf(...)`'s department, and the services are tick boxes of that office's services.
  - **Another office:** the office type-ahead (Task 3), then services exactly as in the spot sheet.
  - **Saving:**
    - It runs `blocksWay`. If anything is cut off, it asks `This desk blocks the way to <names>. Save anyway?`.
    - It then sets `confirmedAt` if new.
  - **Size:** `Smaller` and `Larger` buttons change `size` between 1 and 4 and redraw. The walkway check reruns on Save.
  - **Remove desk** takes one tap, plus a confirmation.
- [ ] **Step 4: Run the suite.** `node tools/run_all_tests.js .`. Expected: all `0 failed`.
- [ ] **Step 5: Commit.** `git add wayfinding-app tools && git commit -m "Corridor desks: whose desk, ticked services, walkway check, one-tap removal"`

### Task 8: The chat lists only the requirements still in use

**Files:**
- Create: `lib/published_map.js`, `tools/test_chat_published_requirements.js`
- Modify: `api/chat.js`
  - The chip and named-service path passes `serviceAnswer` a copy of the service with `requirements` filtered.
  - `buildContext` filters each result's `requirements` the same way before the model sees them.
- Modify: `lib/service_lookup.js`, but only if `serviceAnswer` needs the filtered copy passed in rather than reading `SERVICES`.

**Interfaces:**
- Consumes: `key('wf:mapstate')` (Task 1) and `SPOTS.requirementsFor` (Task 2), required from `../wayfinding-app/js/spots.js`.
- Produces:
  - `getPublishedMap() -> Promise<{ removedRequirements: object } | null>`. Cached for 30 seconds. It returns `null` on a missing key, bad JSON or a Redis error, and never throws.
  - `_resetPublishedMapCache()`, for tests.

- [ ] **Step 1: Write the failing test** `tools/test_chat_published_requirements.js`, using the fake-fetch Redis and the request/response stubs from `tools/test_chat_handler.js`.
  - With a published state whose `removedRequirements['Senior Citizens ID|OFFICE FOR THE SENIOR CITIZENS AFFAIRS']` is `["5. Voter’s ID / Voter’s Certificate (Photocopy)"]`, a chip request for `Senior Citizens ID` has no `Voter` in its answer and still has `Accomplished Form`.
  - **Review Focus 5:** with the Redis fetch throwing, or `wf:mapstate` holding `"not json"`, the answer has the full list and the status is 200.
  - **Caching:** a second request within 30 s makes no second `GET wf:mapstate`.
- [ ] **Step 2: Run it.** `node tools/test_chat_published_requirements.js .`. Expected: FAIL.
- [ ] **Step 3: Implement `lib/published_map.js`, then the two filter points in `api/chat.js`.**
- [ ] **Step 4: Run the suite.** `node tools/run_all_tests.js .`. Expected: all `0 failed`, including `test_service_match.js` and `test_chat_scope.js`.
- [ ] **Step 5: Commit.** `git add lib api tools && git commit -m "Chat hides requirements an admin removed from the published map"`

### Task 9: Admin guide, phone check and branch wrap-up

**Files:**
- Modify: `ADMIN_GUIDE.md`. Add a new section, "Offices, desks and services", in plain language with no emoji:
  - move the old markers (the banner);
  - assign an office;
  - Other place;
  - services and requirements;
  - desks and "Still here?";
  - publishing.
- Modify: `STATUS.md` (local, untracked): set the current thread to "built on branch; awaiting on-site check".

- [ ] **Step 1: Run the suite.** `node tools/run_all_tests.js .`. Expected: all `0 failed`.
- [ ] **Step 2: Phone check.** Serve locally (`python wayfinding-app/serve_https.py`).
  - Per memory, the preview tools can't reach the HTTPS server, so check with `node --check` on every changed JS file, a DOM cross-reference of every `getElementById` id against `index.html`, and `curl -k https://localhost:3001/` for a 200.
  - Then ask Jace to open the editor on a phone and walk through the sequence: Move them, assign OSCA to a spot, add a desk, publish.
- [ ] **Step 3: Commit.** `git add ADMIN_GUIDE.md && git commit -m "Admin guide: offices, desks and services"`
- [ ] **Step 4: Stop.** Merging to `main` and the live migration (Move them, then Publish on the live map) are Jace's call. Don't merge or push to `main`.

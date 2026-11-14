# Office assignment map editing: design

Date: 2026-11-13, revised 2026-11-14 after the builder check. Agreed with Jace in a brainstorm held 2026-11-11 to 11-14. Mockups are in `.superpowers/brainstorm/*/content/` (assign-flow, desk-flow, typeahead-flow, charter-only). The mockups say "room"; read it as "spot" (see section 1).

## Why

Today an office is a point "stamp" painted onto the 75×75 grid. Which department goes to which stamp is hardcoded in `wayfinding-app/js/service_locations.js` (`DEPT_STAMP_NAMES`), so every change needs a code deploy. Jace finds this "not very effective".

The people who keep the map current are Jace and a City Hall staff member with no technical background. They update it when "an office moves or a desk appears".

Makeshift desks keep appearing in corridors in front of mapped offices and make the walkway "thinner". They "some stay some go, basically indefinite". Some serve the office behind them; others serve a different office.

OSCA has services in the Charter but no place on the map, so the chat sends Senior Citizens ID questions to the Public Assistance Center.

The goal is an editor like an interior-design tool: tap a place on the map, say which office is there and what it handles, and the map and the chat follow.

Success means:

- the non-technical staff member can, from a phone and without help:
  - move an office;
  - add or remove a desk;
  - set what each place handles;
- the chat then sends citizens to the right place with the right requirements;
- none of this needs a code change or a deploy.

## Goals

1. **Spots.** Each office location is a tappable spot on the map. Today's 99 stamps become spots. An admin taps a spot and assigns an office, or taps the map to add a new spot.
2. **Desks.** An admin taps a corridor cell and adds a desk. The desk takes up floor space, so routes go around it.
3. **Services and requirements.**
   - For each spot or desk, the admin sets the services handled there.
   - The admin also sets each service's requirements.
   - Both come only from the Citizen's Charter.
4. **Other places.** Places that aren't Charter offices get a name and no services: the Public Assistance Center, COMELEC, DTI, LandBank, COA, councillors' offices, the Session Hall and restrooms.
5. **The chat and routing use the assignments.** Once published, they replace `DEPT_STAMP_NAMES`.
6. **Charter update button.** Any admin can load a new Charter edition, review what changed, and apply it. The admin can upload the PDFs if the City's site can't be read automatically.
7. **Migration.** Today's stamps carry over automatically. Anything ambiguous goes on a "Check these" list.

## Non-goals

- **Detecting enclosed rooms from walls.** The builder check showed the drawn map has no enclosed office rooms (see section 1).
- **Redrawing the floors as rooms.** This could come later.
- **Replacing the wall-painting tool.** It stays, for admins, for real wall changes such as a new partition.
- **An approval step for edits.** The person in charge can change, so the admin who makes an edit is responsible for it.
- **Free-text services or requirements.** Only Charter items can be used. Only "Other place" names are typed freely, and those places have no services.
- **Changing the citizen chat, the PDR/QR navigation or the analytics** beyond what is needed to read the new assignments.

## Anti-goals

- Adding a service or requirement that isn't in the Charter.
- A Charter update that silently wipes offices or services because the City changed its PDF layout.
- Losing an office's location during migration without anyone being told.
- Citizens seeing half-made edits. Map changes reach them only on Publish.
- A citizen sent to a desk for a service the desk doesn't handle.
- **Touching the live site or its data before merge.** The live site is used for fieldwork. All work goes on a separate git branch (Jace: "make sure to do this on the other branch"), and previews use separate storage.

## Current state the builder needs to know

**The app.** A static site in `wayfinding-app/`, with serverless `api/` and `lib/` on Vercel.

**Map data.**

- Walls and doors are cells on four 75×75 floors (0–3), in `js/floor_presets.js`.
- Offices are stamps `{id, name, row, col, size, floor}`, in `js/stamp_presets.js`.
- The editor and admin are in `js/app.js` (about 195 KB). The most recent commit made the map editor usable on a phone.

**What the builder check found in the map.**

- Filling the walkable cells gives about 10 regions per floor: the corridor wings and a 1,797-cell central hall.
- Offices are stamps drawn on a thick band of wall around the corridor ring.
- 79 of 99 stamps sit on wall cells, and 90 of 99 have no door within 2 cells.

**Publishing** (`api/mapstate.js`; `ADMIN_GUIDE.md` section 7):

- the live doc is in `wf:mapstate` and the last 10 versions in `wf:mapstate:hist`;
- a publish carries `baseVersion` and is refused with 409 on a conflict;
- rollback writes a new version forward;
- the editor shows a dirty badge, a change summary (`_diffMapStates`) and a preview-as-citizen;
- the staff PIN goes through `api/adminauth.js` (`ADMIN_PIN`), and writes are authorised with `MAP_ADMIN_TOKEN`;
- tests: `tools/test_admin_publishing.js` (fake Redis).

**Office to place.**

- `js/service_locations.js` maps each Charter department to stamp names. It also holds `SEPARATE_CAMPUS` and `BUILDING_EXITS`.
- The nearest stamp is picked in the browser, in `resolveServiceLocation`.
- Unmapped today: OSCA, CDRRMD-MO, GSO and POSO.
- `api/chat.js` `resolveDept()` reads the "Go to:" line.
- The Public Assistance Center (MOPAC) is wired into the office finder and the out-of-scope replies.

**Charter data** (`wayfinding-app/data/services.json`).

- 305 services across 31 offices, with 1,057 requirements.
- Fields: `service`, `subservice`, `department`, `source_id`, `source_url`, `classification`, `type_of_transaction`, `who_may_avail`, `requirements[{requirement, where_to_secure}]`, `steps[]`.
- 235 services were scraped from the calambacity.gov.ph online Charter.
  - The service list there is rendered by JavaScript, so the tools used hand-saved listing files and fetched only the detail pages.
  - The site's certificate isn't trusted, so the scraper turns certificate checking off.
  - Source: `build_corpus_from_charter.py`.
- 70 services come from per-office PDFs, "2025 1st Edition" (`tools/parse_charter_pdfs.py`, PyMuPDF, using column x-positions).
- The two sets are merged by `tools/merge_charter_services.py`. Loaded 2026-06-08.
- The file is bundled into the serverless function, and `lib/service_lookup.js` answers named services from it.

**Search index.**

- Upstash Vector, seeded by `tools/upstash_seed.py`. Namespaces are supported, and `UPSTASH_VECTOR_NAMESPACE` is read by the chat.
- An English/Filipino glossary (`data/service_glossary.json`, built by `tools/make_service_glossary.js` with Groq) is embedded with each service.
- The Groq quota is shared with the live site: 1,000 requests a day and 8,000 tokens a minute.

**Routing.** `js/dijkstra.js` and `js/nav.js`, on the cell grid. Routes end at the corridor cell next to a stamp.

---

## 1. Spots (Jace chose option B)

A **spot** is a place on the map where an office, desk or other place sits. It replaces the stamp.

- **Migration:** today's 99 stamps become spots, keeping their position, size and floor.
- **Routing:** a route still ends at the walkable cell next to the spot, as it does now.
- **Kinds of spot:** an office, an "Other place", or nothing yet ("No office yet").
- **Adding a spot:** the admin taps the map, then "Add a spot here". It can go on a wall-band cell, where offices are drawn today. A desk is the corridor version (section 3).
- **Moving a spot:** drag it, or tap it, then "Move", then tap the new cell.
- **Removing a spot:** tap it, then "Remove".
- **On the map,** a spot with no office is striped and labelled "No office yet". Other spots show their short name.

There's no room detection. If the floors are redrawn as rooms later, spots can become rooms then. That is out of scope here.

## 2. Assigning an office to a spot (map-first)

The flow on a phone:

1. Open a floor in the editor and tap a spot.
2. Tap "Assign an office". A type-ahead box suggests offices from the Charter as you type: "sen" suggests "Office for the Senior Citizens Affairs (OSCA)".
3. **Services offered here.**
   - The office's own Charter services are filled in already, as chips.
   - The admin removes any not handled at this spot and adds others by typing.
   - Suggestions show that office's Charter entries first, then other offices'.
4. **Requirements for each service.**
   - The requirements belong to the office and service, not the spot. A service's requirements are the same wherever it's handled, matching how the Charter lists them.
   - The Charter requirements are filled in already.
   - The admin removes any no longer asked and adds others from the Charter by typing.
   - Editing them at one spot changes them for that office's service everywhere. The editor says so.
5. Save.

**Other cases:**

- **Moving an office:** assign it to the new spot. The old spot goes back to "No office yet". The services move with it.
- **An office with several spots,** for example Treasury on GF and LG:
  - each spot has its own list of services handled there;
  - the chat names the spots that handle the asked-for service;
  - the browser picks the one nearest the user, as `resolveServiceLocation` does today.
- **Unplaced offices:** a list of offices that have Charter services but no spot or desk. Today that's OSCA, CDRRMD-MO, GSO and POSO. It's shown in the editor so none are forgotten.

### Other places

On "Assign", the admin can choose "Other place" instead of an office.

- They type a name, such as "Public Assistance Center", "COMELEC" or "Restroom".
- An Other place has no services and no requirements.
- It can be moved and removed like any spot.
- Places the code depends on keep working when moved: the Public Assistance Center for the office finder and the out-of-scope replies, COMELEC, and the landmarks. Give these a fixed key, so the chat finds them by key and not by name.

### Charter-only type-ahead

- The office, service and requirement boxes accept only Charter items.
- **Matching:**
  - case-insensitive and ignoring accents;
  - on any word in the item, in English or Filipino;
  - service suggestions also match the glossary terms.
- **No match:** "Not in the Charter. Only items in the Citizen's Charter can be added. If the office now asks for this, the Charter has to be updated first." The closest Charter items are listed below it.
- **Source line:** each service shows where it came from, with a link to the online page or the PDF page, and the Charter version loaded in the app.

## 3. Desks

An admin taps a corridor cell and chooses "Add desk here".

- **Space:** the desk takes up a small block of cells. Routing treats them as blocked, so paths squeeze past. The builder picks the default size; the admin can make it larger or smaller.
- **"Whose desk is this?"**
  - **The office behind it.**
    - Citizens are still sent to the office's spot, with: "<Office> also has a desk in the corridor in front of the office. You may be asked to line up there first."
    - The admin can tick services the desk handles. Citizens asking about a ticked service go straight to the desk.
  - **Another office,** for example OSCA's table in front of CSWD.
    - The desk is that office's location, and its services are set as for a spot.
    - Citizens are sent to "OSCA desk, in front of CSWD, Ground Floor". The "in front of" part comes from the nearest spot with an office.
- **Removing a desk:** one tap, which frees the cells.
- **"Still here?":**
  - Each desk shows when it was last confirmed.
  - After 30 days without confirmation, the admin dashboard lists it under "Still here?" with Confirm and Remove buttons.
  - It stays on the map until someone removes it.

## 4. Publishing and what citizens get

Spots, desks, Other places, services per spot, and each office's requirements per service join the existing map state and publish with it. They use the same version, conflict refusal, rollback, change summary and preview-as-citizen.

The change summary gains lines like:

- "OSCA assigned to GF spot 14";
- "Desk added in front of CSWD (OSCA)";
- "Senior Citizens ID: 1 requirement removed".

**After publishing:**

- **Routes:** a route ends next to the office's spot, or beside the desk, and the spot is highlighted.
- **Where the chat sends people:**
  - It finds the place from the published assignments instead of `DEPT_STAMP_NAMES`.
  - The "Go to:" line names the office, or the desk with its "in front of" phrase.
- **What the chat lists:** a service's requirements come from the published list. A requirement the admin removed isn't listed.
- **The chat API keeps its current shape.** No citizen position is sent to the server.
- **The search index stays as it is.** Spot and desk edits never require reseeding.
- **Unchanged:** separate-campus offices and building exits keep working as today.

The server-side chat (`api/chat.js`, `lib/service_lookup.js`) reads the published assignments from the map state, cached briefly. The builder picks the cache length, but a publish must show up within a minute.

## 5. Charter update button

This is in the admin area, for any admin.

1. **Get the Charter.**
   - First the app tries to fetch the calambacity.gov.ph Charter pages and the per-office PDFs.
   - If that fails, for example because of the JavaScript-rendered list or the untrusted certificate, the admin uploads the Charter PDFs instead (Jace agreed).
   - The admin can also choose upload from the start.
   - Parsing is ordinary code (HTML parsing and the PDF column layout, as the current Python tools do). No AI is used to parse.
2. **Show a summary before anything changes.**
   - For example: "8 services changed, 2 new, 1 removed; requirements changed in 5; Civil Registry: 0 services (looks wrong)".
   - Each line opens to show the old and new text.
   - If only some offices' PDFs were uploaded, only those offices are compared and updated. The others are left as they are.
3. **Block anything that looks broken:**
   - an office that had services now has zero;
   - the total for the offices being updated drops by more than 20% (my call);
   - a parse error.

   The admin sees why, and can't apply it.
4. **Apply.** This goes live straight away. It's official data and doesn't wait for a map Publish.
   - It replaces the Charter data.
   - It updates the search index for new and changed services only.
   - It runs the glossary step for those services only, a handful of Groq calls.
   - Glossary entries that hit the Groq quota are retried later. They don't block the update.
5. **Effect on assignments.**
   - A service that disappeared from the Charter is dropped from spots and desks when the map state is read, and flagged in the editor.
   - A requirement whose wording changed is replaced by the new wording if it's the same entry in the same service. Otherwise it's flagged for the admin.
   - New services aren't assigned anywhere automatically. They show on the office's unassigned list.
   - A map version that names a service the current Charter doesn't have ignores that service and shows a warning.
6. **Versions.**
   - The data is labelled with the version and the date loaded.
   - Charter versions have their own rollback, separate from map versions.
   - `services.json` moves out of the bundle into Redis. The bundled copy remains the fallback.

**Constraint.** It must run from the admin page with no paid service. The current parsers are Python, which Vercel's Node functions can't run as is. The builder decides how: for example, port them to Node with pdfjs.

## 6. Migration from stamps

This runs once at merge time, against the live map state. It produces a preview that the admin reviews and then publishes.

- **Each stamp listed in `DEPT_STAMP_NAMES`** becomes a spot assigned to that department, with all of that department's Charter services.
- **A department with several stamps** gets all its services at each of its spots (my call). The admin can trim them later.
- **Stamps that aren't Charter offices:**
  - the Public Assistance Center, COMELEC, DTI, LandBank, COA, the councillors' offices, the Session Hall and the restrooms become Other places with the same names;
  - the places the code depends on get their fixed keys.
- **A stamp whose name can't be matched,** or two departments on one stamp, goes on the "Check these" list. It's never guessed.

## 7. Access, devices and testing

- **Access:** the editor stays behind the staff PIN (`ADMIN_PIN`). The wall-painting tool, the Charter update button and all assignment editing are for admins.
- **Phones:** everything works on a phone. Tap targets are at least 44 px, with no hover-only controls.
- **Wording:** no emoji in the UI, and plain wording.
- **Branch:** all work is on a separate git branch.
- **Storage:** preview deployments use their own Redis key prefix, through a new env var, and their own Upstash Vector namespace. A preview can never write the live `wf:mapstate`, the live Charter data or the default namespace.

## Left to the builder

- Default desk size.
- The data shape inside the map state.
- The cache length on the server.
- How the Charter parsers run on Vercel.
- Type-ahead matching details beyond the above.
- Layout and styling, within the existing admin look.

## Decisions marked as my call (Jace may overrule)

- **Pre-filled chips:** an office's Charter services and each service's requirements are filled in already, and the admin trims them.
- **Requirements belong to the office and service, not the spot.**
- **"Still here?"** appears after 30 days without confirmation.
- **Charter updates are blocked** if the total for the offices being updated drops by more than 20%.
- **Charter Apply goes live straight away,** with its own rollback.
- **Migration:** a department with several stamps gets all its services at each spot.
- **Previews use separate storage;** migration runs at merge.

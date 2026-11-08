# Admin analytics revamp and Google sign-in: implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Put the dashboard, the navigation data and map publishing behind Google sign-in with an admin-managed access list, then replace the dashboard with the approved dark "Console" layout, which must also work on a phone.

**Architecture:**
- Small shared server modules in a top-level `lib/` folder:
  - Redis access;
  - the signed session cookie;
  - the access list;
  - Google token checking;
  - Manila time.
- The functions in `api/` all use these modules. Files outside `api/` are not deployed as functions, but Vercel bundles them with the functions that require them.
- The new dashboard is plain HTML with no framework:
  - a page shell;
  - one file of pure chart/HTML builders, which can be tested in Node;
  - one file of page renderers.
- Charts are drawn as HTML/SVG. Chart.js is dropped.

**Tech Stack:**
- Vercel Node serverless functions (CommonJS, Node 24 in production, 22 locally).
- Upstash Redis REST.
- `google-auth-library@11.3.1`.
- Google Identity Services (`https://accounts.google.com/gsi/client`).
- Vanilla JS and CSS.
- Tests: Node scripts in `tools/` with a fake `fetch` for Redis.

**Spec:** `docs/superpowers/specs/2026-11-08-admin-analytics-revamp-design.md` (approved 2026-11-09, including the phone layout section).

## Global Constraints

- **Asia/Manila time throughout,** UTC+8 with no daylight saving. Every date, hour, weekday, "today" and `from`/`to` filter is computed in Manila time.
- **Session:**
  - Cookie `HttpOnly; Secure; SameSite=Lax; Path=/`, HMAC-SHA256 with `SESSION_SECRET`, lasting **8 hours**.
  - Every gated request re-checks the access list.
- **Environment variables:** `GOOGLE_CLIENT_ID`, `OWNER_EMAILS` (comma-separated) and `SESSION_SECRET` (at least 32 bytes). If `GOOGLE_CLIENT_ID` or `SESSION_SECRET` is missing, everything gated fails closed with 503 and a "sign-in not configured" message. Nothing ever falls back to open access.
- **Google token checks:** use `OAuth2Client.verifyIdToken` from `google-auth-library`. Never hand-roll JWT verification. Require `email_verified === true`.
- **Emails** are compared lowercased and trimmed.
- **CORS:** gated endpoints send no `Access-Control-Allow-Origin` header. `POST /api/navlog`, `GET /api/mapstate` (current map) and `POST /api/chat` stay open.
- **Publisher identity:**
  - Anonymous `GET /api/mapstate` responses never contain `updatedBy`.
  - On publish, `updatedBy` comes from the session, or is the literal `"emergency key"` for `MAP_ADMIN_TOKEN` writes. It is never taken from the request body.
- **No emoji anywhere in the dashboard UI.** Icons are inline SVG line icons, using Lucide path data (ISC licence, with the notice in a comment).
- **Look:**
  - Font: Fira Sans (Google Fonts) with `font-variant-numeric: tabular-nums`.
  - Dark tokens: plane `#0e1318`, surface `#171d24`, text `#e9edf2`, secondary `#b3bdc9`, muted `#8b96a3`, hairline `#2a323b`, accent `#86b6ef`.
  - Light tokens: plane `#f3f4f6`, surface `#ffffff`, text `#0f172a`, secondary `#475569`, muted `#64748b`, hairline `#e2e5ea`, accent `#1c5cab`.
  - Dark is the default. The theme switch is remembered per browser.
- **Charts:**
  - one sequential blue ramp for magnitude;
  - single-series bars in one color;
  - no dual axes;
  - status colors only for route outcomes, always with a text label;
  - every heatmap cell that has questions prints its count.
- **Small samples:** any rate or median from fewer than **30** events carries a "Small sample" tag. Every percentage shows its count beside it ("5 of 22").
- **Office-hours band on the heatmap:** 8 AM to 5 PM.
- **Phone layout:**
  - 360 px minimum width, with no sideways page scroll.
  - Below 900 px: drawer menu and range sheet.
  - Below 640 px: two tiles per row, one column of panels, the heatmap turned sideways (24 rows by 7 columns), stacked table rows.
  - Tap targets at least 44×44 px; 16 px input text; safe-area insets respected.
- **Public repo:** no secrets, no real citizen queries and no real floor plan are committed.
- **Commits:**
  - Authored by JCEPenaranda with **no `Co-Authored-By` line**. Jace's rule overrides the harness reminder.
  - Work on the branch `analytics-revamp`. A phase merges to `main` only at its deploy task, because a push to `main` deploys to production.
- **Tests:** after every task, run the full suite from the repo root. Every test must pass:
  ```bash
  for t in tools/test_*.js; do node "$t" . || exit 1; done; python tools/test_analytics_range_local.py .
  ```
- **Leave these alone:**
  - the laptop server's `/api/analytics` and `test_analytics_range_local.py`;
  - the synthetic-row exclusion;
  - the 50,000-entry cap;
  - the paged Redis reads.

## Review Focus

1. **Citizen question text with HTML in it.** For example `<img src=x onerror=alert(1)>`, rendered in a signed-in admin's dashboard. That admin can publish the map, so this would be stored XSS with real power. Every place that renders text must escape it. The test is in Task 13; Task 14 has a static check that no renderer builds markup from data without `esc`.
2. **A session expiring mid-use (8 hours), or someone removed while the dashboard is open.** The 30-second refresh then gets 401 or 403. Expected: polling stops, the sign-in screen returns with "Your sign-in ended", and the last data is not left on screen. The test is in Task 12.
3. **A 360 px phone.** A long office name, a long question or the 24-column heatmap must not push the page sideways. The check is in Task 16: `document.documentElement.scrollWidth <= innerWidth` on every page, at 360×740.
4. **The People page given bad input:** an address with spaces or capitals, something without an `@`, a duplicate, an owner, or the signed-in person removing themselves. Expected: normalised; refused with a sentence; idempotent; refused because owners can't be removed; allowed after a confirmation that names the consequence. The tests are in Tasks 2 and 15.
5. **Manila day boundaries in the date filter.** A question at 2026-10-05T16:30Z belongs to Manila 2026-10-06. It must be included by `from=2026-10-06` and excluded by `to=2026-10-05`. A reversed range is swapped, not returned empty. The tests are in Task 9.

---

## Phase 1: the gate

Phase 1 is Tasks 1 to 8. Task 1 can ship on its own straight away. Tasks 2 to 7 are committed on the branch. Task 8 merges and deploys them, but only after Jace has finished the Google setup.

### Task 1: Report sign-in readiness from `/api/ping`

This lets Claude confirm that Jace's environment variables are set, without exposing their values. It ships to `main` immediately.

**Files:**
- Modify: `api/ping.js`
- Test: `tools/test_ping.js` (new)

**Interfaces:**
- Produces: `GET /api/ping` → `{ ok, hasKey, node, auth: { clientId: boolean, sessionSecret: boolean, owners: number } }`. `sessionSecret` is true only when the secret is at least 32 bytes long. `owners` is the number of non-empty entries in `OWNER_EMAILS`.

- [ ] **Step 1:** Write `tools/test_ping.js`, in the same `ok()`/`mockRes()` style as `tools/test_navlog.js`.
  - `ping reports auth readiness without values`: set `GOOGLE_CLIENT_ID='abc'`, `SESSION_SECRET='x'.repeat(32)` and `OWNER_EMAILS='a@x.com, b@y.com'`. Assert `auth` deep-equals `{clientId:true, sessionSecret:true, owners:2}`, and that `JSON.stringify(body)` does not contain `abc` or `a@x.com`.
  - `short secret is not ready`: set `SESSION_SECRET='short'` and assert `auth.sessionSecret === false`.
- [ ] **Step 2:** Run `node tools/test_ping.js .`. Expected: FAIL, because `auth` is undefined.
- [ ] **Step 3:** Add the `auth` object to `api/ping.js`. Read the environment variables inside the handler.
- [ ] **Step 4:** Run the full suite. Expected: all pass.
- [ ] **Step 5:** Commit on `main`, push, then run `curl -s https://penaranda-dissertation.vercel.app/api/ping`. Expected: an `auth` object, with false or 0 values until Jace finishes setup.

### Task 2: Shared server modules (Redis, session, access list, Google, gate)

**Files:**
- Create:
  - `package.json`: `{"private": true, "engines": {"node": "24.x"}, "dependencies": {"google-auth-library": "11.3.1"}}`, with no scripts.
  - `package-lock.json`, from `npm install`.
  - `lib/redis.js`, `lib/session.js`, `lib/access.js`, `lib/google.js`, `lib/gate.js`
- Test: `tools/test_auth_lib.js` (new)

**Interfaces (Produces):**
- **`lib/redis.js`**
  - `redisConfigured() → boolean`
  - `redis(cmd: string[]) → Promise<any>`: POSTs to `UPSTASH_REDIS_REST_URL` and returns `.result`. Throws `Redis <OP> <status>` when the response is not ok.
- **`lib/session.js`**
  - Constants: `SESSION_COOKIE = 'wf_session'`, `SESSION_TTL_MS = 28800000`.
  - `authConfig() → { configured: boolean, missing: string[], clientId: string, owners: string[] }`. It reads the environment on every call. `missing` lists the unset names among `GOOGLE_CLIENT_ID` and `SESSION_SECRET`, plus `OWNER_EMAILS` when there are no owners. `configured` is true when `GOOGLE_CLIENT_ID` and a valid `SESSION_SECRET` are present.
  - `signSession({ email, name }, now = Date.now()) → string`. The format is `base64url(JSON {e, n, x}) + '.' + base64url(HMAC-SHA256(secret, firstPart))`, where `x = now + SESSION_TTL_MS`.
  - `verifySession(token, now = Date.now()) → { email, name, exp } | null`. It compares with `crypto.timingSafeEqual`, and returns null for a malformed token, a bad signature, an expired token or a missing secret.
  - `readSessionToken(req) → string | null`, from the `req.headers.cookie` string.
  - `setSessionCookie(res, token)` and `clearSessionCookie(res)`: both use `Set-Cookie`. Set uses `Max-Age=28800`; clear uses `Max-Age=0`.
- **`lib/access.js`** (Redis keys: set `wf:admins`; hash `wf:admins:meta`, mapping email to JSON `{addedBy, addedAt}`; list `wf:admins:log`, LPUSH then LTRIM to 200)
  - `normEmail(s) → string`
  - `ownerEmails() → string[]`
  - `isAllowed(email) → Promise<boolean>`: owners first, then `SISMEMBER`.
  - `listPeople() → Promise<{ owners: string[], people: {email, addedBy, addedAt}[], log: {action: 'add'|'remove', email, by, at}[] }>`: people sorted by email, log newest first, at most 50 entries.
  - `addPerson(email, by) → Promise<{ ok: true, already?: true } | { ok: false, error: string }>`
  - `removePerson(email, by) → Promise<{ ok: true } | { ok: false, error: string }>`
- **`lib/google.js`**
  - `verifyGoogleIdToken(idToken, clientId) → Promise<{ email, name }>`. Throws when the token is invalid or the email is unverified. Require `google-auth-library` lazily inside the function.
- **`lib/gate.js`**
  - `requireUser(req, res) → Promise<{ email, name } | null>`:
    - Sets `Cache-Control: no-store`.
    - Not configured → 503 `{ error: 'Sign-in is not configured.', missing }`.
    - No valid session → 401 `{ error: 'Sign in required.' }`.
    - Not allowed → 403 `{ error: 'Not on the access list.' }`, and clears the cookie.
    - Returns null after sending any of these.
  - `optionalUser(req) → Promise<{ email, name } | null>`: never sends a response.
  - `requireJson(req, res) → boolean`: answers 415 `{ error: 'Send JSON.' }` unless the content-type starts with `application/json`.

**Test setup:** in tests, stub Google by planting `require.cache[require.resolve(<ROOT>/lib/google.js)] = { id, filename, loaded: true, exports: { verifyGoogleIdToken: stub } }` before requiring anything that uses it.

- [ ] **Step 1:** Write `tools/test_auth_lib.js`. The fake Redis handles `SISMEMBER`, `SADD`, `SREM`, `SMEMBERS`, `HSET`, `HGET`, `HDEL`, `HGETALL` (returned as a flat array, the way Upstash REST does), `LPUSH`, `LTRIM` and `LRANGE`. Tests:
  - `signed session round-trips`: verify returns `email` and `name`.
  - `tampered payload rejected`: flip one character of the first part, and verify returns null.
  - `expired session rejected`: `verifySession(t, now + 28800001) === null`.
  - `wrong secret rejected`: sign, change `SESSION_SECRET`, then verify returns null.
  - `no secret → configured false, missing lists it`.
  - `cookie flags`: the `Set-Cookie` header contains `HttpOnly`, `Secure`, `SameSite=Lax`, `Path=/` and `Max-Age=28800`.
  - `owner always allowed without Redis`.
  - `normEmail(' Ana@X.COM ') === 'ana@x.com'`.
  - `addPerson rejects 'not-an-email'`: `ok === false`, and the error mentions an email address.
  - `addPerson stores lowercased, records addedBy, logs 'add'`.
  - `adding twice is idempotent`: `already === true`, and only one member.
  - `addPerson refuses an owner`: the error mentions "already an owner".
  - `removePerson refuses an owner`.
  - `removal takes effect immediately`: `isAllowed` is true, then after `removePerson` it is false.
  - `requireUser`:
    - 503 when not configured;
    - 401 without a cookie;
    - 403 and a cleared cookie when the email is not on the list;
    - returns the user for an owner cookie;
    - sets `Cache-Control: no-store`.
  - `requireJson`: 415 for `text/plain`; true for `application/json; charset=utf-8`.
- [ ] **Step 2:** Run `node tools/test_auth_lib.js .`. Expected: FAIL, cannot find module `lib/session.js`.
- [ ] **Step 3:** Run `npm install`. Create the five modules to the interfaces above.
- [ ] **Step 4:** Run the full suite. Expected: all pass.
- [ ] **Step 5:** Commit: `Add the session, access-list and gate modules for Google sign-in`.

### Task 3: `/api/auth` and `/api/people`

**Files:**
- Create: `api/auth.js`, `api/people.js`
- Test: `tools/test_auth_api.js` (new)

**Interfaces:**
- Consumes: everything from Task 2.
- Produces:
  - **`GET /api/auth`** → 200 `{ configured, missing, clientId, user: {email, name} | null }`. `user` is set only for a valid session whose email is still allowed.
  - **`POST /api/auth`** with `{ credential }`:
    - 200 `{ user }`, and sets the cookie.
    - 400 when there is no credential.
    - 401 `{ error: 'Google could not verify this sign-in.' }`.
    - 403 `{ error: '<email> is not on the access list. Ask an admin to add you.' }`.
    - 503 when not configured.
  - **`POST /api/auth`** with `{ action: 'signout' }` → 200 `{ ok: true }`, and clears the cookie.
  - **`GET /api/people`** → `listPeople()` plus `{ me: email }`.
  - **`POST /api/people`** `{ email }` → the result of `addPerson`, plus the fresh `listPeople()`. It answers 400 when `ok` is false.
  - **`DELETE /api/people`** `{ email }` → the same for `removePerson`.
  - All `/api/people` methods use `requireUser`. POST and DELETE on both endpoints use `requireJson`. Neither endpoint sends CORS headers.

- [ ] **Step 1:** Write `tools/test_auth_api.js`, with the Google verifier stubbed (`good-token` returns `owner@example.com`, `stranger-token` returns `who@else.com`, anything else throws). Tests:
  - `GET /api/auth unconfigured → configured false, missing non-empty`.
  - `POST good-token → 200 + Set-Cookie wf_session`.
  - `POST stranger-token → 403, message names the email, no cookie`.
  - `POST bad token → 401`.
  - `POST text/plain → 415`.
  - `GET with the issued cookie → user.email === 'owner@example.com'`.
  - `signout clears cookie`.
  - `people GET without cookie → 401`.
  - `add then list shows addedBy owner`.
  - `added person can now sign in`.
  - `removed person's existing cookie → 403 on next GET /api/people`.
  - `no Access-Control-Allow-Origin on either endpoint`.
- [ ] **Step 2:** Run it. Expected: FAIL, cannot find `api/auth.js`.
- [ ] **Step 3:** Implement both handlers.
- [ ] **Step 4:** Run the full suite. Expected: all pass.
- [ ] **Step 5:** Commit: `Add sign-in and access-list endpoints`.

### Task 4: Gate analytics and navigation reads; add the public starter-chip read

**Files:**
- Modify:
  - `api/analytics.js`: handler entry and CORS header.
  - `api/navlog.js`: GET branch and CORS header.
  - `tools/test_analytics_range.js` and `tools/test_navlog.js`: add an owner session cookie to every gated call. Leave their assertions unchanged.
- Test: `tools/test_gates.js` (new)

**Interfaces:**
- Produces:
  - **`GET /api/analytics?view=starters`**: open. Returns `{ starters: string[] }`, the top 5 subservice names over all non-synthetic rows, or `[]` when fewer than 3 exist. Sends `Cache-Control: public, max-age=300` and no other fields.
  - **Every other `GET /api/analytics`**, including CSV, requires `requireUser`.
  - **`GET /api/navlog`** requires `requireUser`.
  - **`POST /api/navlog`** keeps `Access-Control-Allow-Origin: *`. GET responses drop it.

- [ ] **Step 1:** Write `tools/test_gates.js`, with a fake Redis seeded with 4 query rows across 3 subservices, one of them synthetic. Tests:
  - `analytics JSON 401 without cookie`.
  - `analytics CSV 401 without cookie, body has no query text`.
  - `navlog GET 401 without cookie`.
  - `navlog POST still 200 without cookie`.
  - `starters open: keys are exactly ['starters']`.
  - `starters contains no query text`.
  - `starters excludes synthetic rows`.
  - `gated responses carry no Access-Control-Allow-Origin`.
  - `owner cookie → analytics 200`.
  - `analytics 503 when SESSION_SECRET unset`.
- [ ] **Step 2:** Run it. Expected: FAIL, analytics answers 200 without a cookie.
- [ ] **Step 3:** Make the gate changes. In both existing tests, set `OWNER_EMAILS`, `SESSION_SECRET` and `GOOGLE_CLIENT_ID`, and pass `headers: { cookie: 'wf_session=' + signSession(...) }`.
- [ ] **Step 4:** Run the full suite. Expected: all pass, with the existing tests' pass counts unchanged.
- [ ] **Step 5:** Commit: `Require sign-in to read analytics and navigation data`.

### Task 5: Map publishing by session; keep publisher identity private

**Files:**
- Modify: `api/mapstate.js` (header comment, CORS, GET, POST auth, `updatedBy`)
- Modify: `tools/test_admin_publishing.js` (the mapstate section)

**Interfaces:**
- Produces:
  - **`GET /api/mapstate`:**
    - anonymous: `{ version, updatedAt, state }` with no `updatedBy`;
    - signed in: also carries `updatedBy`.
  - **`?history=1` and `?version=N`** require `requireUser`.
  - **`POST /api/mapstate`** accepts a valid session, or `Authorization: Bearer <MAP_ADMIN_TOKEN>`:
    - `updatedBy` is `"<name> <email>"` for a session, or `"emergency key"` for the token;
    - `body.updatedBy` is ignored;
    - neither → 401;
    - a session POST needs JSON.
  - **The 409 conflict body** still carries `updatedBy`, since it only goes to an authorised writer.
  - **503 only** when neither sign-in nor `MAP_ADMIN_TOKEN` is configured.

- [ ] **Step 1:** Add these to `tools/test_admin_publishing.js`:
  - `anonymous GET has no updatedBy`.
  - `signed-in GET has updatedBy`.
  - `history 401 anonymous`.
  - `version=N 401 anonymous`.
  - `session publish records the session identity, not body.updatedBy`: send `updatedBy: 'Mallory'`, and assert the stored `updatedBy` contains `owner@example.com`.
  - `token publish records "emergency key"`.
  - `no session and no token → 401`.
  - `token rollback still works`.

  Keep the existing conflict and rollback tests, switched to session auth.
- [ ] **Step 2:** Run `node tools/test_admin_publishing.js .`. Expected: the new tests FAIL.
- [ ] **Step 3:** Implement the changes.
- [ ] **Step 4:** Run the full suite. Expected: all pass.
- [ ] **Step 5:** Commit: `Publish the map by sign-in and keep publisher emails off citizen phones`.

### Task 6: Citizen app and editor entry; retire the PIN and token prompt

**Files:**
- Modify `wayfinding-app/js/chat.js`: in `_loadDynamicStarters`, read `/api/analytics?view=starters` and map `data.starters`, keeping the "at least 3, else keep defaults" rule.
- Modify `wayfinding-app/js/app.js`:
  - remove `_adminPinAccepted`, `_ensurePublishToken`, the `PUBLISH_TOKEN_SS_KEY` uses and the `_adminName` prompt;
  - change `_enterAdminWithPin` to `_enterAdmin`;
  - change the publish and rollback fetches.
- Modify `wayfinding-app/index.html`: bump `app.js?v=79` and `chat.js?v=41`.
- Delete `api/adminauth.js`.
- Modify `ADMIN_GUIDE.md`:
  - replace the PIN section with sign-in and the People page;
  - add the emergency-key curl commands for publish and rollback.
- Test: `tools/test_editor_entry.js` (new; a static cross-reference, like `test_motion_permission.js`)

**Interfaces:**
- Consumes: `GET /api/auth`, `POST /api/mapstate` (cookie), `GET /api/analytics?view=starters`.
- Produces:
  - **`async function _adminSession()`** in `app.js` → `{ configured, user } | null`. It returns null when `/api/auth` gives 404 (the laptop server) or can't be reached.
  - **`async function _enterAdmin(btn)`:**
    - signed in → `setViewMode('admin')`;
    - null → alert `Editor sign-in works on the hosted site only.`;
    - not configured → alert `Sign-in is not set up on this server yet.`;
    - otherwise → `location.href = '/admin.html?next=editor'`.
  - **On load**, `?editor=1` calls `_enterAdmin()` and removes the parameter with `history.replaceState`.
  - **`_adminName()`** returns the cached session's display name, with no prompt.
  - **A publish or rollback 401** alerts `Your sign-in has ended. Sign in again, then publish. Your edits are still on this device.` and then goes to `/admin.html?next=editor`.

- [ ] **Step 1:** Write `tools/test_editor_entry.js`. Tests:
  - `no /api/adminauth anywhere in wayfinding-app/`.
  - `api/adminauth.js deleted`.
  - `no prompt( mentioning PIN or token in app.js`.
  - `publish and rollback send no Authorization header`.
  - `both entry buttons call _enterAdmin`.
  - `?editor=1 handled`.
  - `chat.js reads view=starters and never bare /api/analytics`.
  - `index.html loads app.js?v=79 and chat.js?v=41`.
- [ ] **Step 2:** Run it. Expected: FAIL.
- [ ] **Step 3:** Make the changes.
- [ ] **Step 4:** Run the full suite. `test_admin_publishing.js` still lifts the `app.js` helpers. Expected: all pass.
- [ ] **Step 5:** Commit: `Open the map editor by Google sign-in instead of the shared PIN`.

### Task 7: Sign-in screen module, used in front of the current dashboard

**Files:**
- Create: `wayfinding-app/js/admin_auth.js`, `wayfinding-app/css/admin_auth.css`
- Modify `wayfinding-app/admin.html`:
  - load the GIS script, `admin_auth.js` and its CSS;
  - hide the dashboard until signed in;
  - add Sign out;
  - make a 401 or 403 from `load()` or `loadNav()` return to sign-in.
- Test: `tools/test_admin_auth_ui.js` (new; runs `admin_auth.js` in `vm` with a fake DOM-less API surface)

**Interfaces:**
- Produces: the global `ADMIN_AUTH`:
  - `status() → Promise<{ configured, missing, clientId, user } | { laptop: true }>`. `{laptop: true}` is returned when `/api/auth` gives 404.
  - `mount(container, { onSignedIn(user), reason? })`. It renders the sign-in card:
    - the title "Calamba City Hall: staff sign-in";
    - the GIS button;
    - "Only people on the access list can sign in. Ask an admin to add you.";
    - an error line, filled by the 401 and 403 messages and by "Could not load Google sign-in. Check the connection and reload.";
    - when `reason` is `'ended'`, the notice "Your sign-in ended. Sign in again to continue.";
    - when not configured, it names the missing variables.
  - `signOut() → Promise<void>`
  - `afterSignIn()`: when `?next=editor` is present it calls `location.replace('/?editor=1')`, otherwise it calls `onSignedIn`.

- [ ] **Step 1:** Write `tools/test_admin_auth_ui.js`. It drives `status()` against a stubbed `fetch`. Tests:
  - `404 → {laptop:true}`.
  - `configured:false → missing passed through`.
  - `next=editor → location.replace('/?editor=1')` (`location` stubbed).
  - `error message for 403 is the server's sentence, escaped`: feed `<b>x</b>`, and the rendered text has no `<b>` element.
- [ ] **Step 2:** Run it. Expected: FAIL.
- [ ] **Step 3:** Implement the module, and wire it into the current `admin.html`.
- [ ] **Step 4:** Run the full suite. Expected: all pass.
- [ ] **Step 5:** Commit: `Put a Google sign-in screen in front of the dashboard`.

### Task 8: Deploy Phase 1 (blocked on Jace's Google setup)

- [ ] **Step 1:** Ask Jace to confirm the Google Cloud setup (spec, "Google Cloud setup") is done. Then run `curl -s https://penaranda-dissertation.vercel.app/api/ping`. Expected: `"auth":{"clientId":true,"sessionSecret":true,"owners":1}` or more owners. **Stop here** if any value is false or 0.
- [ ] **Step 2:** Merge `analytics-revamp` into `main` and push.
- [ ] **Step 3:** Check the live site with curl. Expected:
  - `GET /api/analytics` → 401.
  - `GET /api/analytics?format=csv` → 401.
  - `GET /api/navlog` → 401.
  - `GET /api/mapstate` body has no `updatedBy`.
  - `GET /api/analytics?view=starters` → `{"starters":[...]}`.
  - `GET /api/adminauth` → 404.
- [ ] **Step 4:** Ask Jace to sign in at `/admin.html` on their phone and open the editor from the corner button. Expected: the dashboard loads, and the editor opens with no PIN.
- [ ] **Step 5:** Update `SYSTEM_CONTEXT.md` and `IMPLEMENTATION_AUDIT.md` (remove the PIN, describe sign-in). Commit and push.

---

## Phase 2: the redesign

### Task 9: Manila time and the new summary figures in `api/analytics.js`

**Files:**
- Create: `lib/manila.js`
- Modify: `api/analytics.js` (`dayOf`, the today/range filter, the summary block, CSV)
- Modify: `tools/test_analytics_range.js`
- Test: `tools/test_manila.js` (new)

**Interfaces:**
- Produces:
  - **`lib/manila.js`:**
    - `manilaParts(ts) → { date: 'YYYY-MM-DD', hour: 0..23, weekday: 0..6 } | null`, where weekday 0 is Monday;
    - `manilaDay(ts) → string`, empty when invalid;
    - `manilaToday(now = Date.now()) → string`;
    - `manilaStamp(ts) → 'YYYY-MM-DD HH:MM'`.
  - **New summary fields,** added to the existing ones, which stay:
    - `hourWeekday: number[7][24]`, rows Monday to Sunday;
    - `busiest: { weekday, hour, count } | null`;
    - `latency: { n, median, p95, histogram: { lo, hi, count }[] }`:
      - bins are 500 ms wide from 0 to 10000;
      - a final bin `{ lo: 10000, hi: null }` catches the rest;
      - the median averages the two middle values when n is even;
      - p95 is nearest-rank, `sorted[ceil(0.95 n) - 1]`;
    - `languages: { lang, count }[]`;
    - `clarification: { count, of }`, which keeps `ambiguityRate` as-is;
    - `kinds: { service, location }`, counting rows by `kind` (missing means `service`), from the office finder (2026-11-09);
    - `rangeLabel`, for example `"Oct 1 – Oct 31, 2026 (Manila time)"`, or `"All time (Manila time)"`.
  - **`today` and `queriesPerDay`** use Manila days.
  - **The CSV** gains `timestamp_manila` right after `timestamp_utc`, and `date` becomes the Manila date.

- [ ] **Step 1:** Write `tools/test_manila.js`. Tests:
  - `15:59:59.999Z on 2026-10-05 is Manila 2026-10-05 23h Monday(0)`.
  - `16:00:00Z is Manila 2026-10-06 0h Tuesday(1)`.
  - `23:30Z on 2026-10-05 is Manila 2026-10-06`: the old UTC code put this before the 8 AM rollover.
  - `manilaStamp formats 2026-10-06 07:30`.
  - `invalid ts → null / ''`.
- [ ] **Step 2:** Add these to `tools/test_analytics_range.js`:
  - `row at 2026-10-05T16:30Z counted on 2026-10-06`.
  - `from=2026-10-06 includes it`.
  - `to=2026-10-05 excludes it`.
  - `reversed range swapped`.
  - `hourWeekday[1][0] counts it`.
  - `busiest picks the max cell`.
  - `p95 of [100..2000 step 100] is 1900`.
  - `histogram bin 500–1000 counts 800 and 900`.
  - `11000 ms lands in the 10 s+ bin`.
  - `CSV header has timestamp_manila second`.
- [ ] **Step 3:** Run both. Expected: FAIL.
- [ ] **Step 4:** Implement the changes.
- [ ] **Step 5:** Run the full suite. Expected: all pass.
- [ ] **Step 6:** Commit: `Count analytics in Manila time and add hot-time and answer-time figures`.

### Task 10: Questions search and paging

**Files:**
- Modify: `api/analytics.js`
- Test: `tools/test_questions_view.js` (new)

**Interfaces:**
- Produces: **`GET /api/analytics?view=questions&page=1&size=50&q=&office=&lang=&from=&to=`** (gated):
  - Response: `{ rows: { ts, query, department, subservice, needsContext, latency_ms, lang }[], total, page, pages, size, offices: string[] }`.
  - Order: newest first.
  - `size` is clamped to 1–200.
  - `page` is clamped to 1–`pages`.
  - `q` is a case-insensitive substring match on `query`.
  - `office` is an exact `department` match.
  - `lang` is `en` or `fil`.
  - `kind` is `service` or `location`; rows carry `kind`, defaulting to `service`.
  - `offices` lists the distinct departments in the range, sorted.

- [ ] **Step 1:** Write the tests, over 120 fake rows:
  - `page 2 of size 50 returns rows 51–100 newest-first`.
  - `size=999 clamps to 200`.
  - `q matches case-insensitively in Filipino text`.
  - `office filter exact`.
  - `lang filter`.
  - `page beyond end clamps to last page`.
  - `401 anonymous`.
  - `synthetic rows excluded`.
- [ ] **Step 2:** Run it. Expected: FAIL.
- [ ] **Step 3:** Implement the view.
- [ ] **Step 4:** Run the full suite. Expected: all pass.
- [ ] **Step 5:** Commit: `Let the dashboard search and page through every question`.

### Task 11: Navigation figures in Manila time, with route outcomes

**Files:**
- Modify: `api/navlog.js` (the day filter, the summary and CSV)
- Modify: `tools/test_navlog.js`

**Interfaces:**
- Produces new summary fields, added to the existing ones:
  - `noEnding = max(0, started − arrived − abandoned)`;
  - `alreadyHere`, the count of `nav_already_here` events;
  - `arrivalTimesN`, the number of arrivals with a usable `elapsed_ms`.
- The day filter uses `manilaDay`.
- The CSV gains `timestamp_manila` after `timestamp_utc`, and `date` becomes the Manila date.

- [ ] **Step 1:** Add tests:
  - `noEnding = 10 starts − 3 arrive − 2 abandon = 5`.
  - `noEnding never negative`.
  - `alreadyHere counted`.
  - `arrivalTimesN excludes missing elapsed_ms`.
  - `Manila day filter on a 16:30Z event`.
  - `CSV has timestamp_manila`.
- [ ] **Step 2:** Run it. Expected: FAIL.
- [ ] **Step 3:** Implement the changes.
- [ ] **Step 4:** Run the full suite. Expected: all pass.
- [ ] **Step 5:** Commit: `Report how every route ended, in Manila time`.

### Task 12: Dashboard shell (layout, themes, menu, range, URL, refresh)

Before writing CSS or markup, load the `ui-ux-pro-max` skill (Jace asked for it) and the `dataviz` skill. Use them as checklists.

**Files:**
- Rewrite: `wayfinding-app/admin.html`, a shell only: the sign-in mount, side menu, top bar, drawer, range bar or sheet, page container, error banner and "updated at".
- Create: `wayfinding-app/css/admin.css` (tokens for both themes; layout at 900 and 640 px), `wayfinding-app/js/admin.js` (the shell controller)
- Delete: `wayfinding-app/css/admin_auth.css`, folded into `admin.css`.
- Test: `tools/test_admin_shell.js` (new; pure functions lifted from `admin.js`, as the motion test does)

**Interfaces:**
- Consumes: `ADMIN_AUTH` (Task 7), `ADMIN_PAGES` (Task 14), and the endpoints from Tasks 3, 9, 10 and 11.
- Produces, in `admin.js`:
  - **`parseViewState(search: string) → { page, range, from, to }`:**
    - `page` is one of `overview|questions|hottimes|speed|routes|people`, defaulting to `overview`;
    - `range` is one of `7d|30d|all|custom`, defaulting to `all`;
    - `custom` needs valid `from` and `to`, otherwise it falls back to `all`.
  - **`viewStateToSearch(state) → string`,** the inverse. The URL is kept in sync with `history.replaceState`.
  - **`rangeToQuery(state, today: string) → { from?, to? }`:** `7d` means today and the 6 days before it, in Manila time.
  - **`api(path) → Promise<object>`:** fetches with credentials. A 401 or 403 calls `stopRefresh()` and `showSignIn('ended')`, clears the page container, and rejects.
  - **`ADMIN_SHELL.ctx`** = `{ state, fetchJson: api, rangeQuery, laptop: boolean }`, where `rangeQuery` is `rangeToQuery(state, manilaToday)`. It is passed to the page renderers.
  - **`stopRefresh()`** clears the 30 s timer. **`showSignIn(reason?)`** hides the shell and calls `ADMIN_AUTH.mount(signInEl, { reason, onSignedIn: startShell })`.
- **Theme:** `data-theme` on `<html>`, with localStorage key `wf-admin-theme`. Every read and write is wrapped in `try/catch`. Dark is the default.
- **Refresh:** every 30 s and on any range change. Show "Updated 10:42 AM". On an error other than 401 or 403, show the banner and keep the last good data.
- **Laptop mode** (`{laptop: true}` from `status()`): no sign-in. Every page shows `Not available on the laptop server. Open https://penaranda-dissertation.vercel.app/admin.html for the live dashboard.`
- **Menu:**
  - items: Overview, Questions, Hot times, Speed, Routes, People, a divider, then Map editor (links to `/?editor=1`);
  - the person's name and Sign out sit at the bottom;
  - below 900 px it moves to a drawer that closes when an item is picked, on the backdrop and on Escape, with focus returned to the menu button.
- **Range sheet** (below 900 px): opened by a button labelled with the active range. It holds 7 days, 30 days, All time, Custom dates and Download CSV (questions CSV and navigation CSV).

- [ ] **Step 1:** Write `tools/test_admin_shell.js`. Tests:
  - `parse defaults → overview/all`.
  - `bad page → overview`.
  - `custom without dates → all`.
  - `round-trip parse(viewStateToSearch(s)) equals s`.
  - `7d on 2026-11-09 → from 2026-11-03 to 2026-11-09`.
  - `401 from api() stops refresh and shows sign-in with reason 'ended', page container emptied`, using stubbed `fetch`, `stopRefresh` and `showSignIn` (Review Focus 2).
  - `403 same`.
  - `500 keeps last data and shows banner`.
- [ ] **Step 2:** Run it. Expected: FAIL.
- [ ] **Step 3:** Implement the shell, CSS and markup. Pages may render placeholders until Task 14.
- [ ] **Step 4:** Run the full suite. Expected: all pass.
- [ ] **Step 5:** Commit: `New dashboard shell: dark console, light switch, phone drawer and range sheet`.

### Task 13: Chart and tile builders

**Files:**
- Create: `wayfinding-app/js/admin_charts.js`. Pure functions that return HTML strings, exposed as the global `ADMIN_CHARTS`. No DOM access.
- Test: `tools/test_admin_charts.js` (new; run in `vm`)

**Interfaces (Produces, all on `ADMIN_CHARTS`):**
- **Text helpers:**
  - `esc(s)` escapes `& < > " '`.
  - `fmtSec(ms)` gives `"0.9 s"`.
  - `fmtDur(ms)` gives `"1m 12s"`, `"45s"`, or `"—"` for 0 or null.
  - `ofText(a, b)` gives `"5 of 22"`.
  - `sampleTag(n)` gives `'<span class="tag-small">Small sample</span>'` when `n < 30`, else `''`.
  - `hourLabel(h)` gives `"12 AM"`, `"1 PM"` and so on.
  - `WEEKDAYS = ['Mon','Tue','Wed','Thu','Fri','Sat','Sun']`.
- **`tile({ label, value, sub, n }) → string`:** the sample tag appears when `n` is given and below 30.
- **`bars(items: {name, count}[], { max = 10 }) → string`:** horizontal bars, with the name and count printed and the width as a percentage of the top count.
- **`heatmap(matrix: number[7][24], { sideways: boolean }) → string`:**
  - five steps on the blue ramp;
  - empty cells blank;
  - non-empty cells print their count;
  - the office-hours band covers hours 8 to 16 inclusive (8 AM to 5 PM);
  - each cell has `aria-label` like `"Wed 12 AM: 14 questions"`.
- **`histogram(bins) → string`:** labelled `"0–0.5 s"` through `"10 s+"`, with counts printed.
- **`outcomeBar({ arrived, abandoned, noEnding }) → string`:** one stacked bar, with segments labelled `Arrived N`, `Closed early N` and `No ending recorded N`.
- **`takeaway.busiest(summary)`:**
  - with data: `"The busiest slot is Wed 12 AM, with 14 questions."`;
  - without data: `"No questions in this range yet."`.
- **`takeaway.speed(latency)`:** `"Half of answers arrived within 0.9 s; 95% within 2.8 s."`
- **`takeaway.routes(nav)`:** `"5 of 22 routes with an ending reached the office."`, followed by `" Small sample."` when `resolved < 30`.
- **`takeaway.offices(top)`:** `"Most questions were about <office> (N)."`
- **`emptyState(text) → string`:** `"<text> Try a wider range."`

- [ ] **Step 1:** Write the tests:
  - `esc neutralises <img src=x onerror=alert(1)>` (Review Focus 1).
  - `bars() escapes names`.
  - `heatmap prints counts and blanks zeros`.
  - `heatmap aria-label wording`.
  - `sideways heatmap has 24 rows × 7 cols`.
  - `office band marks hours 8–16 only`.
  - `histogram labels first and last bins`.
  - `sampleTag(29) tags, sampleTag(30) does not`.
  - `outcomeBar labels all three with counts`.
  - Each takeaway with data, and with an empty summary.
  - `no emoji in any output`: a regex over the Extended_Pictographic range, run over every function's output.
- [ ] **Step 2:** Run it. Expected: FAIL.
- [ ] **Step 3:** Implement the builders.
- [ ] **Step 4:** Run the full suite. Expected: all pass.
- [ ] **Step 5:** Commit: `Add the dashboard's chart and tile builders`.

### Task 14: The five analytics pages

**Files:**
- Create: `wayfinding-app/js/admin_pages.js`, the global `ADMIN_PAGES`.
- Test: `tools/test_admin_pages.js` (new; a static check plus a `vm` render with fixture data)

**Interfaces:**
- Consumes: `ADMIN_CHARTS` (Task 13), `ADMIN_SHELL.ctx` (Task 12), the summary (Task 9), the questions view (Task 10) and the navigation summary (Task 11).
- Produces: `ADMIN_PAGES.<page>(el: HTMLElement, ctx) → Promise<void>` for `overview`, `questions`, `hottimes`, `speed` and `routes`. Each one fetches what it needs through `ctx.fetchJson` and fills `el`.
- **Page contents,** as in the spec:
  - **Overview:**
    - five tiles: questions asked; median answer time ("95% within X s"); routes that arrived ("5 of 22", "with an ending", n = resolved); median time to arrive ("from N arrivals", n = `arrivalTimesN`); busiest time;
    - the heatmap, wide, beside the top offices;
    - recent questions (the newest 8), wide, beside the answer-time histogram.
  - **Questions:**
    - top services, top offices, the language split, and the clarification rate shown as `ofText(count, of)`;
    - search, office and language filters;
    - the paged list: 50 rows a page, with Previous and Next. Columns: time (Manila), the question, office, service, answer time, language, and "Asked to clarify" (Yes or blank). Location questions carry a "Location question" tag, and the filters include a kind choice. Below 640 px the rows are stacked: the question first, then time, office and answer time.
  - **Hot times:** the full heatmap (sideways below 640 px, using `matchMedia`), the ten busiest slots ranked, and questions per day.
  - **Speed:** median, p95 and the histogram; time to arrive as median and mean with its n.
  - **Routes:** the outcome bar, top destinations, re-scans and "I'm already here" reports.
- Every panel opens with its takeaway sentence, and shows `emptyState` when it has no data.

- [ ] **Step 1:** Write the tests:
  - `every innerHTML assignment in admin_pages.js is built from ADMIN_CHARTS output or esc()` (Review Focus 1): a static check that rejects template literals interpolating `row.query`, `.department` or `.name` without `esc(`.
  - Render `overview` with a fixture summary into a minimal fake element. Check that it contains `"5 of 22"`, `"Small sample"` and `"95% within"`.
  - `questions page builds the right query string for q/office/lang/page`.
- [ ] **Step 2:** Run it. Expected: FAIL.
- [ ] **Step 3:** Implement the pages.
- [ ] **Step 4:** Run the full suite. Expected: all pass.
- [ ] **Step 5:** Commit: `Add the Overview, Questions, Hot times, Speed and Routes pages`.

### Task 15: People page

**Files:**
- Modify: `wayfinding-app/js/admin_pages.js` (add `ADMIN_PAGES.people`)
- Test: `tools/test_admin_pages.js` (extend)

**Interfaces:**
- Consumes: `GET`, `POST` and `DELETE /api/people` (Task 3).
- Produces: **`ADMIN_PAGES.people(el, ctx)`:**
  - owners first, marked "Owner" with no remove button;
  - then everyone else, each with who added them and when (Manila time);
  - the add field, with the note "They need a Google Account. Gmail or a work address registered with Google both work.";
  - remove, which opens an in-page dialog;
  - recent changes underneath.
- **Removing yourself** is allowed. The dialog then says `You will lose access as soon as you confirm.`, and after the removal the shell returns to sign-in.

- [ ] **Step 1:** Add the tests:
  - `owner row has no remove button`.
  - `server error sentence shown for a bad address`.
  - `self-removal dialog warns`.
  - `added row shows addedBy`.
  - `emails escaped`.
- [ ] **Step 2:** Run it. Expected: FAIL.
- [ ] **Step 3:** Implement the page.
- [ ] **Step 4:** Run the full suite. Expected: all pass.
- [ ] **Step 5:** Commit: `Add the People page for managing who can sign in`.

### Task 16: Phone, theme and accessibility check; deploy Phase 2

- [ ] **Step 1:** Run the dashboard against synthetic data.
  - Create `wayfinding-app/js/admin_fixture.js`, a global `ADMIN_FIXTURE` holding a summary, a questions page, a navigation summary and people.
    - All of it is invented. It holds no real citizen queries.
    - It includes a 120-character question, a 70-character office name, and the XSS string from Review Focus 1.
  - `admin.js` loads it only when `location.hostname` is `localhost` or `127.0.0.1` and `?fixture=1` is present. In that mode `status()` returns a fake signed-in owner, and `api()` answers from the fixture.
  - Serve `wayfinding-app/` with a plain HTTP preview server from `.claude/launch.json`. The HTTPS laptop server isn't reachable from the preview tools.

  Check each page in the browser pane at 360×740, 390×844, 768×1024 and desktop, in both themes:
  - `document.documentElement.scrollWidth <= innerWidth` on every page (Review Focus 3);
  - the drawer and the range sheet open and close, including on Escape;
  - tap targets are at least 44 px, using computed sizes;
  - inputs use 16 px text;
  - text contrast is at least 4.5:1 in both themes;
  - keyboard focus is visible;
  - `prefers-reduced-motion` removes the transitions.

  Fix anything that fails, rerun the suite, and commit.
- [ ] **Step 2:** Request a whole-branch review (superpowers:requesting-code-review). Fix what survives verification.
- [ ] **Step 3:** Merge to `main` and push. On the live site, signed in as Jace, check every page on a phone and on a desktop. The citizen starter chips must still load.
- [ ] **Step 4:** Update `ADMIN_GUIDE.md` (the dashboard pages), `SYSTEM_CONTEXT.md` and `IMPLEMENTATION_AUDIT.md`. Commit and push.

# Admin analytics revamp and Google sign-in — design

Date: 2026-11-08
Status: draft, awaiting approval
Scope: the analytics dashboard (`wayfinding-app/admin.html`) and the sign-in that gates it and the map editor. The map editor's own redesign is a separate design.

## Why

Two groups open this dashboard: Calamba City Hall admins, and the dissertation panel. Both want to see what citizens ask and how the system performs: how fast it answers, when demand peaks, and whether people reached the office.

The current dashboard falls short in four ways:

1. **It is open to anyone.** `GET /api/analytics` and `GET /api/navlog` have no authentication. Anyone with the URL can read the recent citizen questions, word for word, and download the full log as CSV. That is a privacy problem under RA 10173, and the questions belong to citizens.
2. **It uses UTC everywhere.** A 9 AM question in Calamba is counted as 1 AM. "Hot time" cannot be read correctly, and "today" rolls over at 8 AM Manila time.
3. **It has no hot-time view.** Nothing shows demand by hour and weekday.
4. **It does not show sample sizes.** "Arrival rate 22.7%" is computed from 5 arrivals, and the panel will read it as a finding.

The staff gate is also weak. The map editor opens with a shared PIN (`ADMIN_PIN`, still unset in Vercel, so the public fallback `2024` works). Publishing needs a second shared secret, `MAP_ADMIN_TOKEN`, typed into a `prompt()`. Nobody can tell who did what, and access cannot be withdrawn from one person without changing it for everyone.

## Decisions made by Jace

- **Layout B, "Console".** Dark, a left side menu, dense tiles and panels with everything above the fold on the overview. The approved mockup is described under "Overview page" below.
- **Google sign-in** replaces both the PIN and the typed publish token.
- **One level of access.** Everyone on the list gets both Analytics and the Map editor, including publishing. There are no viewer and editor roles. Panel members on the list can therefore publish the map; rollback already exists for mistakes.
- **Admins manage the list themselves,** not only Jace. Any signed-in admin can add or remove people.
- **No accuracy metric.** Neither a live measure nor the offline test score appears on the dashboard.

## Goals

- Only people on the access list can see any analytics, raw questions, CSV exports, or navigation data, enforced on the server.
- Every time and date shown or filtered is Asia/Manila (UTC+8, no daylight saving).
- A first-time reader understands each chart without help: a plain sentence above each panel states the takeaway in words.
- Thin numbers are visibly marked as thin.
- The citizen app is unchanged and still needs no sign-in.

## Non-goals

- Any change to the citizen-facing app, other than replacing the PIN entry points and pointing the starter chips at their new public read.
- An accuracy or correctness metric.
- Deleting or cleaning the existing logs. The revamp deletes nothing. Clearing the test queries before the defense is a separate, explicit step Jace will ask for, with a backup first, as done before.
- Redesigning the map editor. Only its entry and its publish authorization change here.
- Roles or permission levels.

## Anti-goals (a failure even if it technically works)

- Any analytics endpoint still answering without a valid session.
- An admin being able to lock everyone out, including themselves, through the People page.
- Someone removed from the list keeping access until their session expires.
- A shared counter PC staying signed in overnight.
- Color being the only way to read a chart.
- A dark theme so dim that it fails on the panel's projector, with no way to switch.

## Access and sign-in

### Flow

1. `admin.html` opens on a sign-in screen with the Google Identity Services "Sign in with Google" button. Nothing else on the page loads first.
2. The button returns an ID token (a JWT). The page posts it to `POST /api/auth`.
3. The server verifies the token: signature against Google's keys, `aud` equal to `GOOGLE_CLIENT_ID`, issuer, expiry, and `email_verified === true`. Use the official `google-auth-library` (`OAuth2Client.verifyIdToken`). Do not hand-roll JWT verification.
4. The server checks the email against the access list (below). If it is not on the list, the response says so plainly and no session is issued.
5. If it is on the list, the server sets an `HttpOnly; Secure; SameSite=Lax; Path=/` session cookie, HMAC-signed with `SESSION_SECRET`, carrying the email, display name and expiry.
6. Sessions last **8 hours** (Jace's call delegated: protects shared counter PCs). A visible **Sign out** clears the cookie.

### What each request checks

Every gated request verifies the cookie signature and expiry, **and** re-checks that the email is still on the list. A removal therefore takes effect on that person's next request, not when their session expires.

| Endpoint | Before | After |
|---|---|---|
| `GET /api/analytics` (JSON and CSV) | open | session required |
| new public "starter chips" read | | open, returns **only** the top 5 service names |
| `GET /api/navlog` (JSON and CSV) | open | session required |
| `POST /api/navlog` | open | **stays open**: events come from citizens' phones |
| `GET /api/mapstate` (current map) | open | **stays open**: every citizen device loads the map. Anonymous responses carry **no publisher identity** |
| `GET /api/mapstate?history=1` and `?version=N` | open | session required (only the editor uses them) |
| `POST /api/mapstate` (publish, rollback) | `MAP_ADMIN_TOKEN` | session **or** `MAP_ADMIN_TOKEN` |
| `POST /api/chat` | open | stays open |
| `api/adminauth.js` (PIN) | open | removed |
| new `/api/auth` | | sign in, who am I, sign out |
| new `/api/people` | | list, add, remove (session required) |

Gated endpoints drop `Access-Control-Allow-Origin: *`; the dashboard and editor are same-origin.

On publish, `updatedBy` comes from the session (the signed-in person's name and email), never from the request body. Map history then shows who really published.

**Publisher identity stays private** (Claude's call). Today `GET /api/mapstate` returns `updatedBy` to every citizen device. Once that holds real names and emails of admins and panel members, it would leak them publicly, which is the same RA 10173 problem this revamp fixes. So anonymous reads of the current map omit `updatedBy`, and the history and version reads (used only by the editor) require a session. The 409 conflict response only ever goes to a signed-in publisher, so it may name who published first.

**The citizen starter chips keep working** (Claude's call). On every page load, `wayfinding-app/js/chat.js` (`_loadDynamicStarters`) reads `GET /api/analytics` to build its suggestion chips from the five most-asked services. That full response also carries the 20 most recent questions word for word, so every citizen phone currently downloads them. The chips move to a narrow public read that returns only the top five service names. Those names come from the Citizen's Charter, which is public, and the read carries no question text and no counts. The citizen app's behavior is unchanged. Whether this is a separate endpoint or a public view of the analytics function is the builder's choice.

**`MAP_ADMIN_TOKEN` becomes an API-only emergency key** (Claude's call). With the PIN gone, Google sign-in is the only way into the editor, so a token path inside the editor would be a second way in. The editor keeps no token code (`_ensurePublishToken` and its `prompt()` go). The token still works on `POST /api/mapstate` for publish and rollback from the command line, which mainly lets Jace roll the map back if Google sign-in is ever down. Such writes record `updatedBy` as "emergency key", never a name from the request body. `ADMIN_GUIDE.md` documents the command.

### The access list

- **Owners** come from an environment variable, `OWNER_EMAILS` (comma-separated, initially Jace's Google email). Owners are always allowed and cannot be removed from the People page. This is what makes a lock-out impossible.
- **Everyone else** lives in Redis (a set, for example `wf:admins`). Any signed-in person can add or remove them on the People page.
- Every add and remove is recorded with who did it and when, in a Redis list (for example `wf:admins:log`), and the People page shows the recent entries.
- Emails are compared lowercased and trimmed.
- Anyone with a Google Account can be added, including non-Gmail addresses registered as Google Accounts. People without one cannot sign in; the People page should say this next to the add field.

### Google Cloud setup (Jace does this; Claude cannot create accounts)

1. Google Cloud Console, new project.
2. OAuth consent screen: External; scopes `openid`, `email`, `profile` only.
3. **Publish the app ("In production").** In Testing mode, only test users listed in Google Cloud can sign in, which would mean maintaining two lists and would block people that admins add on the People page. With only these basic scopes, publishing needs no Google review. *This corrects earlier advice in the chat to leave the app in Testing.*
4. Credentials, OAuth client ID, Web application. Authorized JavaScript origins: `https://penaranda-dissertation.vercel.app`, plus `https://localhost:3001` for the local server.
5. No client secret is needed (the ID-token flow has no code exchange).
6. Vercel environment variables: `GOOGLE_CLIENT_ID`, `OWNER_EMAILS`, `SESSION_SECRET` (random, at least 32 bytes). Then redeploy.

Until `GOOGLE_CLIENT_ID` and `SESSION_SECRET` are set, gated endpoints must refuse (fail closed) with a clear "sign-in not configured" message, and the sign-in screen must say what is missing. Do not fall back to open access.

### Map editor entry

The editor still lives inside the citizen app (`index.html`, admin view). The two PIN entry points, the corner toggle button and the temporary landing-page button, change to:

- signed in: open the editor straight away;
- not signed in: go to the sign-in screen, then come back to the editor.

The `prompt()` asking for `MAP_ADMIN_TOKEN` is removed from the normal publish path. `ADMIN_PIN` and `api/adminauth.js` are retired.

## Dashboard

### Visual system (from the approved mockup)

- Dark by default, with a **light/dark switch** (Claude's call, because layout B is weaker on a projector). Both themes are designed, not auto-inverted; the light theme is the one used for presenting. The choice is remembered per browser.
- Tokens from the mockup. Dark: plane `#0e1318`, surface `#171d24`, primary text `#e9edf2`, secondary text `#b3bdc9`, muted `#8b96a3`, hairline `#2a323b`, accent `#86b6ef`. Light: plane `#f3f4f6`, surface `#ffffff`, primary text `#0f172a`, secondary text `#475569`, muted `#64748b`, hairline `#e2e5ea`, accent `#1c5cab`.
- Typeface: Fira Sans with tabular figures.
- Icons: inline SVG line icons. No emoji anywhere in this UI (Jace's standing preference).
- Charts follow one sequential blue ramp for magnitude, single-series bars in one color, no dual axes, and status colors only for route outcomes, always with a text label.

### Shell

- **Left side menu:** Overview, Questions, Hot times, Speed, Routes, People, then a divider and Map editor. The signed-in person's name, and Sign out, sit at the bottom.
- **Filter bar** across the top of every analytics page: 7 days, 30 days, All time, Custom (from/to dates), the active range spelled out in Manila time, and **Download CSV**.
- Deep links: each page and the active range are in the URL, so a link opens the same view.
- At narrow widths the side menu collapses behind a menu button, and the dashboard stays usable on a phone.

### Overview page (the approved mockup)

- Five tiles: Questions asked; Median answer time (subline: "95% within X s"); Routes that arrived ("5 of 22", subline "with an ending"); Median time to arrive (subline: "from N arrivals"); Busiest time (weekday and hour, with its count).
- Hot times heatmap (wide) beside Top offices (bars).
- Recent questions table (wide) beside "Questions by answer time" (histogram).

### Questions page

The full list of questions, newest first: time (Manila), the question in the citizen's own words, office, service, answer time, language, and whether the assistant had to ask a clarifying question. Search by text; filter by office and by language; paged. Above it: top services and top offices, the language split, and the **clarification rate**.

The clarification rate (today's "ambiguity rate", from `needsContext`) stays (Claude's call). It is not the accuracy metric Jace dropped: it counts how often the assistant asked a follow-up question, not whether answers were right. `OBJECTIVES_ASSESSMENT.md` lists it under SOP 4.2.4 and `ADMIN_GUIDE.md` documents it, so removing it would drop a figure the paper reports. It moves off the overview tiles to the Questions page, where it is read in context.

### Hot times page

The heatmap at full size: weekday rows by 24 hourly columns, Manila time, with the office-hours band marked (8 AM to 5 PM, Claude's assumption: confirm City Hall's hours). Each non-empty cell prints its count, so color is never the only channel. Beside it, a ranked list of the busiest slots, and questions per day over the range.

### Speed page

Answer time: median, 95th percentile, and the histogram in half-second bins. Time to arrive: median and mean, with the number of arrivals they come from.

### Routes page

How routes ended: arrived, closed early, and no ending recorded, as one stacked bar with labelled counts. Top destinations. Re-scans, and "I'm already here" reports.

### People page

The access list: owners first (marked, not removable), then everyone else, each with who added them and when. Add by email. Remove with a confirmation. The recent changes log underneath.

### Small numbers and empty states

- Any rate or median computed from fewer than 30 events carries a "Small sample" tag. (30 is Claude's call: a common rule of thumb; easy to change.)
- Every percentage shows its count beside it ("5 of 22", not "22.7%" alone).
- Empty ranges say so in a sentence and suggest widening the range, instead of showing blank charts.
- Takeaway sentences are generated from the data ("The busiest slot is Wednesday 12 AM, with 14 questions") and adapt when there is no data.

### Refresh

Data reloads when the range changes and on an interval (the current 30-second refresh can stay), with a visible "updated at" time. A failed load shows an error banner and keeps the last good data.

## Server-side data changes

- All day boundaries, the `from`/`to` filter, "today", and the hour/weekday breakdown move to Asia/Manila. CSV exports gain a Manila-time column next to the UTC one.
- New aggregates the pages need: an hour-by-weekday matrix, answer-time percentiles and histogram bins, and route outcomes including "no ending recorded" (started minus arrived minus abandoned).
- The Questions page needs search and paging over the full log, rather than only the last 20.
- Existing behavior stays: excluding synthetic health-check rows, the 50,000-entry cap, and paged reads from Redis.

## Constraints

- Hosting: static files from `wayfinding-app/` and serverless functions in `api/` on Vercel. The project currently has **no `package.json`**; adding one for `google-auth-library` is accepted. Keep shared helpers out of the function count (for example, files Vercel does not deploy as functions).
- Storage: the existing Upstash Redis. No new services.
- The repository is **public**. No secrets, real citizen queries, or the real floor plan may be committed. `.superpowers/` (mockups containing real queries) is git-ignored.
- Existing tests run against a fake Redis and must keep passing: `test_admin_publishing.js`, `test_analytics_range.js`, `test_analytics_range_local.py`, `test_navlog.js`, plus the others in `tools/`.
- The local laptop server (`wayfinding-app/serve_https.py`, port 3001) serves the old `/api/analytics` from `query_log.jsonl`, which has no navigation log, no `lang` field and often no `latency_ms`. **It gets no feature parity** (Claude's call). Its existing endpoint and `test_analytics_range_local.py` keep working unchanged. The new dashboard targets the hosted site. If opened locally, pages without data say "not available on the laptop server" instead of breaking. The hosted site must never be open.
- A push to `main` deploys straight to production. Commits are authored by Jace with no co-author line.

## Rollout order

Gated code must never reach production before sign-in is configured, or the dashboard and editor would be locked for everyone. The PIN is retired in the same change. So (Claude's call):

1. **Jace finishes the Google Cloud setup** and sets `GOOGLE_CLIENT_ID`, `OWNER_EMAILS` and `SESSION_SECRET` in Vercel. Claude confirms they are present before anything gated is pushed.
2. **Phase 1, the gate:** `/api/auth`, `/api/people`, the gated endpoints, the public starter-chip read, the private publisher identity, the new editor entry, and a sign-in screen in front of the *current* dashboard. This closes the open data quickly.
3. **Phase 2, the redesign:** the new dashboard, the Manila-time aggregates, and the new pages.

Each phase ships only with its tests passing and is checked against the live site.

## Left to the builder

- Whether to keep Chart.js or draw the charts as HTML/SVG, provided the chart rules above hold.
- Whether the dashboard stays one HTML file or splits into CSS/JS files.
- Endpoint shapes for `/api/auth`, `/api/people` and the new aggregates.
- Cookie name and the exact signing format.
- Whether the Questions search runs on the server or on a downloaded page of rows.
- How the local server handles sign-in.

## Verification

- Automated tests for: ID-token verification (with Google's verifier stubbed), allowlist decisions including owners and removals taking effect immediately, every gated endpoint refusing without a session, CSV gated the same way, `POST /api/navlog` and `GET /api/mapstate` still open, publish taking `updatedBy` from the session, and Manila-time bucketing around midnight and the 8 AM UTC rollover.
- A check against the live deployment that the gated endpoints refuse an anonymous request, that the anonymous map read carries no publisher identity, and that the citizen starter chips still load.
- The dashboard viewed in both themes and at phone width, with the pre-delivery checks: contrast, keyboard focus, reduced motion, no emoji icons.

## Calls Claude made (check these)

1. A light/dark switch, with light used for presenting.
2. Sign-in lasts 8 hours.
3. Owners come from `OWNER_EMAILS` and cannot be removed, so the People page can never lock everyone out.
4. Removing someone takes effect on their next request.
5. Publish the Google app instead of leaving it in Testing.
6. `MAP_ADMIN_TOKEN` survives only as an emergency key for command-line publish and rollback.
7. Publisher names and emails are hidden from citizens; map history needs sign-in.
8. Citizen starter chips move to a public read of the top five service names only.
9. The clarification ("ambiguity") rate stays, on the Questions page.
10. No feature parity for the laptop server.
11. "Small sample" below 30 events.
12. Office hours are 8 AM to 5 PM on the heatmap (confirm City Hall's actual hours).
13. Two-phase rollout, with the Google setup done first.

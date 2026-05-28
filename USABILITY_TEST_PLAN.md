# Pre-Fieldwork Usability Test Plan
### Verify the system actually works before going to City Hall

This is a **self-test + 3-5 helper test** to catch bugs before exposing the system to real respondents. ~2 hours of testing total.

---

## 🎯 Why this matters

If you walk into City Hall and:
- The chat takes 60 seconds to load
- The map doesn't show the building
- The QR scanner can't read a printed code
- Pathfinding draws a route through walls
- The floor switching button does nothing on mobile

…you've burned the trust of the staff and wasted a day. Catching these in advance is critical.

---

## 🧪 Test environment requirements

Before starting, confirm:

- [ ] System is deployed publicly (Oracle Cloud URL working from outside your home network)
- [ ] You have **at least one Android phone** and **one iPhone** for testing (borrow from family if needed)
- [ ] You have access to your laptop AND both phones simultaneously
- [ ] You can print one test QR code from the app's QR Generator
- [ ] You have 30 minutes to do a solo walk-through
- [ ] You have 3–5 friends/family willing to spend 15 minutes each

---

## 🔬 Test categories

| Category | What it validates | Estimated time |
|---|---|---|
| **A. Smoke test** (you alone, 10 min) | Server up, basic functionality | 10 min |
| **B. Module tests** (you alone, 30 min) | Each of 3 modules works in isolation | 30 min |
| **C. End-to-end scenarios** (you + helper, 15 min each) | Real user flows | 30–60 min |
| **D. Mobile / cross-device** (multiple phones, 15 min) | Works on Android + iOS, with different browsers | 15 min |
| **E. Stress test** (2–3 helpers at once, 10 min) | Multi-user behavior | 10 min |
| **F. Edge cases** (you alone, 15 min) | Things that should fail gracefully | 15 min |

Total: ~2 hours.

---

## ✅ A. Smoke test (10 minutes, solo)

Open the deployed URL on your laptop and run through these:

- [ ] Page loads in under 3 seconds
- [ ] Octagonal grid renders for all 4 floors (use ▲▼ buttons to switch)
- [ ] Tapping an open cell draws a colored path from the start
- [ ] Floor selector shows `Floor 1`, `Floor 2`, etc.
- [ ] Chat widget icon visible at bottom of screen
- [ ] Admin dashboard reachable at `/admin.html`
- [ ] Admin dashboard auto-refreshes (countdown timer ticks)
- [ ] HTTPS lock icon shows in browser address bar
- [ ] No JavaScript console errors (open Dev Tools → Console)

If any of these fail → STOP and fix before continuing.

---

## ✅ B. Module tests (30 minutes, solo)

### B.1 Conversational AI chat (10 min)

Open chat widget and send these 8 queries one by one. For each:
- Note: did it answer in <10 seconds?
- Note: is the answer relevant and in Filipino/Taglish?
- Note: did the route auto-draw on the map?

| # | Query | Pass criteria |
|---|---|---|
| 1 | `Saan po pwedeng mag-apply ng business permit?` | Mentions BPLO or Business Permits, route drawn |
| 2 | `Ano ang requirements para sa cedula?` | Lists 2+ requirements clearly |
| 3 | `Paano kumuha ng birth certificate?` | Mentions Civil Registry, lists procedure |
| 4 | `Where can I pay real property tax?` | English query handled, mentions Treasury |
| 5 | `Saan magpa-apply ng senior citizen ID?` | OSCA mentioned (even if not on map yet) |
| 6 | `Asan ang mayor?` | Mentions Mayor's Office on Floor 3 |
| 7 | `Saan ang health center?` | Mentions Health Services Department |
| 8 | (Gibberish) `asdfgh kuwhwhdj` | Returns a graceful "could you rephrase?" |

**Pass rate target: 7/8.** Document any failures.

### B.2 Wayfinding map editor (10 min)

In a private/incognito browser tab (so localStorage is fresh):
- [ ] Click "Wall Mode" → can paint walls on the grid
- [ ] Switch to Door, Stair → paints those types
- [ ] Erase button removes the paint
- [ ] Undo (Ctrl+Z) reverts
- [ ] Redo (Ctrl+Y) re-applies
- [ ] Select Mode → drag to select region works
- [ ] Selected region can be rotated (↻ CW button)
- [ ] Stamp tool → can save a 5×5 pattern and place it
- [ ] Clear Walls → all walls removed
- [ ] Sync button (☁) — works if server-side state matters, OK to skip otherwise
- [ ] Refreshing the page restores the map (localStorage)

### B.3 QR code generation + scanning (10 min)

- [ ] Open Nav Mode → "Gen QR" button visible
- [ ] Pick Floor 1, Row 37, Col 37 → QR preview appears
- [ ] Click "Save PNG" — file downloads
- [ ] Open the PNG on your laptop screen at full size
- [ ] On your **phone**, open the live URL → enable Nav Mode → "Scan QR"
- [ ] Allow camera permission
- [ ] Aim phone at the laptop's QR code on screen
- [ ] Position updates to row 37, col 37 on Floor 1

If scanning fails:
- Lighting? (need decent ambient light)
- Distance? (~30 cm works best)
- The QR code on screen is sharp? (zoom in if needed)

---

## ✅ C. End-to-end scenarios (15 min × 3–5 helpers)

This is the **most important test**. Recruit 3–5 people who haven't seen the system.

### Setup
- Open the live URL on a phone
- Hand the phone to your helper
- Say only: *"I want to test a wayfinding app. Try to find out where to apply for a business permit and how to get there."*
- Time them. Take notes. Don't help unless they ask.

### Scenarios (rotate one per helper)

**Scenario 1 — Get business permit info + location**
- Start: opens app cold
- Goal: knows what office to go to + has route drawn on map
- Success: completes in < 2 minutes without asking you

**Scenario 2 — Find the Mayor's office on a different floor**
- Start: opens app on Floor 1
- Goal: navigates the map to Floor 3 and identifies Mayor's office position
- Success: reaches Floor 3 with route drawn

**Scenario 3 — Check requirements for cedula (community tax certificate)**
- Start: opens chat widget
- Goal: gets a clear list of what to bring
- Success: helper can repeat the requirements back to you

**Scenario 4 — Switch language mid-conversation**
- Start a chat in Filipino, then switch to English mid-sentence
- Goal: system handles both
- Success: relevant answer in either language

**Scenario 5 — Use the navigation simulation**
- Enable Nav Mode
- Walk around the room
- Goal: position dot moves on the map
- Success: dot shifts as helper walks (PDR working)

### What to record per helper

```
Helper #: ___ (Name initials)
Age group: 18-24 / 25-34 / 35-44 / 45-59 / 60+
Scenario: ___
Start time: ___ End time: ___
Asked for help? Y/N (how many times: ___)
Where got stuck: ____________________
Final result: SUCCESS / PARTIAL / FAILED
Verbatim quotes: ___________________
```

---

## ✅ D. Mobile / cross-device test (15 min)

Open the live URL on **at least 3 different devices**:

| Device | Should work? |
|---|---|
| Android Chrome (any modern version) | ✅ All features including PDR, QR scan |
| iPhone Safari (iOS 13+) | ✅ All features including PDR, QR scan |
| iPhone Chrome | ✅ All features |
| Desktop Chrome / Edge | ✅ Map + chat (no PDR — no motion sensor) |
| Old Android (4-5 year old phone) | ⚠️ Map should still work, PDR may be flaky |

For each device:
- [ ] Page loads
- [ ] Octagonal map renders properly
- [ ] Chat widget opens and accepts input
- [ ] Floor switching works (▲▼)
- [ ] Pan + zoom (pinch on touch, scroll on desktop)
- [ ] Address bar shows HTTPS lock

---

## ✅ E. Stress test (10 min)

Recruit 2–3 helpers to hit the system **at the same time**:

- All open the URL simultaneously
- All send a chat query within 30 seconds of each other
- All tap different cells on different floors

Watch:
- [ ] All queries return in reasonable time (<15 s each)
- [ ] No 500 errors or blank responses
- [ ] Admin dashboard shows all queries logged
- [ ] Server doesn't crash (check Oracle Cloud monitoring)

**Expected behavior with current setup (Oracle Free ARM + Gemini):**
- ~10 RPM concurrent fine
- Above 15 RPM: Gemini may rate-limit and return "I'm busy, please retry"
- That's acceptable behavior — note it for the dissertation

---

## ✅ F. Edge cases (15 min, solo)

Things that *should* fail gracefully (not crash):

- [ ] Submit an empty chat message → should be rejected with a message, not crash
- [ ] Submit a very long query (500+ characters) → should still respond
- [ ] Tap a wall cell → no route, gentle error message
- [ ] Tap a cell in the dark "outside" area (octagon exterior) → no route, gentle error
- [ ] Disconnect Wi-Fi mid-query → reasonable timeout / error message
- [ ] Refresh page during PDR → recovers cleanly
- [ ] Open same URL in two tabs on same device → no localStorage conflicts
- [ ] Send chat query in pure emojis 🙄🤔 → graceful response
- [ ] Switch floors during navigation → position adapts

---

## 📊 Pass / Fail criteria for greenlighting fieldwork

You're ready to do the City Hall fieldwork (A2) when:

- ✅ All A items pass
- ✅ All B items pass (or only 1 minor failure)
- ✅ At least **3/5 helpers in C** complete their scenario without asking for help
- ✅ At least **3 different devices in D** all work
- ✅ E shows no crashes (rate limiting acceptable)
- ✅ F shows graceful failures (no crashes)

If any of the above fail → fix first, retest, then go.

---

## 📝 Output of this test phase

Save these as evidence for your dissertation Chapter 4:

- `dissertation/pre_fieldwork_test_results.md` — summary of all test results
- Screenshots of any UI bugs found and fixed
- Notes from helper interviews (quotes are gold for Chapter 4 discussion)
- Performance numbers: median response time, error rate, completion time per scenario

This pre-test isn't part of the formal SUS evaluation, but the data informs your methodology section and demonstrates due diligence.

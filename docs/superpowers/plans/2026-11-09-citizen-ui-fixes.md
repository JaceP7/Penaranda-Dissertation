# Citizen map, prompts and messages: implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the citizen's route view, prompts and messages readable and reachable on a phone, per the ui-ux-pro-max audit of 2026-11-09. Jace approved all findings except #9 (the staff button), which waits for his placement decision. For #10 he chose to keep the most-asked chips.

**Architecture:** Static markup changes in `index.html` and CSS in `app.css`, plus small pure helpers in `app.js` and `chat.js` that the tests can lift. A new `js/ui_icons.js` replaces emoji with inline SVG line icons, drawn here so there are no licence questions.

**Spec:** The audit findings in the conversation of 2026-11-09, items 1–8 and 10–12. Measured at 375×812:
- 2 of the 4 step-bar buttons sat entirely off screen, including the iPhone motion button.
- The toast was a single line 836 px wide.
- "Reached the Ground Floor?" fired right after leaving the Ground Floor.

## Global Constraints

- **Width:** works from 320 px. No control may sit outside the viewport.
- **Touch and type:** tap targets at least 44 px tall; instruction text at least 16 px.
- **Icons:** no emoji in the citizen route view, prompts, toasts or arrival card. Use SVG icons with `aria-hidden="true"`; every button keeps a text label.
- **Language:** prompts the citizen must answer (the location prompt, the stairs confirmation, the arrival card) are in Filipino and English.
- **Toasts:** wrap, never exceed `100vw - 24px`, stay `aria-live="polite"`, last 3–8 s scaled to length, and dismiss on tap.
- **Don't break the existing tests:** keep every element id and class the current tests check (`navMotionBtn` inside `navStepPrompt` before `navRescanBtn`, `.nav-motion-btn[hidden]`, and so on).
- **Out of scope:**
  - Do not touch the analytics database.
  - Do not move the staff button (#9).

## Tasks

1. **Icons.** Add `js/ui_icons.js`, exposing `uiIcon(name)` and `uiHydrateIcons(root)`. Replace the emoji in:
   - the step bar, its instruction icon and wrong-way icon;
   - the stairs prompts;
   - the arrival card;
   - the location prompt;
   - "Ask again", the chat bubble, and the chat's QR hint;
   - the toast text.
2. **Step bar.** Lay it out in three rows:
   - the instruction;
   - a meta line, built by `_navMetaLine()`: for example "Ground Floor → Lower Ground Floor · about 24 m to the stairs";
   - action buttons that wrap.

   The meta line replaces the citizen-view step-count pill.
3. **Toast and the bottom area.**
   - The toast and the stairs prompts share one slot above "Ask again".
   - `_toastMs(msg)` sets how long a toast stays.
   - `_officeTitle(name)` turns "CITY HEALTH SERVICES DEPARTMENT" into "City Health Services Department".
4. **Stairs.**
   - `_onStairCell` becomes a top-level function and ignores stair cells while a route is active.
   - The stairs confirmation becomes bilingual.
5. **Location prompt.**
   - Bilingual title and text.
   - "Skip (for testing)" becomes "Magsimula sa main entrance / Start from the main entrance".
   - The manual help text no longer says "Floor 2".
   - A camera failure opens the manual panel via `NAV.onScanUnavailable` instead of a browser `prompt()`.
6. **Arrival card.**
   - Names the office: "You've reached the …" / "Nandito ka na".
   - Close button 44 px; action buttons 48 px.
7. **Chat.**
   - Hide the round chat button while the chat is open on phones.
   - Chip labels cut at a word boundary within 48 characters and wrap to two lines; chips are 44 px tall.
8. **No pop-ups for citizens.** The two `alert()` calls in `navigateToDepartment` become toasts.
9. **Verify.**
   - Run the suite.
   - At 375×812 and 320×640 in the browser, check that no control is outside the viewport and the bottom elements don't overlap.
   - Take screenshots, then deploy.

Test file: `tools/test_citizen_ui.js`. It is written first; every task's checks fail before that task is done.

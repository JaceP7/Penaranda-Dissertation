"use strict";

/**
 * nav.js — Navigation module: PDR + QR anchor localisation
 *
 * NAV.position    = current estimated grid cell { row, col }
 * PDR             = Pedestrian Dead Reckoning via DeviceMotion + Compass class
 * QR scanning     = camera feed decoded with jsQR; expects "GRID:floor:row,col"
 *                   (legacy "GRID:row,col" also accepted, assumes floor 0)
 * QR generation   = uses qrcode.js (CDN) to render a printable anchor QR code
 *
 * Heading: uses the Compass class (compass.js) for cross-platform normalisation
 *   (iOS webkitCompassHeading, Android absolute orientation).
 *   EMA smoothing α = 0.4 — trades some noise reduction for faster turn response
 *   (Harle, 2013: heading lag during turns is the dominant PDR error source).
 *
 * Step detection: zero-crossing with dynamic threshold (Jiménez et al., 2010).
 *   A step fires on a negative zero-crossing of (mag − windowMean), gated by
 *   the amplitude of the preceding positive half-cycle.  This is invariant to
 *   phone position (hand, pocket, bag), unlike pure peak-threshold methods
 *   (Kim et al., 2004; Brajdic & Harle, 2013).
 *   The magnitude is low-pass filtered first and centred on a ~1 s mean, the
 *   threshold starts at 0.32 m/s² and follows the last few steps, and a step
 *   only counts once a second one follows at a walking pace (2026-11-09: the
 *   old unfiltered 1.2 m/s² gate missed most hand-held steps, so citizens had
 *   to tug the phone; see tools/test_step_detector.js).
 *
 * Steps are suppressed until the compass delivers its first heading reading to
 *   avoid North-biased initial steps (Harle, 2013 §IV-B).
 *
 * On devices without motion sensors: use arrow keys or D-pad (wired in app.js).
 */

const NAV = {
  active: false,
  position: null, // { row, col } — set by navInit()
  pdrActive: false,
  heading: 0, // degrees from North (raw smoothed compass output)

  // ── Heading alignment (F3-lite) ──────────────────────────────────────────
  // The compass is unreliable indoors — magnetic interference from steel /
  // wiring makes "North" point at arbitrary directions. Instead of trusting
  // it absolutely, we ANCHOR forward to whatever direction the phone is
  // pointing when PDR starts (or when the user taps the 🧭 Align button).
  // Step direction is then computed from (heading - headingOffset).
  headingOffset: 0,        // degrees subtracted from raw heading before step mapping
  _autoAlignPending: false, // true between navStartPDR() and first compass reading

  // ── Motion permission (iOS 13+) ──────────────────────────────────────────
  // null = never asked, true = granted, false = refused. iOS only honours
  // DeviceMotionEvent.requestPermission() while a user gesture is still
  // "active", so the ask must happen in a tap handler - never in the QR decode
  // callback, which runs frames later with no activation left.
  _motionGranted: null,

  // ── Compass ──────────────────────────────────────────────────────────────
  _compass: null, // Compass instance (compass.js)
  _compassReady: false, // true once first heading reading arrives (A3)

  // ── Step detection (zero-crossing, Jiménez et al. 2010) ──────────────────
  // All of these are (re)set by navRecalibrate(); see _navOnMotion.
  _threshold: 0.32,   // m/s² — current gate on a half-cycle's peak above the mean
  _lp: null,          // low-passed |a|
  _mean: null,        // slow (~1 s) mean of |a|: gravity plus posture
  _lastSample: 0,     // ms, previous devicemotion sample
  _prevSign: 0,       // sign of (lp − mean) at the previous sample: +1 or -1
  _cyclePeak: 0,      // peak (lp − mean) of the current positive half-cycle
  _lastCandidate: 0,  // ms, last zero-crossing that passed the threshold
  _lastStepTime: 0,   // ms, last step actually counted
  _pending: 0,        // ms, a first step waiting for a second to confirm walking
  _pendingPeak: 0,
  _walking: false,    // true while steps keep arriving at a walking pace
  _peaks: [],         // peaks of the last few counted steps (adaptive threshold)

  // ── Drift / fix tracking ──────────────────────────────────────────────────
  _stepsSinceQR: 0, // steps taken since last QR fix
  _hasQRFix: false, // stays false until the first QR scan (A2)

  // ── Floor ─────────────────────────────────────────────────────────────────
  _currentFloor: 0, // kept in sync with STATE.currentFloor by app.js

  // ── Miscellaneous ─────────────────────────────────────────────────────────
  metresPerCell: 1.0, // set once via physical measurement before evaluation (B3)
  _trail: [], // breadcrumb history of recent positions (last 10)
  _stream: null, // camera MediaStream
  _scanLoop: null, // rAF handle for QR decode loop

  // ── Posted-QR deep links ───────────────────────────────────────────────────
  // Posted QR codes encode a full app URL (e.g. https://app/?qr=1:38,72) so a
  // citizen can scan them with their phone's NATIVE camera and land in the app
  // with their location already set — no in-app scanner needed. Set this to the
  // public deployment URL when generating QRs from a localhost dev session.
  deepLinkBase: null,

  /** Called whenever position changes: (row, col) => void */
  onPositionChange: null,
  /** Called when a scanned QR specifies a different floor: (floor) => void */
  onFloorChange: null,
  /** Called whenever the heading updates: (degrees) => void */
  onHeadingChange: null,
  /** Called when position lands on a stair cell: (row, col) => void */
  onStairCell: null,
};

// ── Init ──────────────────────────────────────────────────────────────────────

function navInit() {
  // Default starting tile until a QR scan or real-coordinate fix arrives:
  // just inside the MAIN public door on the Ground Floor (internal floor 1).
  //
  // That door is the bottom-centre opening. Row 74 carries four adjacent door
  // cells at cols 36-39 - the only doorway in the whole plan more than one cell
  // wide - flanked by single doors at 74,32 and 74,43, and approached by
  // entrance steps at rows 71-73, cols 29 and 46. Those stair cells exist on
  // the Ground floor and on no other floor, which is what an external flight up
  // to a lobby looks like. Cols 37-38 then run inward as a two-cell corridor.
  //
  // The Lobby / Information desk (down 60, across 37) confirms it: 20 m from
  // here, against 53 m from the old default at 38,71 - which was a single-cell
  // door on the EAST wall, i.e. a side entrance. Mean walk to the eight
  // Ground-floor offices is 37.3 m from here and was 58.6 m from there.
  //
  // The on-load QR prompt still nudges the citizen to scan for a precise fix.
  NAV.position = { row: 73, col: 37 };
}

// ── Deep-link / QR payload parsing ──────────────────────────────────────────

/**
 * Parse a location string into { floor, row, col } (internal 0-indexed floor).
 * Accepts every form a posted or in-app QR might carry:
 *   "GRID:1:38,72"                     in-app QR payload (new)
 *   "GRID:38,72"                       legacy payload (assumes floor 0)
 *   "https://app/?qr=1:38,72"          posted-QR deep link (native camera)
 *   "1:38,72"  /  "38,72"              bare manual entry
 * Returns null if it can't extract two coordinates + an optional floor.
 */
function navParseDeepLink(str) {
  if (!str) return null;
  let s = String(str).trim();

  // If it's a URL (or carries a query param), pull out qr/loc/at.
  const q = s.match(/[?&](?:qr|loc|at)=([^&#]+)/i);
  if (q) {
    try { s = decodeURIComponent(q[1]); } catch (_) { s = q[1]; }
  }

  s = s.replace(/^GRID:/i, "");

  let floor = 0,
    rest = s;
  if (s.includes(":")) {
    const i = s.indexOf(":");
    floor = parseInt(s.slice(0, i), 10);
    rest = s.slice(i + 1);
  }

  const parts = rest.split(",").map((x) => parseInt(x.trim(), 10));
  if (parts.length !== 2 || isNaN(parts[0]) || isNaN(parts[1]) || isNaN(floor))
    return null;
  return { floor, row: parts[0], col: parts[1] };
}

/** Build a posted-QR deep-link URL for a cell (native-camera scannable). */
function navBuildDeepLinkURL(floor, row, col) {
  let base = NAV.deepLinkBase || location.origin + location.pathname;
  base = base.replace(/[?#].*$/, ""); // strip any existing query/hash
  return `${base}?qr=${floor}:${row},${col}`;
}

// ── Position ──────────────────────────────────────────────────────────────────

/**
 * Move NAV to (row, col). Clamps to grid bounds, refuses wall cells.
 * Fires NAV.onPositionChange after updating.
 */
function navSetPosition(row, col) {
  row = Math.max(0, Math.min(GRID_ROWS - 1, row));
  col = Math.max(0, Math.min(GRID_COLS - 1, col));
  const id = nodeId(row, col);
  if (NODE_MAP[id] && NODE_MAP[id].wall) return;

  const prev = NAV.position;
  if (prev && (prev.row !== row || prev.col !== col)) {
    NAV._trail.push({ row: prev.row, col: prev.col });
    if (NAV._trail.length > 10) NAV._trail.shift();
  }

  NAV.position = { row, col };
  if (NAV.onPositionChange) NAV.onPositionChange(row, col);

  // Stair detection: fire callback when user lands on a stair cell
  const nd = NODE_MAP[nodeId(row, col)];
  if (nd && nd.cellType === "stair" && NAV.onStairCell)
    NAV.onStairCell(row, col);
}

// ── PDR ───────────────────────────────────────────────────────────────────────

/**
 * Start PDR.
 * Compass (heading, α = 0.4) starts non-blocking; steps are suppressed until
 * the first heading reading arrives (A3 — avoids North-biased early steps).
 * DeviceMotion permission requested on iOS 13+.
 */
/**
 * Ask for motion access. MUST be called straight from a tap handler on iOS:
 * requestPermission() needs transient user activation and rejects without it.
 *
 * Idempotent and silent. Once iOS has granted the origin, later calls resolve
 * immediately with no dialog, so calling it on every gesture costs nothing.
 * Platforms without the permission API (Android, desktop) resolve true.
 */
function navRequestMotionPermission() {
  if (NAV._motionGranted === true) return Promise.resolve(true);
  if (typeof DeviceMotionEvent === "undefined") {
    NAV._motionGranted = false;
    return Promise.resolve(false);
  }
  if (typeof DeviceMotionEvent.requestPermission !== "function") {
    NAV._motionGranted = true;          // no gate on this platform
    return Promise.resolve(true);
  }
  return DeviceMotionEvent.requestPermission()
    .then((state) => {
      NAV._motionGranted = state === "granted";
      return NAV._motionGranted;
    })
    .catch(() => {
      // Thrown when there is no user activation. Leave the state unknown so a
      // later, properly-gestured tap can still succeed.
      return false;
    });
}

/** True when motion can be bound right now without asking for anything. */
function navMotionReady() {
  if (typeof DeviceMotionEvent === "undefined") return false;
  if (typeof DeviceMotionEvent.requestPermission !== "function") return true;
  return NAV._motionGranted === true;
}

function navStartPDR() {
  if (NAV.pdrActive) return true;
  if (typeof DeviceMotionEvent === "undefined") return false;

  // F3-lite: arm auto-alignment — the very next compass reading captures
  // "forward" as the direction the phone is currently pointing, so the
  // user's walking direction matches their facing direction regardless of
  // what the magnetometer thinks True North is.
  NAV._autoAlignPending = true;

  // Start compass — Fix 1 (Adaptive EMA, replaces fixed α=0.4 from B1).
  //   Per Shi et al. (2025, IEEE TIM) — α now varies per sample with the
  //   turn rate: heavy smoothing when the user is still (kills magnetometer
  //   wobble indoors), responsive smoothing during active turns (kills lag).
  //   The legacy fixed `alphaEMA: 0.4` is retained as the fallback when
  //   adaptive bounds aren't provided.
  if (typeof Compass !== "undefined") {
    if (NAV._compass) NAV._compass.stop();
    NAV._compass = new Compass({
      onHeading: (h) => {
        NAV.heading = h;
        NAV._compassReady = true; // A3: unblock step detection on first reading
        // F3-lite: lock "forward" to the very first compass reading after
        // PDR was started (the direction the user was pointing). All
        // subsequent step directions are computed relative to this anchor.
        if (NAV._autoAlignPending) {
          NAV.headingOffset = h;
          NAV._autoAlignPending = false;
          if (NAV.onAlignChange) NAV.onAlignChange(h);
        }
        if (NAV.onHeadingChange) NAV.onHeadingChange(h);
      },
      onError: (msg) => console.warn("[NAV Compass]", msg),
      alphaEMA:      0.4,   // fallback if adaptive disabled
      alphaMin:      0.05,  // heavy smoothing when stationary (suppress wobble)
      alphaMax:      0.80,  // responsive during active turns (reduce lag)
      turnThreshold: 20,    // degrees — |delta| at which alpha saturates
    });
    NAV._compass.requestAndStart().catch(() => {});
  }

  const _bindMotion = () => {
    // Fresh filter state each time PDR starts; the threshold carries over.
    NAV._lp = null;
    NAV._mean = null;
    NAV._lastSample = 0;
    NAV._prevSign = 0;
    NAV._cyclePeak = 0;
    NAV._lastCandidate = 0;
    NAV._lastStepTime = 0;
    NAV._pending = 0;
    NAV._walking = false;
    NAV.pdrActive = true;
    window.addEventListener("devicemotion", _navOnMotion);
  };

  // Never ask from here: navStartPDR is reached from the QR decode callback,
  // where iOS has no activation left and the request is refused outright. The
  // grant is collected by navRequestMotionPermission() in the tap handlers; if
  // it is not held, report failure and let the caller offer a tap-to-enable
  // button rather than firing an alert the citizen can do nothing about.
  if (!navMotionReady()) return false;

  _bindMotion();
  if (NAV.onPositionChange) NAV.onPositionChange(NAV.position.row, NAV.position.col);
  return true;
}

function navStopPDR() {
  if (!NAV.pdrActive) return;
  NAV.pdrActive = false;
  NAV._compassReady = false;
  if (NAV._compass) {
    NAV._compass.stop();
    NAV._compass = null;
  }
  window.removeEventListener("devicemotion", _navOnMotion);
}

/**
 * Reset the adaptive step-detection baseline to the literature default.
 * No calibration walk required — one tap from the ⟳ Recal button.
 */
function navRecalibrate() {
  NAV._threshold = STEP_TUNING.baseThreshold;
  NAV._peaks = [];
  NAV._lp = null;
  NAV._mean = null;
  NAV._lastSample = 0;
  NAV._prevSign = 0;
  NAV._cyclePeak = 0;
  NAV._lastCandidate = 0;
  NAV._lastStepTime = 0;
  NAV._pending = 0;
  NAV._pendingPeak = 0;
  NAV._walking = false;
}

// ── Step detection — zero-crossing (Jiménez et al., 2010) ─────────────────────

// Tuned against tools/test_step_detector.js (simulated 60 Hz hand-held,
// pocket, standing and tugging signals). Thresholds are the swing of the
// filtered |a| above its mean, in m/s².
const STEP_TUNING = Object.freeze({
  baseThreshold: 0.32, // where every walk starts: low enough for a gentle hand-held step,
                       // high enough that a very shaky hand standing still adds none
  maxThreshold:  1.0,  // the most the threshold can climb, however hard the steps
  adaptRatio:    0.5,  // threshold = this x the median of the recent step peaks
  adaptSteps:    8,    // how many recent steps that median covers
  smoothMs:      50,   // low-pass time constant (about 3 Hz): steps pass, tremor does not
  meanMs:        1000, // the mean the swing is measured from: longer than a stride
  minStepMs:     280,  // no two steps closer than this (about 3.5 steps a second)
  maxStepMs:     1300, // a stride longer than this means walking has stopped
});

/**
 * Zero-crossing step detector.
 *
 * A step fires when the acceleration magnitude (centred around its windowed
 * mean) completes a positive half-cycle with amplitude > _threshold, detected
 * at the moment the signal crosses back below the mean (negative zero-crossing).
 *
 * This is more robust to phone position than pure peak-threshold (Kim et al.,
 * 2004) because it only requires the relative oscillation shape, not absolute
 * magnitude.  Jiménez et al. (2010) show this outperforms peak detection across
 * hand, chest, and thigh positions.  Brajdic & Harle (2013) confirm on 26
 * subjects with unconstrained smartphones (+8–12% accuracy vs peak detection).
 */
function _navOnMotion(e) {
  const acc = e.accelerationIncludingGravity || e.acceleration;
  if (!acc || acc.x == null) return;
  const T = STEP_TUNING;

  const mag = Math.sqrt(acc.x ** 2 + acc.y ** 2 + acc.z ** 2);
  const now = Date.now();
  const dt = NAV._lastSample ? Math.min(100, Math.max(1, now - NAV._lastSample)) : 16;
  NAV._lastSample = now;

  // Low-pass the magnitude (removes hand tremor and sensor noise above the
  // step band), and centre it on a slow mean so a held phone's small swing is
  // measured against gravity rather than against itself.
  if (NAV._lp === null) { NAV._lp = mag; NAV._mean = mag; }
  NAV._lp   += (1 - Math.exp(-dt / T.smoothMs)) * (mag - NAV._lp);
  NAV._mean += (1 - Math.exp(-dt / T.meanMs))   * (mag - NAV._mean);

  const centered = NAV._lp - NAV._mean;
  const sign = centered >= 0 ? 1 : -1;
  if (sign === 1) NAV._cyclePeak = Math.max(NAV._cyclePeak, centered);

  // Walking stopped: forget how hard the last steps were, so the threshold
  // starts low again. Otherwise tugging would teach it to need tugs.
  if (NAV._walking && now - NAV._lastStepTime > T.maxStepMs) {
    NAV._walking = false;
    NAV._peaks = [];
    NAV._threshold = T.baseThreshold;
  }
  if (NAV._pending && now - NAV._pending > T.maxStepMs) NAV._pending = 0;

  // A candidate step: the positive half-cycle just ended (negative zero
  // crossing), it was tall enough, and it is not the tail of the last one.
  if (NAV._prevSign === 1 && sign === -1 &&
      NAV._cyclePeak > NAV._threshold &&
      now - NAV._lastCandidate >= T.minStepMs) {
    NAV._lastCandidate = now;
    const peak = NAV._cyclePeak;

    if (NAV._walking) {
      _navCountSteps(1, now, [peak]);
    } else if (NAV._pending) {
      // Second step at a walking pace: it was a walk after all. Count both.
      NAV._walking = true;
      _navCountSteps(2, now, [NAV._pendingPeak, peak]);
      NAV._pending = 0;
    } else {
      // A lone bump (lifting the phone, a tug) is not a step until another
      // follows within a stride.
      NAV._pending = now;
      NAV._pendingPeak = peak;
    }
  }

  if (NAV._prevSign === -1 && sign === 1) NAV._cyclePeak = 0;
  NAV._prevSign = sign;
}

/** Count n steps and let the threshold follow how hard they were. */
function _navCountSteps(n, now, peaks) {
  const T = STEP_TUNING;
  NAV._lastStepTime = now;
  NAV._peaks.push(...peaks);
  while (NAV._peaks.length > T.adaptSteps) NAV._peaks.shift();
  const sorted = NAV._peaks.slice().sort((a, b) => a - b);
  const median = sorted[Math.floor(sorted.length / 2)];
  NAV._threshold = Math.min(T.maxThreshold,
                            Math.max(T.baseThreshold, median * T.adaptRatio));
  for (let i = 0; i < n; i++) _navStep();
}

function _navStep() {
  // A3: suppress steps until the compass has delivered at least one heading
  if (!NAV._compassReady) return;

  const { row, col } = NAV.position;
  // F3-lite: use heading RELATIVE to the alignment anchor, so step direction
  // tracks the user's facing direction rather than absolute compass "North".
  const h = (NAV.heading - NAV.headingOffset + 360) % 360;

  // Map relative heading to grid direction (each quadrant = 90°).
  // 0°    = forward = up on the grid (matches what user was facing at alignment)
  // 90°   = right
  // 180°  = back
  // 270°  = left
  let dr = 0,
    dc = 0;
  if (h < 45 || h >= 315)
    dr = -1; // forward → row up
  else if (h < 135)
    dc = 1; // right → col right
  else if (h < 225)
    dr = 1; // back → row down
  else dc = -1; // left → col left

  NAV._stepsSinceQR++;
  navSetPosition(row + dr, col + dc);
}

/**
 * Re-align "forward" to the direction the phone is currently pointing.
 * Returns true if the alignment was captured immediately (compass ready),
 * or false if it's deferred until the next compass reading.
 */
function navAlignForward() {
  if (NAV._compassReady) {
    NAV.headingOffset = NAV.heading;
    if (NAV.onAlignChange) NAV.onAlignChange(NAV.heading);
    return true;
  }
  // No compass reading yet — arm auto-align for the next one.
  NAV._autoAlignPending = true;
  return false;
}

// ── QR scanning ───────────────────────────────────────────────────────────────

/**
 * Open camera and scan frames for QR codes.
 * Decodes "GRID:floor:row,col" (new) and "GRID:row,col" (legacy, floor 0).
 */
async function navStartQRScan(videoEl, canvasEl, onFound) {
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    const input = prompt(
      "Camera needs HTTPS.\nEnter cell as  row,col  (e.g. 5,10) to jump manually:",
    );
    if (input) {
      const parts = input
        .replace(/^GRID:\d+:/, "")
        .replace(/^GRID:/, "")
        .split(",")
        .map((s) => parseInt(s.trim(), 10));
      if (parts.length === 2 && !isNaN(parts[0]) && !isNaN(parts[1])) {
        onFound(parts[0], parts[1]);
      } else {
        alert("Invalid format. Use  row,col  e.g. 5,10");
      }
    }
    return;
  }
  try {
    NAV._stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: { ideal: "environment" }, width: { ideal: 640 } },
    });
    videoEl.srcObject = NAV._stream;
    await new Promise((res) => {
      videoEl.onloadedmetadata = res;
      setTimeout(res, 2000);
    });
    await videoEl.play().catch(() => {});
    _navQRLoop(videoEl, canvasEl, onFound);
  } catch (err) {
    const input = prompt(
      "Camera unavailable (" +
        err.message +
        ").\nEnter cell as  row,col  to jump manually:",
    );
    if (input) {
      const parts = input.split(",").map((s) => parseInt(s.trim(), 10));
      if (parts.length === 2 && !isNaN(parts[0]) && !isNaN(parts[1])) {
        onFound(parts[0], parts[1]);
      }
    }
  }
}

function _navQRLoop(videoEl, canvasEl, onFound) {
  if (!NAV._stream) return;

  if (videoEl.readyState >= 2 && videoEl.videoWidth > 0) {
    canvasEl.width = videoEl.videoWidth;
    canvasEl.height = videoEl.videoHeight;
    const ctx = canvasEl.getContext("2d");
    ctx.drawImage(videoEl, 0, 0);

    if (typeof jsQR !== "undefined") {
      const img = ctx.getImageData(0, 0, canvasEl.width, canvasEl.height);
      const code = jsQR(img.data, img.width, img.height, {
        inversionAttempts: "dontInvert",
      });

      // Accept both the in-app "GRID:floor:row,col" payload and a posted-QR
      // deep-link URL ("https://app/?qr=floor:row,col"); navParseDeepLink
      // returns null for any unrelated QR so we ignore those.
      if (code) {
        const loc = navParseDeepLink(code.data);
        if (loc) {
          navStopQRScan();
          if (loc.floor !== NAV._currentFloor && NAV.onFloorChange)
            NAV.onFloorChange(loc.floor);
          navSetPosition(loc.row, loc.col);
          NAV._hasQRFix = true; // A2: first real fix recorded
          if (onFound) onFound(loc.row, loc.col);
          return;
        }
      }
    }
  }

  NAV._scanLoop = requestAnimationFrame(() =>
    _navQRLoop(videoEl, canvasEl, onFound),
  );
}

function navStopQRScan() {
  if (NAV._scanLoop) {
    cancelAnimationFrame(NAV._scanLoop);
    NAV._scanLoop = null;
  }
  if (NAV._stream) {
    NAV._stream.getTracks().forEach((t) => t.stop());
    NAV._stream = null;
  }
}

// ── QR generation ─────────────────────────────────────────────────────────────

/**
 * Render a QR code for a grid cell onto targetDiv.
 * By default encodes a posted-QR deep-link URL ("https://app/?qr=floor:row,col")
 * so it works with a phone's native camera; pass {format:'grid'} for the legacy
 * "GRID:floor:row,col" payload (in-app scanner only).
 */
function navGenerateQR(floor, row, col, targetDiv, opts) {
  opts = opts || {};
  const text =
    opts.format === "grid"
      ? `GRID:${floor}:${row},${col}`
      : navBuildDeepLinkURL(floor, row, col);
  targetDiv.innerHTML = "";
  if (typeof QRCode !== "undefined") {
    new QRCode(targetDiv, {
      text,
      width: 200,
      height: 200,
      colorDark: "#000000",
      colorLight: "#ffffff",
      correctLevel: QRCode.CorrectLevel.M,
    });
  } else {
    targetDiv.textContent = "QR library not loaded";
  }
}

'use strict';

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
 *   Initial threshold: 1.2 m/s² above mean; adapts silently every 20 steps.
 *
 * Steps are suppressed until the compass delivers its first heading reading to
 *   avoid North-biased initial steps (Harle, 2013 §IV-B).
 *
 * On devices without motion sensors: use arrow keys or D-pad (wired in app.js).
 */

const NAV = {
  active:         false,
  position:       null,    // { row, col } — set by navInit()
  pdrActive:      false,
  heading:        0,       // degrees from North (0=N, 90=E, 180=S, 270=W)

  // ── Compass ──────────────────────────────────────────────────────────────
  _compass:       null,    // Compass instance (compass.js)
  _compassReady:  false,   // true once first heading reading arrives (A3)

  // ── Step detection (zero-crossing, Jiménez et al. 2010) ──────────────────
  _threshold:     1.2,     // m/s² above mean — initial value; adapts after 20 steps
  _debounce:      400,     // ms — minimum time between detected steps
  _adaptBuf:      [],      // half-cycle amplitudes of last 20 steps (recalibration)
  _lastStepTime:  0,
  _stepBuffer:    [],      // sliding window of raw magnitudes (~300 ms @ 50 Hz)
  _prevSign:      0,       // sign of (mag − mean) from previous sample: +1 or -1
  _cyclePeak:     0,       // peak (mag − mean) of the current positive half-cycle

  // ── Drift / fix tracking ──────────────────────────────────────────────────
  _stepsSinceQR:  0,       // steps taken since last QR fix
  _hasQRFix:      false,   // stays false until the first QR scan (A2)

  // ── Floor ─────────────────────────────────────────────────────────────────
  _currentFloor:  0,       // kept in sync with STATE.currentFloor by app.js

  // ── Miscellaneous ─────────────────────────────────────────────────────────
  metresPerCell:  1.0,     // set once via physical measurement before evaluation (B3)
  _trail:         [],      // breadcrumb history of recent positions (last 10)
  _stream:        null,    // camera MediaStream
  _scanLoop:      null,    // rAF handle for QR decode loop

  /** Called whenever position changes: (row, col) => void */
  onPositionChange: null,
  /** Called when a scanned QR specifies a different floor: (floor) => void */
  onFloorChange:    null,
  /** Called whenever the heading updates: (degrees) => void */
  onHeadingChange:  null,
  /** Called when position lands on a stair cell: (row, col) => void */
  onStairCell:      null,
};

// ── Init ──────────────────────────────────────────────────────────────────────

function navInit() {
  NAV.position = {
    row: Math.floor(GRID_ROWS / 2),
    col: Math.floor(GRID_COLS / 2),
  };
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
  if (nd && nd.cellType === 'stair' && NAV.onStairCell) NAV.onStairCell(row, col);
}

// ── PDR ───────────────────────────────────────────────────────────────────────

/**
 * Start PDR.
 * Compass (heading, α = 0.4) starts non-blocking; steps are suppressed until
 * the first heading reading arrives (A3 — avoids North-biased early steps).
 * DeviceMotion permission requested on iOS 13+.
 */
function navStartPDR() {
  if (NAV.pdrActive) return true;
  if (typeof DeviceMotionEvent === 'undefined') {
    alert('DeviceMotionEvent is not supported in this browser.\nUse arrow keys or D-pad to move instead.');
    return false;
  }

  // Start compass — α = 0.4 for faster turn response (Harle, 2013)
  if (typeof Compass !== 'undefined') {
    if (NAV._compass) NAV._compass.stop();
    NAV._compass = new Compass({
      onHeading: h => {
        NAV.heading       = h;
        NAV._compassReady = true;   // A3: unblock step detection on first reading
        if (NAV.onHeadingChange) NAV.onHeadingChange(h);
      },
      onError: msg => console.warn('[NAV Compass]', msg),
      alphaEMA: 0.4,               // B1: faster turn response vs default 0.25
    });
    NAV._compass.requestAndStart().catch(() => {});
  }

  const _bindMotion = () => {
    NAV._lastStepTime = 0;
    NAV._stepBuffer   = [];
    NAV._prevSign     = 0;
    NAV._cyclePeak    = 0;
    NAV.pdrActive     = true;
    window.addEventListener('devicemotion', _navOnMotion);
  };

  if (typeof DeviceMotionEvent.requestPermission === 'function') {
    DeviceMotionEvent.requestPermission()
      .then(state => {
        if (state === 'granted') {
          _bindMotion();
          if (NAV.onPositionChange) NAV.onPositionChange(NAV.position.row, NAV.position.col);
        } else {
          alert('Motion access denied.\n\nTo fix on iOS: Settings → Safari → Motion & Orientation Access → ON.\n\nUse the D-pad or arrow keys to move instead.');
        }
      })
      .catch(() => alert('Could not request motion permission.'));
    return false;
  }

  _bindMotion();
  return true;
}

function navStopPDR() {
  if (!NAV.pdrActive) return;
  NAV.pdrActive     = false;
  NAV._compassReady = false;
  if (NAV._compass) { NAV._compass.stop(); NAV._compass = null; }
  window.removeEventListener('devicemotion', _navOnMotion);
}

/**
 * Reset the adaptive step-detection baseline to the literature default.
 * No calibration walk required — one tap from the ⟳ Recal button.
 */
function navRecalibrate() {
  NAV._adaptBuf  = [];
  NAV._threshold = 1.2;   // initial zero-crossing amplitude threshold
  NAV._debounce  = 400;
  NAV._prevSign  = 0;
  NAV._cyclePeak = 0;
}

// ── Step detection — zero-crossing (Jiménez et al., 2010) ─────────────────────

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

  const mag = Math.sqrt(acc.x ** 2 + acc.y ** 2 + acc.z ** 2);
  const now = Date.now();

  // Sliding window — mean of ~300 ms of samples at ~50 Hz
  NAV._stepBuffer.push(mag);
  if (NAV._stepBuffer.length > 15) NAV._stepBuffer.shift();
  const mean = NAV._stepBuffer.reduce((a, b) => a + b, 0) / NAV._stepBuffer.length;

  const centered = mag - mean;
  const sign     = centered >= 0 ? 1 : -1;

  // Track peak of the current positive half-cycle
  if (sign === 1) NAV._cyclePeak = Math.max(NAV._cyclePeak, centered);

  // Step fires at negative zero crossing (positive → negative),
  // gated by amplitude of the just-completed positive half-cycle
  if (NAV._prevSign === 1 && sign === -1
      && NAV._cyclePeak > NAV._threshold
      && now - NAV._lastStepTime > NAV._debounce) {

    NAV._lastStepTime = now;

    // Silent re-calibration: threshold = 85 % of mean cycle amplitude
    NAV._adaptBuf.push(NAV._cyclePeak);
    if (NAV._adaptBuf.length > 20) NAV._adaptBuf.shift();
    if (NAV._adaptBuf.length === 20) {
      const adaptMean = NAV._adaptBuf.reduce((a, b) => a + b, 0) / 20;
      NAV._threshold  = Math.max(0.5, adaptMean * 0.85);
    }

    NAV._cyclePeak = 0;
    _navStep();
  }

  // Reset peak accumulator at the start of each new positive half-cycle
  if (NAV._prevSign === -1 && sign === 1) NAV._cyclePeak = 0;

  NAV._prevSign = sign;
}

function _navStep() {
  // A3: suppress steps until the compass has delivered at least one heading
  if (!NAV._compassReady) return;

  const { row, col } = NAV.position;
  const h = NAV.heading;

  // Map heading to cardinal direction (each quadrant = 90°)
  let dr = 0, dc = 0;
  if      (h <  45 || h >= 315) dr = -1;   // N → row up
  else if (h <  135)             dc =  1;   // E → col right
  else if (h <  225)             dr =  1;   // S → row down
  else                           dc = -1;   // W → col left

  NAV._stepsSinceQR++;
  navSetPosition(row + dr, col + dc);
}

// ── QR scanning ───────────────────────────────────────────────────────────────

/**
 * Open camera and scan frames for QR codes.
 * Decodes "GRID:floor:row,col" (new) and "GRID:row,col" (legacy, floor 0).
 */
async function navStartQRScan(videoEl, canvasEl, onFound) {
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    const input = prompt(
      'Camera needs HTTPS.\nEnter cell as  row,col  (e.g. 5,10) to jump manually:'
    );
    if (input) {
      const parts = input.replace(/^GRID:\d+:/, '').replace(/^GRID:/, '')
        .split(',').map(s => parseInt(s.trim(), 10));
      if (parts.length === 2 && !isNaN(parts[0]) && !isNaN(parts[1])) {
        onFound(parts[0], parts[1]);
      } else {
        alert('Invalid format. Use  row,col  e.g. 5,10');
      }
    }
    return;
  }
  try {
    NAV._stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: { ideal: 'environment' }, width: { ideal: 640 } },
    });
    videoEl.srcObject = NAV._stream;
    await new Promise(res => { videoEl.onloadedmetadata = res; setTimeout(res, 2000); });
    await videoEl.play().catch(() => {});
    _navQRLoop(videoEl, canvasEl, onFound);
  } catch (err) {
    const input = prompt(
      'Camera unavailable (' + err.message + ').\nEnter cell as  row,col  to jump manually:'
    );
    if (input) {
      const parts = input.split(',').map(s => parseInt(s.trim(), 10));
      if (parts.length === 2 && !isNaN(parts[0]) && !isNaN(parts[1])) {
        onFound(parts[0], parts[1]);
      }
    }
  }
}

function _navQRLoop(videoEl, canvasEl, onFound) {
  if (!NAV._stream) return;

  if (videoEl.readyState >= 2 && videoEl.videoWidth > 0) {
    canvasEl.width  = videoEl.videoWidth;
    canvasEl.height = videoEl.videoHeight;
    const ctx = canvasEl.getContext('2d');
    ctx.drawImage(videoEl, 0, 0);

    if (typeof jsQR !== 'undefined') {
      const img  = ctx.getImageData(0, 0, canvasEl.width, canvasEl.height);
      const code = jsQR(img.data, img.width, img.height, { inversionAttempts: 'dontInvert' });

      if (code && code.data.startsWith('GRID:')) {
        const payload = code.data.slice(5);
        let floor = 0, r, c;

        if (payload.includes(':')) {
          // New format: GRID:floor:row,col
          const colonIdx = payload.indexOf(':');
          floor = parseInt(payload.slice(0, colonIdx));
          const parts = payload.slice(colonIdx + 1).split(',');
          r = parseInt(parts[0]);
          c = parseInt(parts[1]);
        } else {
          // Legacy format: GRID:row,col
          const parts = payload.split(',');
          r = parseInt(parts[0]);
          c = parseInt(parts[1]);
        }

        if (!isNaN(r) && !isNaN(c) && !isNaN(floor)) {
          navStopQRScan();
          if (floor !== NAV._currentFloor && NAV.onFloorChange) NAV.onFloorChange(floor);
          navSetPosition(r, c);
          NAV._hasQRFix = true;    // A2: first real fix recorded
          if (onFound) onFound(r, c);
          return;
        }
      }
    }
  }

  NAV._scanLoop = requestAnimationFrame(() => _navQRLoop(videoEl, canvasEl, onFound));
}

function navStopQRScan() {
  if (NAV._scanLoop) { cancelAnimationFrame(NAV._scanLoop); NAV._scanLoop = null; }
  if (NAV._stream)   { NAV._stream.getTracks().forEach(t => t.stop()); NAV._stream = null; }
}

// ── QR generation ─────────────────────────────────────────────────────────────

/**
 * Render a QR code for a grid cell onto targetDiv.
 * Encodes "GRID:floor:row,col" — same format scanned above.
 */
function navGenerateQR(floor, row, col, targetDiv) {
  const text = `GRID:${floor}:${row},${col}`;
  targetDiv.innerHTML = '';
  if (typeof QRCode !== 'undefined') {
    new QRCode(targetDiv, {
      text,
      width: 200, height: 200,
      colorDark: '#000000', colorLight: '#ffffff',
      correctLevel: QRCode.CorrectLevel.M,
    });
  } else {
    targetDiv.textContent = 'QR library not loaded';
  }
}

/**
 * compass.js — Device orientation / compass heading module
 *
 * Handles W3C DeviceOrientationEvent, iOS permission gate,
 * cross-platform alpha normalisation, and EMA smoothing.
 *
 * Outputs a normalised heading H ∈ [0, 360) degrees from North.
 */

'use strict';

class Compass {
  /**
   * @param {object}  opts
   * @param {Function} opts.onHeading        - (degrees) => void  (smoothed heading callback)
   * @param {Function} opts.onError          - (msg) => void
   * @param {Function} opts.onUnsupported    - () => void
   * @param {number}   opts.alphaEMA         - Fixed EMA factor (legacy / fallback when adaptive is disabled).
   *
   * Adaptive EMA (Fix 1 — PDR heading improvement, layered with Madgwick fusion later).
   *   Backed by Shi et al. (2025) "Adaptive Heading Estimation Method for Pedestrian Dead
   *   Reckoning With Magnetic Interference" (IEEE TIM) and Cheng et al. (2025) — alpha
   *   varies per sample with the magnitude of the heading delta:
   *     - Large delta (user actively turning) → high alpha → responsive (less lag)
   *     - Small delta (user stationary / walking straight) → low alpha → smooth (less wobble)
   *   When `alphaMin` and `alphaMax` are both provided, adaptive mode is enabled and
   *   `alphaEMA` is used only as a fallback if either bound is missing.
   *
   * @param {number}   opts.alphaMin         - EMA factor at zero angular velocity (heavy smoothing). Typical: 0.05.
   * @param {number}   opts.alphaMax         - EMA factor once |delta| >= turnThreshold (responsive). Typical: 0.80.
   * @param {number}   opts.turnThreshold    - Degrees of |delta| at which alpha saturates to alphaMax. Typical: 20.
   */
  constructor({
    onHeading, onError, onUnsupported,
    alphaEMA = 0.25,
    alphaMin = null, alphaMax = null, turnThreshold = 20,
  } = {}) {
    this._onHeading     = onHeading     || (() => {});
    this._onError       = onError       || (() => {});
    this._onUnsupported = onUnsupported || (() => {});
    this._alphaEMA      = alphaEMA;
    this._alphaMin      = alphaMin;        // null → adaptive disabled
    this._alphaMax      = alphaMax;        // null → adaptive disabled
    this._turnThreshold = turnThreshold;
    this._adaptive      = (alphaMin !== null) && (alphaMax !== null);
    this._smoothed      = null;   // smoothed heading (degrees)
    this._lastAlpha     = null;   // last alpha used (exposed for diagnostics)
    this._active        = false;
    this._handler       = null;
  }

  // ── Feature detection ───────────────────────────────────────────────────────
  static isSupported() {
    return 'DeviceOrientationEvent' in window;
  }

  // ── Permission + listener setup ─────────────────────────────────────────────
  /**
   * Must be called from a user-gesture handler (button tap).
   * Returns a Promise that resolves to 'granted' | 'denied' | 'unavailable'.
   */
  async requestAndStart() {
    if (!Compass.isSupported()) {
      this._onUnsupported();
      return 'unavailable';
    }

    // iOS 13+ requires explicit permission
    if (typeof DeviceOrientationEvent.requestPermission === 'function') {
      let permission;
      try {
        permission = await DeviceOrientationEvent.requestPermission();
      } catch (err) {
        this._onError('Permission request failed: ' + err.message);
        return 'denied';
      }
      if (permission !== 'granted') {
        this._onError('Compass permission denied. Enable in iOS Settings → Safari → Motion & Orientation.');
        return 'denied';
      }
    }

    this._attach();
    return 'granted';
  }

  stop() {
    if (this._handler) {
      window.removeEventListener('deviceorientation', this._handler);
      this._handler = null;
    }
    this._active  = false;
    this._smoothed = null;
  }

  // ── Internal ────────────────────────────────────────────────────────────────
  _attach() {
    this._handler = (e) => this._handleEvent(e);
    window.addEventListener('deviceorientation', this._handler, true);
    this._active = true;
  }

  _handleEvent(e) {
    const raw = this._normaliseHeading(e);
    if (raw === null) return;

    // EMA smoothing with circular-mean fix near 0°/360° boundary
    if (this._smoothed === null) {
      this._smoothed = raw;
      this._lastAlpha = this._adaptive ? this._alphaMin : this._alphaEMA;
    } else {
      let diff = raw - this._smoothed;
      if (diff >  180) diff -= 360;
      if (diff < -180) diff += 360;

      // Fix 1 — Adaptive EMA: scale alpha by the turn rate so smoothing is heavy
      //   at rest (kills wobble) and light during active turns (kills lag).
      let alpha;
      if (this._adaptive) {
        const t = Math.min(1, Math.abs(diff) / this._turnThreshold);
        alpha = this._alphaMin + t * (this._alphaMax - this._alphaMin);
      } else {
        alpha = this._alphaEMA;   // legacy fixed-alpha path
      }
      this._lastAlpha = alpha;

      this._smoothed = (this._smoothed + alpha * diff + 360) % 360;
    }

    this._onHeading(this._smoothed);
  }

  /**
   * Cross-platform normalisation.
   * Returns heading in [0, 360) degrees from North, or null if unreliable.
   */
  _normaliseHeading(e) {
    // iOS Safari: webkitCompassHeading is degrees clockwise from true North
    if (typeof e.webkitCompassHeading === 'number' && !isNaN(e.webkitCompassHeading)) {
      return (e.webkitCompassHeading + 360) % 360;
    }

    // Android Chrome with absolute=true: alpha is 0=North, increases CCW
    //   → invert to get CW-from-North
    if (e.absolute === true && typeof e.alpha === 'number' && !isNaN(e.alpha)) {
      return (360 - e.alpha) % 360;
    }

    // Fallback relative alpha (less reliable, no true-North reference)
    if (typeof e.alpha === 'number' && !isNaN(e.alpha)) {
      return (360 - e.alpha) % 360;
    }

    return null;
  }

  // ── Heading to canvas direction vector ──────────────────────────────────────
  /**
   * Converts a heading in degrees to a unit vector in canvas space.
   * Canvas Y increases downward, so North points UP (negative Y).
   *
   * @param {number} heading - degrees from North, clockwise
   * @returns {{ dx: number, dy: number }}
   */
  static headingToVector(heading) {
    const rad = (heading * Math.PI) / 180;
    return { dx: Math.sin(rad), dy: -Math.cos(rad) };
  }
}

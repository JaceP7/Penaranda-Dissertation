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
  constructor({ onHeading, onError, onUnsupported, alphaEMA = 0.25 } = {}) {
    this._onHeading     = onHeading     || (() => {});
    this._onError       = onError       || (() => {});
    this._onUnsupported = onUnsupported || (() => {});
    this._alphaEMA      = alphaEMA;
    this._smoothed      = null;   // smoothed heading (degrees)
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
    } else {
      let diff = raw - this._smoothed;
      if (diff >  180) diff -= 360;
      if (diff < -180) diff += 360;
      this._smoothed = (this._smoothed + this._alphaEMA * diff + 360) % 360;
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

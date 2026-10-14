/**
 * test_motion_permission.js - the iOS motion-permission gate.
 *
 * iOS only honours DeviceMotionEvent.requestPermission() while a user gesture
 * is still "active". The scan path had no activation left by the time it asked:
 *
 *   "Scan" tap -> getUserMedia (await) -> _navQRLoop (rAF) -> onFound
 *     -> _resumePendingNav -> navigateToDepartment -> _ensurePdrOn
 *     -> navStartPDR -> requestPermission()  ->  NotAllowedError
 *
 * so motion was never permitted after a scan, while Skip (synchronous in the
 * tap) and the ?qr= deep link (routed from a "Take me there" tap) both worked.
 *
 * This runs the real nav.js functions against a fake DeviceMotionEvent that
 * enforces the activation rule, and drives the actual sequence of events. The
 * decode-callback case is asserted to FAIL to ask and to SUCCEED anyway,
 * because the grant was taken in the tap beforehand - which is the fix.
 *
 * It also cross-references app.js and index.html, since the gate is only as
 * good as the handlers that call it.
 *
 * Run: node tools/test_motion_permission.js <repo-root>
 */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = process.argv[2] || '.';
let pass = 0, fail = 0;
const ok = (name, cond, extra) => {
  if (cond) { pass++; console.log('  PASS  ' + name); }
  else { fail++; console.log('  FAIL  ' + name + (extra !== undefined ? '  -> ' + extra : '')); }
};

const navSrc = fs.readFileSync(path.resolve(ROOT, 'wayfinding-app/js/nav.js'), 'utf8');
const appSrc = fs.readFileSync(path.resolve(ROOT, 'wayfinding-app/js/app.js'), 'utf8');
const html   = fs.readFileSync(path.resolve(ROOT, 'wayfinding-app/index.html'), 'utf8');

function lift(src, name) {
  const i = src.indexOf(`function ${name}(`);
  if (i < 0) throw new Error(`cannot find ${name}`);
  let depth = 0, k = src.indexOf('{', i);
  for (; k < src.length; k++) {
    if (src[k] === '{') depth++;
    else if (src[k] === '}') { depth--; if (depth === 0) break; }
  }
  return src.slice(i, k + 1);
}

/**
 * Build a sandbox that behaves like Safari on iOS 13+: requestPermission()
 * resolves only while `activation` is true, and otherwise rejects exactly the
 * way the real thing does when the gesture has expired.
 */
function iosSandbox(opts) {
  opts = opts || {};
  const env = {
    activation: false,          // flipped on inside a "tap"
    asked: 0,                   // how many times the dialog was reached
    refusedForActivation: 0,    // times iOS rejected for lack of a gesture
    bound: [],
  };
  const sb = {
    console,
    NAV: {
      pdrActive: false,
      _motionGranted: null,
      position: { row: 73, col: 37 },
      onPositionChange: null,
      _compass: null,
    },
    window: { addEventListener: (ev) => env.bound.push(ev) },
    _navOnMotion: function () {},
    DeviceMotionEvent: function () {},
    env,
  };
  sb.DeviceMotionEvent.requestPermission = function () {
    if (!env.activation) {
      env.refusedForActivation++;
      return Promise.reject(new Error(
        "NotAllowedError: requires transient activation"));
    }
    env.asked++;
    return Promise.resolve(opts.answer || 'granted');
  };
  if (opts.noPermissionApi) delete sb.DeviceMotionEvent.requestPermission;
  vm.createContext(sb);
  vm.runInContext(
    [lift(navSrc, 'navRequestMotionPermission'),
     lift(navSrc, 'navMotionReady'),
     lift(navSrc, 'navStartPDR')].join('\n') +
    '\n;this.API = { navRequestMotionPermission, navMotionReady, navStartPDR };', sb);
  return sb;
}

(async () => {
  console.log('\n--- the bug: asking from the QR decode callback ---');
  {
    const sb = iosSandbox();
    // The decode callback runs frames after the tap. No activation.
    sb.env.activation = false;
    const granted = await sb.API.navRequestMotionPermission();
    ok('iOS refuses the request with no activation left', granted === false);
    ok('and it never reached the permission dialog', sb.env.asked === 0, sb.env.asked);
    ok('the refusal is recorded as an activation failure',
       sb.env.refusedForActivation === 1);
    ok('the grant stays UNKNOWN, so a later real tap can still succeed',
       sb.NAV._motionGranted === null, sb.NAV._motionGranted);
    ok('navStartPDR refuses to bind rather than firing a dead alert',
       sb.API.navStartPDR() === false);
    ok('nothing was bound to devicemotion', sb.env.bound.length === 0);
  }

  console.log('\n--- the fix: the tap takes the grant, the callback spends it ---');
  {
    const sb = iosSandbox();
    sb.env.activation = true;                      // inside the Scan tap
    const granted = await sb.API.navRequestMotionPermission();
    sb.env.activation = false;                     // camera opens, frames pass
    ok('the tap gets the grant', granted === true);
    ok('the dialog was reached exactly once', sb.env.asked === 1, sb.env.asked);
    ok('the grant is cached on NAV', sb.NAV._motionGranted === true);
    ok('motion is ready even with the gesture long gone',
       sb.API.navMotionReady() === true);

    let moved = null;
    sb.NAV.onPositionChange = (r, c) => { moved = [r, c]; };
    ok('navStartPDR now binds from the decode callback',
       sb.API.navStartPDR() === true);
    ok('devicemotion is actually bound', sb.env.bound.join() === 'devicemotion',
       sb.env.bound.join());
    ok('PDR is marked active', sb.NAV.pdrActive === true);
    ok('the position is republished so the ME dot appears',
       moved && moved[0] === 73 && moved[1] === 37, JSON.stringify(moved));
    ok('a second call is idempotent', sb.API.navStartPDR() === true &&
       sb.env.bound.length === 1, sb.env.bound.length);
  }

  console.log('\n--- a citizen who declines ---');
  {
    const sb = iosSandbox({ answer: 'denied' });
    sb.env.activation = true;
    const granted = await sb.API.navRequestMotionPermission();
    ok('the refusal is recorded', granted === false &&
       sb.NAV._motionGranted === false);
    ok('motion is not ready', sb.API.navMotionReady() === false);
    ok('navStartPDR declines quietly', sb.API.navStartPDR() === false);
    ok('nothing bound', sb.env.bound.length === 0);
    // Tapping the enable button later must be able to ask again.
    sb.env.activation = true;
    await sb.API.navRequestMotionPermission();
    ok('tapping enable re-opens the dialog rather than caching "no" forever',
       sb.env.asked === 2, sb.env.asked);
  }

  console.log('\n--- Android / desktop, where there is no permission gate ---');
  {
    const sb = iosSandbox({ noPermissionApi: true });
    ok('motion is ready with no request at all', sb.API.navMotionReady() === true);
    ok('navStartPDR binds straight away', sb.API.navStartPDR() === true);
    ok('devicemotion bound', sb.env.bound.join() === 'devicemotion');
    ok('no dialog was ever reached', sb.env.asked === 0);
  }

  console.log('\n--- the handlers that have to take the grant ---');
  // Each of these is the last real tap before the route starts. If any stops
  // asking, the scan path silently regresses to the original bug.
  const callsRequest = (hay) => /navRequestMotionPermission\(\)/.test(hay);
  const between = (startMark, len) => {
    const i = appSrc.indexOf(startMark);
    return i < 0 ? '' : appSrc.slice(i, i + len);
  };
  ok('the Scan button asks before opening the camera',
     callsRequest(between("DOM.qrPromptScanBtn.addEventListener", 400)));
  ok('the Skip button asks', callsRequest(between("DOM.qrPromptSkipBtn.addEventListener", 400)));
  ok('manual location entry asks', callsRequest(between("DOM.manualLocGo.addEventListener", 400)));
  ok('the mid-route re-scan asks', callsRequest(between("DOM.navRescanBtn.addEventListener", 300)));
  ok('the PDR toggle asks', callsRequest(between("DOM.pdrToggleBtn.addEventListener", 700)));
  ok('the walk recorder asks', callsRequest(between("function startWalkRecording", 1400)));

  console.log('\n--- the tap-to-enable fallback ---');
  ok('the button exists in the markup', /id="navMotionBtn"/.test(html));
  ok('it starts hidden', /id="navMotionBtn"[^>]*\shidden/.test(html));
  ok('it sits inside the step prompt',
     html.indexOf('id="navMotionBtn"') > html.indexOf('id="navStepPrompt"') &&
     html.indexOf('id="navMotionBtn"') < html.indexOf('id="navRescanBtn"'));
  ok('app.js holds a DOM reference', /navMotionBtn:\s*\$\('navMotionBtn'\)/.test(appSrc));
  ok('its handler asks for permission',
     callsRequest(between("DOM.navMotionBtn.addEventListener", 500)));
  ok('_ensurePdrOn offers it when motion is not ready',
     /_showMotionEnable\(!started/.test(appSrc));
  ok('it is hidden again when the route ends',
     /_showMotionEnable\(false\);\s*\/\/ goes with the route/.test(appSrc));
  ok('the stylesheet hides it when the hidden attribute is set',
     /\.nav-motion-btn\[hidden\]\s*\{\s*display:\s*none/.test(
       fs.readFileSync(path.resolve(ROOT, 'wayfinding-app/css/app.css'), 'utf8')));

  console.log('\n--- the alerts that used to fire mid-scan ---');
  const pdrBody = lift(navSrc, 'navStartPDR');
  ok('navStartPDR no longer alerts', !/alert\(/.test(pdrBody));
  ok('and no longer calls requestPermission itself',
     !/requestPermission\(\)/.test(pdrBody));

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();

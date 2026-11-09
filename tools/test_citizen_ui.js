/**
 * test_citizen_ui.js - the citizen's route view, prompts and messages
 * (ui-ux-pro-max audit, 2026-11-09).
 *
 * Measured on a 375 x 812 phone before the fix:
 *   - two of the step bar's four buttons were entirely off screen, including
 *     the iPhone "turn motion on" button and the QR re-scan button;
 *   - the toast was one unwrapped line, 836 px wide;
 *   - right after "I'm at the stairs" the app asked "Reached the Ground
 *     Floor?" - the floor just left - because the generic stair check ran
 *     during a trip;
 *   - prompts were English-only, used emoji as icons and 30 px buttons, and
 *     two "isn't mapped" messages were browser alert() pop-ups.
 * Layout itself is checked in the browser (see the plan); this file pins the
 * markup, the CSS rules that make it fit, and the small helpers.
 *
 * Run: node tools/test_citizen_ui.js <repo-root>
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
const read = (p) => fs.readFileSync(path.resolve(ROOT, p), 'utf8');
const html = read('wayfinding-app/index.html');
const css = read('wayfinding-app/css/app.css');
const app = read('wayfinding-app/js/app.js');
const nav = read('wayfinding-app/js/nav.js');
const chat = read('wayfinding-app/js/chat.js');
const EMOJI = /\p{Extended_Pictographic}/u;

function lift(src, name) {
  const i = src.indexOf(`function ${name}(`);
  if (i < 0) return null;
  let depth = 0, k = src.indexOf('{', i);
  for (; k < src.length; k++) {
    if (src[k] === '{') depth++;
    else if (src[k] === '}') { depth--; if (depth === 0) break; }
  }
  return src.slice(i, k + 1);
}
function block(id) {
  const i = html.indexOf(`id="${id}"`);
  if (i < 0) return '';
  const start = html.lastIndexOf('<', i);
  const tag = html.slice(start + 1, html.indexOf(' ', start)).trim();
  let depth = 0, k = start;
  const open = new RegExp(`<${tag}[\\s>]`, 'g'), close = new RegExp(`</${tag}>`, 'g');
  // walk forward counting nested tags of the same name
  const re = new RegExp(`<\\/?${tag}[\\s>]`, 'g');
  re.lastIndex = start;
  let m;
  while ((m = re.exec(html))) {
    if (m[0][1] === '/') depth--; else depth++;
    if (depth === 0) { k = re.lastIndex; break; }
  }
  return html.slice(start, html.indexOf('>', k - 1) + 1);
}
function rule(selector) {
  const i = css.indexOf(selector + ' {');
  return i < 0 ? '' : css.slice(i, css.indexOf('}', i) + 1);
}

console.log('\n--- icons, not emoji ---');
ok('js/ui_icons.js exists and is loaded before app.js and chat.js',
   fs.existsSync(path.resolve(ROOT, 'wayfinding-app/js/ui_icons.js')) &&
   html.indexOf('src="js/ui_icons.js') > 0 && html.indexOf('src="js/ui_icons.js') < html.indexOf('src="js/app.js') &&
   html.indexOf('src="js/ui_icons.js') < html.indexOf('src="js/chat.js'));
for (const id of ['navStepPrompt', 'stairPrompt', 'stairConfirmPrompt', 'arrivalPrompt', 'qrPromptModal', 'askAgainBtn']) {
  const b = block(id);
  ok(`#${id} has no emoji`, b && !EMOJI.test(b), (b.match(EMOJI) || [''])[0]);
}
const toastCalls = [...app.matchAll(/_showStairToast\(([^;]*)\);/g)].map((m) => m[1]);
ok('no toast message starts with or contains an emoji', toastCalls.length > 0 && toastCalls.every((t) => !EMOJI.test(t)),
   toastCalls.filter((t) => EMOJI.test(t)).slice(0, 2).join(' | '));
const instr = lift(app, '_updateNavInstruction') || '';
ok('the walking instruction icon is an SVG, not an emoji', /uiIcon\(/.test(instr) && !EMOJI.test(instr));
ok('the chat bubble and its QR hint use icons, not emoji',
   !/chat-toggle-icon">💬/.test(chat) && !/📷/.test(chat) && /uiIcon\(/.test(chat));
{
  const icons = read('wayfinding-app/js/ui_icons.js');
  const sb = { console };
  vm.createContext(sb);
  vm.runInContext(icons + ';this.uiIcon = uiIcon;', sb);
  const svg = sb.uiIcon('stairs');
  ok('uiIcon returns an aria-hidden inline SVG', /^<svg[^>]*aria-hidden="true"/.test(svg) && /<\/svg>$/.test(svg), svg.slice(0, 80));
  const needed = ['arrow-right', 'arrow-left', 'arrow-up', 'u-turn', 'flag', 'walk', 'stairs', 'camera',
                  'map-pin', 'check', 'x', 'message', 'home', 'alert', 'up', 'down'];
  const missing = needed.filter((n) => !/<path|<circle|<rect|<polyline/.test(sb.uiIcon(n)));
  ok('every icon the UI uses is defined', missing.length === 0, missing.join(', '));
}

console.log('\n--- the step bar fits a phone ---');
const step = block('navStepPrompt');
ok('instruction, meta line and actions are separate rows',
   /class="nav-step-main"/.test(step) && /id="navStepMeta"/.test(step) && /class="nav-step-actions"/.test(step));
ok('the motion button is labelled in words and still sits before the re-scan button',
   /id="navMotionBtn"[^>]*\shidden/.test(step) && step.indexOf('navMotionBtn') < step.indexOf('navRescanBtn') &&
   />[^<]*Turn on walking/.test(step.slice(step.indexOf('navMotionBtn'))));
ok('the re-scan button is labelled, not a bare camera', /id="navRescanBtn"[\s\S]*?Scan QR/.test(step));
ok('the step bar is announced to screen readers', /id="navStepPrompt"[^>]*aria-live="polite"/.test(step));
const actions = rule('.nav-step-actions');
ok('the action row wraps', /flex-wrap:\s*wrap/.test(actions), actions);
const act = rule('.nav-act');
ok('action buttons are at least 44 px tall with 15 px+ text',
   /min-height:\s*44px/.test(act) && /font-size:\s*(0\.9[4-9]|1(\.\d+)?)rem/.test(act), act);
ok('the instruction text is at least 16 px', /font-size:\s*(1\.0[0-9]*|1\.[1-9]\d*)rem/.test(rule('.nav-step-text')),
   rule('.nav-step-text'));
ok('the citizen view drops the bottom step-count pill (the meta line replaces it)',
   /body\.view-user #infoSteps\s*\{[^}]*display:\s*none/.test(css));
{
  const fn = lift(app, '_navMetaLine');
  ok('_navMetaLine exists', !!fn);
  if (fn) {
    const sb = { STATE: { currentFloor: 1 }, NAV: { metresPerCell: 0.6 },
                 _crossFloorTrip: { leg: 1, destFloor: 0 },
                 _floorLabel: (f) => ['Lower Ground Floor', 'Ground Floor', '2nd Floor'][f], Math };
    vm.createContext(sb);
    vm.runInContext(fn + ';this.f = _navMetaLine;', sb);
    const leg1 = sb.f(40);
    ok('leg one names both floors and the walk to the stairs',
       leg1 === 'Ground Floor → Lower Ground Floor · about 24 m to the stairs', leg1);
    sb._crossFloorTrip = null;
    const same = sb.f(10);
    ok('a same-floor route names the floor and the walk left', same === 'Ground Floor · about 6 m to go', same);
  }
}

console.log('\n--- toasts and the bottom of the screen ---');
const toast = rule('.stair-toast');
ok('the toast wraps', /white-space:\s*normal/.test(toast) && !/nowrap/.test(toast), toast);
ok('the toast never exceeds the screen', /max-width:\s*min\(\s*440px,\s*calc\(100vw - 24px\)\s*\)/.test(toast), toast);
ok('the toast sits above the Ask again button', /bottom:\s*calc\(84px \+ env\(safe-area-inset-bottom/.test(toast), toast);
ok('stairs prompts share that spot', /bottom:\s*calc\(84px \+ env\(safe-area-inset-bottom/.test(rule('.stair-prompt')));
ok('the toast is announced politely', /id="stairToast"[^>]*role="status"[^>]*aria-live="polite"|id="stairToast"[^>]*aria-live="polite"/.test(html));
{
  const fn = lift(app, '_toastMs');
  ok('_toastMs exists', !!fn);
  if (fn) {
    const sb = { Math };
    vm.createContext(sb);
    vm.runInContext(fn + ';this.f = _toastMs;', sb);
    ok('a short toast stays 3 s', sb.f('Motion on.') === 3000, sb.f('Motion on.'));
    const long = 'City Health Services Department is on the Lower Ground Floor. First walk about 24 m to the stairs, then follow the route.';
    ok('a long toast stays longer, up to 8 s', sb.f(long) > 3500 && sb.f(long) <= 8000, sb.f(long));
    ok('nothing stays past 8 s', sb.f('word '.repeat(400)) === 8000);
  }
}
{
  const fn = lift(app, '_officeTitle');
  ok('_officeTitle exists', !!fn);
  if (fn) {
    const sb = {};
    vm.createContext(sb);
    vm.runInContext(fn + ';this.f = _officeTitle;', sb);
    ok('office names are no longer shouted', sb.f('CITY HEALTH SERVICES DEPARTMENT') === 'City Health Services Department',
       sb.f('CITY HEALTH SERVICES DEPARTMENT'));
    ok('small words stay small', sb.f('OFFICE OF THE MAYOR') === 'Office of the Mayor', sb.f('OFFICE OF THE MAYOR'));
    ok('commas and apostrophes survive',
       sb.f("MAYOR'S OFFICE PUBLIC ASSISTANCE CENTER") === "Mayor's Office Public Assistance Center" &&
       sb.f('INFORMATION, INVESTMENT PROMOTIONS AND EMPLOYMENT SERVICES OFFICE') ===
         'Information, Investment Promotions and Employment Services Office',
       sb.f("MAYOR'S OFFICE PUBLIC ASSISTANCE CENTER"));
    ok('an already mixed-case name is left alone', sb.f('Public Assistance Center') === 'Public Assistance Center');
  }
}

console.log('\n--- stairs ---');
{
  const fn = lift(app, '_onStairCell');
  ok('_onStairCell is a top-level function', !!fn);
  if (fn) {
    const shown = [];
    const sb = {
      STATE: { currentFloor: 0, endId: '43,4' }, GRID_COLS: 75,
      FLOOR_WALLS: { 1: Object.assign(new Array(75 * 75).fill('open'), { [27 * 75 + 3]: 'stair' }) },
      document: { body: { classList: { contains: (c) => c === 'route-active' } } },
      _showStairConfirm: (f) => shown.push(['confirm', f]), _showStairPrompt: () => shown.push(['prompt']),
      _showStairToast: (m) => shown.push(['toast', m]), setTimeout: () => 0,
      _stairCooldown: false,
    };
    vm.createContext(sb);
    vm.runInContext('var _stairCooldown = false;\n' + (lift(app, '_routeActive') || '') + '\n' + fn + ';this.f = _onStairCell;', sb);
    sb.f(27, 3);
    ok('during a route, landing on stairs asks nothing', shown.length === 0, JSON.stringify(shown));
    // Leg two: switchFloor() has just cleared STATE.endId when the dot is put
    // on the stair cell, so the destination alone can't say a trip is on.
    sb.STATE.endId = null;
    sb._crossFloorTrip = { leg: 1, destFloor: 0 };
    sb._stairCooldown = false;
    vm.runInContext('_stairCooldown = false;', sb);
    sb.f(27, 3);
    ok('starting leg two on a stair cell asks nothing (the endId is cleared at that moment)',
       shown.length === 0, JSON.stringify(shown));
    sb._crossFloorTrip = null;
    vm.runInContext('_stairCooldown = false;', sb);
    sb.document.body.classList.contains = () => false;
    sb.STATE.endId = null;
    sb.f(27, 3);
    ok('with no route, the stairs question still appears', shown.some((s) => s[0] === 'confirm' && s[1] === 1),
       JSON.stringify(shown));
  }
}
const confirmBox = block('stairConfirmPrompt');
ok('the stairs confirmation has a Filipino line', /id="stairConfirmSub"/.test(confirmBox));
ok('the stairs confirmation fills it', /stairConfirmSub[\s\S]{0,200}Nasa \$\{/.test(lift(app, '_showStairConfirm') || ''));

console.log('\n--- the location prompt ---');
const qr = block('qrPromptModal');
ok('it is bilingual', /Saan ka ngayon\?/.test(qr) && /Set your location/.test(qr));
ok('Skip is no longer "for testing"', !/for testing/i.test(qr) && /Magsimula sa main entrance/.test(qr) &&
   /Start from the main entrance/.test(qr));
ok('the manual help text names the floor, not "Floor 2"', !/Floor 2/.test(qr) && /on the Ground Floor/.test(qr));
ok('a camera failure no longer opens a browser prompt', !/prompt\(|alert\(/.test(lift(nav, 'navStartQRScan') || 'prompt('));
ok('it asks the app to show the manual panel instead', /NAV\.onScanUnavailable/.test(lift(nav, 'navStartQRScan') || '') &&
   /NAV\.onScanUnavailable\s*=/.test(app));

console.log('\n--- arrival ---');
const arr = block('arrivalPrompt');
ok('the arrival card has a place for the office and a Filipino line',
   /id="arrivalText"/.test(arr) && /Nandito ka na/.test(arr));
ok('the arrival card names the office', /arrivalText[\s\S]{0,300}_navDestLabel/.test(lift(app, '_showArrivalPrompt') || ''));
ok('the close button is labelled and 44 px', /id="arrivalCloseBtn"[^>]*aria-label="Close"/.test(arr) &&
   /width:\s*44px/.test(rule('.btn-arrival-close')) && /height:\s*44px/.test(rule('.btn-arrival-close')));
ok('arrival buttons are 48 px tall', /min-height:\s*48px/.test(rule('.btn-arrival-action')));

console.log('\n--- chat ---');
ok('the round chat button hides while the chat is open (every width since 2026-11-09)',
   /(^|\n)body\.chat-showing \.chat-toggle-btn\s*\{\s*display:\s*none/.test(css));
{
  const fn = lift(chat, '_starterLabel');
  const sb = {};
  vm.createContext(sb);
  vm.runInContext(fn + ';this.f = _starterLabel;', sb);
  const long = 'Request for Assistance in Discussions Related to Issues on Financial Support or Custody of';
  const l = sb.f(long);
  ok('long chip labels are cut at a word, within 52 characters', l.length <= 52 && /…$/.test(l) && !/\s…$/.test(l) &&
     long.startsWith(l.slice(0, -1)), l);
  ok('the meaningful parenthetical is kept', sb.f('Pagbibigay ng Community Tax Certificate (Cedula) Pagkolekta mula sa Community Tax Certificate (Cedula)')
     .includes('(Cedula)'));
  ok('short labels are untouched', sb.f('Birth certificate') === 'Birth certificate');
}
ok('chips wrap to two lines and are 44 px tall',
   /min-height:\s*44px/.test(rule('.chat-starter-chip')) && /-webkit-line-clamp:\s*2/.test(rule('.chat-starter-chip')));

console.log('\n--- Ask again only during a route ---');
{
  // A later bare ".ask-again-btn { display: inline-flex }" once overrode the
  // hidden default and showed the button over the chat bubble on the landing page.
  const bare = [...css.matchAll(/(^|\n)\.ask-again-btn\s*\{([^}]*)\}/g)].map((m) => m[2]);
  ok('no bare .ask-again-btn rule makes it visible',
     bare.length > 0 && bare.every((b) => !/display:\s*(inline-flex|flex|block|inline-block)/.test(b)),
     bare.map((b) => b.trim().slice(0, 60)).join(' | '));
  ok('it is shown by the route-active rule', /body\.view-user\.route-active \.ask-again-btn\s*\{\s*display:\s*inline-flex/.test(css));
}

console.log('\n--- no pop-ups for citizens ---');
ok('routing never calls alert()', !/alert\(/.test(lift(app, 'navigateToDepartment') || 'alert('));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);

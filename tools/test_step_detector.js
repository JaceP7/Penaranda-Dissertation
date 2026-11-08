/**
 * test_step_detector.js - PDR step detection in nav.js, driven by simulated
 * phone acceleration at 60 Hz (the rate iOS Safari delivers devicemotion).
 *
 * Why: Jace had to tug the phone to make the ME dot move. Five recorded iPhone
 * walks (pdr_walks_2026-06-08) moved about 1.2 cells a second against a normal
 * cadence of roughly 1.7-2 steps a second. The old detector needed a 1.2 m/s2
 * swing above a 250 ms mean, unfiltered, and its 20-step retune raised that
 * threshold further after tug-steps.
 *
 * The signals here are synthetic, not recordings: a step is a fundamental plus
 * a second harmonic (the heel-strike shape), with per-step amplitude and
 * cadence jitter and Gaussian sensor/hand noise, all from a seeded generator so
 * every run is identical. Amplitudes are the swing of |acceleration| above its
 * mean, in m/s2.
 *
 * Run: node tools/test_step_detector.js <repo-root>
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

// Seeded PRNG (mulberry32) + Box-Muller, so the noise is the same every run.
function rng(seed) {
  let a = seed >>> 0;
  const u = () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const gauss = () => Math.sqrt(-2 * Math.log(u() || 1e-12)) * Math.cos(2 * Math.PI * u());
  return { u, gauss };
}

const HZ = 60, G = 9.81;

/** A detector instance: the real _navOnMotion with a fake clock. */
function detector() {
  // The fields the NAV literal in nav.js starts with; navRecalibrate() then
  // resets whatever the detector uses.
  const NAV = { _threshold: 1.2, _debounce: 400, _adaptBuf: [], _lastStepTime: 0,
                _stepBuffer: [], _prevSign: 0, _cyclePeak: 0 };
  const sb = { console, Math, Number, NAV, steps: [], clock: 1000 };
  sb.Date = { now: () => sb.clock };
  sb._navStep = () => sb.steps.push(sb.clock);
  vm.createContext(sb);
  const tuning = (navSrc.match(/const STEP_TUNING = Object\.freeze\(\{[\s\S]*?\}\);/) || [''])[0];
  vm.runInContext([tuning, lift(navSrc, 'navRecalibrate'), lift(navSrc, '_navOnMotion'),
                   navSrc.includes('function _navCountSteps(') ? lift(navSrc, '_navCountSteps') : ''].join('\n') +
                  '\n;navRecalibrate();this.feed = _navOnMotion;', sb);
  return {
    sb,
    /** Push one sample of |a| (m/s2, gravity included) and advance the clock. */
    push(mag) {
      sb.feed({ accelerationIncludingGravity: { x: 0, y: 0, z: mag } });
      sb.clock += 1000 / HZ;
    },
    count() { return sb.steps.length; },
  };
}

/** Walk: returns the number of true steps fed. */
function walk(d, r, { seconds, cadence, amp, noise = 0.12, ampJitter = 0.2, cadJitter = 0.08 }) {
  let t = 0, steps = 0;
  while (t < seconds) {
    const T = (1 / cadence) * (1 + cadJitter * (2 * r.u() - 1));
    const A = amp * (1 + ampJitter * (2 * r.u() - 1));
    const n = Math.round(T * HZ);
    for (let i = 0; i < n; i++) {
      const ph = (2 * Math.PI * i) / n;
      d.push(G + A * (Math.sin(ph) + 0.35 * Math.sin(2 * ph + 0.6)) + noise * r.gauss());
    }
    t += n / HZ;
    steps++;
  }
  return steps;
}

/** Standing still: hand tremor plus a slow sway. */
function stand(d, r, { seconds, noise = 0.12, sway = 0.15 }) {
  const n = Math.round(seconds * HZ);
  for (let i = 0; i < n; i++) d.push(G + sway * Math.sin(2 * Math.PI * 0.4 * i / HZ) + noise * r.gauss());
}

/** One bump, like lifting the phone to look at it. */
function bump(d, r, { size = 3 } = {}) {
  for (let i = 0; i < 40; i++) {
    const x = (i - 20) / 5;
    d.push(G + size * Math.exp(-x * x) + 0.12 * r.gauss());
  }
}

const pct = (a, b) => `${a} of ${b} (${Math.round((100 * a) / b)}%)`;

console.log('\n--- walking with the phone held in front, as citizens do ---');
{
  const d = detector(), r = rng(1);
  stand(d, r, { seconds: 2 });
  const truth = walk(d, r, { seconds: 20, cadence: 1.8, amp: 0.7 });
  const got = d.count();
  ok(`normal hand-held walk (1.8 steps/s, 0.7 m/s2 swing): ${pct(got, truth)}`,
     got >= 0.9 * truth && got <= 1.1 * truth);
}
{
  const d = detector(), r = rng(2);
  const truth = walk(d, r, { seconds: 20, cadence: 1.5, amp: 0.45 });
  const got = d.count();
  ok(`slow, smooth walk (1.5 steps/s, 0.45 m/s2): ${pct(got, truth)}`,
     got >= 0.85 * truth && got <= 1.1 * truth);
}
{
  const d = detector(), r = rng(3);
  const truth = walk(d, r, { seconds: 20, cadence: 2.3, amp: 1.8 });
  const got = d.count();
  ok(`brisk walk (2.3 steps/s, 1.8 m/s2) is not double-counted: ${pct(got, truth)}`,
     got >= 0.9 * truth && got <= 1.1 * truth);
}
{
  const d = detector(), r = rng(4);
  const truth = walk(d, r, { seconds: 20, cadence: 1.7, amp: 2.5, noise: 0.25 });
  const got = d.count();
  ok(`phone in a pocket (1.7 steps/s, 2.5 m/s2, noisier): ${pct(got, truth)}`,
     got >= 0.9 * truth && got <= 1.1 * truth);
}

console.log('\n--- not walking ---');
{
  const d = detector(), r = rng(5);
  stand(d, r, { seconds: 30 });
  ok('standing still for 30 s with a shaky hand: no steps', d.count() === 0, d.count());
}
{
  // Nearly double the tremor and sway: the margin that set baseThreshold.
  const d = detector(), r = rng(10);
  stand(d, r, { seconds: 30, noise: 0.22, sway: 0.3 });
  ok('standing still with a very shaky hand: no steps', d.count() === 0, d.count());
  bump(d, r, { size: 3 });
  stand(d, r, { seconds: 3, noise: 0.22, sway: 0.3 });
  ok('  and lifting the phone then: still no step', d.count() === 0, d.count());
}
{
  const d = detector(), r = rng(6);
  stand(d, r, { seconds: 2 });
  bump(d, r, { size: 3 });
  stand(d, r, { seconds: 3 });
  ok('lifting the phone once: no step', d.count() === 0, d.count());
}
{
  const d = detector(), r = rng(7);
  walk(d, r, { seconds: 10, cadence: 1.8, amp: 0.7 });
  const atStop = d.count();
  stand(d, r, { seconds: 10 });
  ok('stopping: at most one step after the stop', d.count() - atStop <= 1, d.count() - atStop);
}

console.log('\n--- the detector must not learn to need tugs ---');
{
  const d = detector(), r = rng(8);
  walk(d, r, { seconds: 12, cadence: 1.8, amp: 4.0 });     // tugging
  const before = d.count();
  const truth = walk(d, r, { seconds: 20, cadence: 1.8, amp: 0.7 });
  const got = d.count() - before;
  ok(`normal walking right after tugging: ${pct(got, truth)}`, got >= 0.85 * truth && got <= 1.1 * truth);
}
{
  const d = detector(), r = rng(9);
  walk(d, r, { seconds: 15, cadence: 1.8, amp: 4.0 });
  d.sb.navRecalibrate && d.sb.navRecalibrate();
  vm.runInContext('navRecalibrate()', d.sb);
  const before = d.count();
  const truth = walk(d, r, { seconds: 10, cadence: 1.8, amp: 0.7 });
  ok('the Recal button restores normal sensitivity', d.count() - before >= 0.85 * truth,
     pct(d.count() - before, truth));
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);

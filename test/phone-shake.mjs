// An iPhone-like sensor stream (gyro numbers in iPhone order, repeated readings, 0.1 degree steps, hand tremor) through
// the screen's prediction and smoothing: how far behind your intended move the glider is, and how much wobble is left.
// Run: node test/phone-shake.mjs [path to an older predict.js to compare] [grid]
import * as NEW from '../src/predict.js';
const OLD = process.argv[2] && process.argv[2] !== 'grid' ? await import(new URL(process.argv[2], 'file://' + process.cwd() + '/').href) : null;
let seed = 7; const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
const gauss = () => { let u = 0; for (let i = 0; i < 6; i++) u += rnd(); return (u - 3) / Math.sqrt(0.5); };
function hand(T, trem = true) { const keys = []; let t = 0, a = 0; while (t < T) { const dur = 0.2 + rnd() * 0.4, hold = 0.1 + rnd() * 0.8, b = (rnd() * 2 - 1) * 25; keys.push({ t, dur, a, b }); a = b; t += dur + hold; }
  return t => { let k = keys[0]; for (const x of keys) if (x.t <= t) k = x; else break; const u = Math.min(1, (t - k.t) / k.dur), s = u * u * u * (10 - 15 * u + 6 * u * u); return k.a + (k.b - k.a) * s + (trem ? 0.35 * Math.sin(t * 2 * Math.PI * 8) + 0.2 * Math.sin(t * 2 * Math.PI * 5.3) : 0); }; }   // + hand tremor
function run(P, { order, maxLead, oldPhoneSide, euro = false, kG = 70, mh = 2.5, pd = 0.08, vl = 0 }) {
  seed = 11; const T = 40, fp = hand(T); seed = 11; const fi = hand(T, false); seed = 11; hand(T); const d = (f, t) => (f(t + 0.0005) - f(t - 0.0005)) / 0.001; const rf = P.makeRate(); const msgs = []; let last = null;
  for (let t = 0; t < T; t += 1 / 60) {
    let a = [Math.round(fp(t) * 10) / 10, 0]; if (last && rnd() < 0.15) a = last; last = a;   // repeats and 0.1 degree steps
    const rates = [d(fp, t) + gauss() * 1.5, gauss() * 1.5, gauss() * 3];
    const g = order === 'none' ? null : order === 'ios' ? [rates[0], rates[1], rates[2]] : [rates[2], rates[0], rates[1]];   // iPhone: x,y,z ; standard: z,x,y
    const v = P.rateStep(rf, t * 1000, a, oldPhoneSide ? [g[1], g[2]] : g);
    msgs.push({ at: t + 0.012, p: a[0], vp: v[0], tp: t * 1000 });
  }
  const E = {}; const s = { p: 0, r: 0, vp: 0, vr: 0, at: 0 }; let mi = 0, sp = 0, gp = 0; const outs = []; const dt = 1 / 60;
  for (let t = 1; t < T - 1; t += dt) {
    while (mi < msgs.length && msgs[mi].at <= t) { const m = msgs[mi++]; s.p = m.p; s.vp = vl ? s.vp + (m.vp - s.vp) * vl : m.vp; s.at = m.tp; }
    const tgt = NEW.predict(s, t * 1000, 20 + 1000 / 60 + 1000 / 70, 160, maxLead)[0];
    if (euro) sp = NEW.euroStep(E, tgt, s.vp, dt, ...(mh === 2.5 && pd === 0.08 ? [] : [mh, pd])); else sp += (tgt - sp) * (1 - Math.exp(-dt * 60)); gp += (sp - gp) * (1 - Math.exp(-dt * kG)); outs.push([t + 0.02, gp]);
  }
  let best = 0, bestE = 1e18; for (let lag = -0.1; lag <= 0.3; lag += 0.002) { let e = 0; for (const [t, o] of outs) e += (o - fi(t - lag)) ** 2; if (e < bestE) { bestE = e; best = lag; } }
  let shake = 0; for (let i = 2; i < outs.length; i++) { const r = k => outs[i - k][1] - fi(outs[i - k][0] - best); const a = r(0) - 2 * r(1) + r(2); shake += a * a; }
  return `${Math.round(best * 1000)} ms behind, shake ${Math.sqrt(shake / outs.length).toFixed(3)}°/frame² of wobble beyond your intended move`;
}
for (const [n, o] of [...(OLD ? [['older version', { order: 'ios', maxLead: 18, oldPhoneSide: true, P: OLD }]] : []), ['gyro fix only', { order: 'ios', maxLead: 18 }],
  ['gyro fix + steady filter', { order: 'ios', maxLead: 18, euro: true }], ['FIXED: gyro + steady filter, game 35', { order: 'ios', maxLead: 18, euro: true, kG: 35 }],
  ['no prediction, old smoothing (before)', { order: 'ios', maxLead: 0, kG: 14 }]]) console.log(n.padEnd(40), run(o.P || NEW, o));
if (process.argv.includes('grid')) for (const mh of [1.2, 2, 3]) for (const pd of [0.04, 0.08, 0.15]) for (const kG of [35, 45]) for (const vl of [0, 0.4])
  console.log('minHz', mh, 'perDeg', pd, 'game', kG, 'vel smooth', vl, '->', run(NEW, { order: 'ios', maxLead: 18, euro: true, mh, pd, kG, vl }).replace(' of wobble beyond your intended move', ''));

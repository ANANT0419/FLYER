// Simulates a phone tilting like a hand, a network, and the big screen's frame loop, and measures how far behind the
// glider's attitude trails the real phone. Run: node test/predict-sim.mjs
import { makeRate, rateStep, makeClock, clockPong, predict } from '../src/predict.js';
let seed = 7; const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
const gauss = () => { let u = 0; for (let i = 0; i < 6; i++) u += rnd(); return (u - 3) / Math.sqrt(0.5); };
function hand(T) {   // smooth moves between random tilts, like a person steering, plus tremor
  const keys = []; let t = 0, a = 0; while (t < T) { const dur = 0.15 + rnd() * 0.3, hold = 0.05 + rnd() * 0.8, b = (rnd() * 2 - 1) * 28; keys.push({ t, dur, a, b }); a = b; t += dur + hold; }
  return t => { let k = keys[0]; for (const x of keys) if (x.t <= t) k = x; else break; const u = Math.min(1, (t - k.t) / k.dur), s = u * u * u * (10 - 15 * u + 6 * u * u); return k.a + (k.b - k.a) * s + 0.15 * Math.sin(t * 50); };
}
function run({ lat, jit, rate, newWay, gyroUnits = 1, ML = 18, EX = 0, kG = 70 }) {
  seed = 7; const T = 60, fp = hand(T), fr = hand(T), d = (f, t) => (f(t + 0.0005) - f(t - 0.0005)) / 0.001;
  // phone -> network
  const msgs = []; const rf = makeRate(); const clk = makeClock(); const phoneOff = 123456;   // phone clock is elsewhere
  for (let t = 0; t < T; t += 1 / 60) {
    const a = [fp(t) + gauss() * 0.05, fr(t) + gauss() * 0.05], g = [(d(fp, t) + gauss() * 2) / gyroUnits, (d(fr, t) + gauss() * 2) / gyroUnits];
    const v = rateStep(rf, t * 1000 + phoneOff, a, gyroUnits ? g : null);
    if (rate < 60 && Math.round(t * 60) % Math.round(60 / rate)) continue;
    msgs.push({ arrive: t + lat + Math.abs(gauss()) * jit, p: a[0], r: a[1], vp: v[0], vr: v[1], tp: t * 1000 + phoneOff });
  }
  msgs.sort((x, y) => x.arrive - y.arrive);
  // clock pings
  for (let t = 0.1; t < T; t += 1) { const up = lat + Math.abs(gauss()) * jit, down = lat + Math.abs(gauss()) * jit; clockPong(clk, t * 1000, (t + up) * 1000 + phoneOff, (t + up + down) * 1000); }
  // screen
  const s = { p: 0, r: 0, vp: 0, vr: 0, at: 0 }; let mi = 0, last = -1, sp = 0, gp = 0, ovp = 0, lastMsg = 0, oldP = 0, err = 0, n = 0; const outs = [];
  const dt = 1 / 60, DISPLAY = 0.02;
  for (let t = 1; t < T - 1; t += dt) {
    while (mi < msgs.length && msgs[mi].arrive <= t) { const m = msgs[mi++]; if (m.tp <= last) continue; last = m.tp;
      const gap = t - lastMsg; if (lastMsg && gap < 0.35) ovp += ((m.p - oldP) / Math.max(gap, 0.008) - ovp) * 0.5; oldP = m.p; lastMsg = t;
      s.p = m.p; s.vp = m.vp; s.at = Math.min(t * 1000, m.tp - clk.off); }
    let tgt;
    if (newWay) { tgt = predict(s, t * 1000, 20 + 1000 / 60 + 1000 / kG + EX, rate < 60 ? 260 : 160, rate < 60 ? ML * 1.4 : ML)[0]; sp += (tgt - sp) * (1 - Math.exp(-dt * 60)); gp += (sp - gp) * (1 - Math.exp(-dt * kG)); }
    else { const age = Math.min(rate < 60 ? 0.08 : 0.05, t - lastMsg); tgt = oldP + ovp * age; sp += (tgt - sp) * (1 - Math.exp(-dt * 55)); gp += (sp - gp) * (1 - Math.exp(-dt * 14)); }
    outs.push([t + DISPLAY, gp]);
  }
  // error vs the real phone at the moment the picture is seen, and the shift that best lines them up (the lag)
  for (const [t, o] of outs) { err += (o - fp(t)) ** 2; n++; }
  let best = 0, bestE = 1e18; for (let lag = -0.1; lag <= 0.4; lag += 0.002) { let e = 0; for (const [t, o] of outs) e += (o - fp(t - lag)) ** 2; if (e < bestE) { bestE = e; best = lag; } }
  return { rms: Math.sqrt(err / n).toFixed(2), lagMs: Math.round(best * 1000) };
}
const cases = [['direct Wi-Fi', { lat: 0.012, jit: 0.006, rate: 60 }], ['direct, busy Wi-Fi', { lat: 0.03, jit: 0.02, rate: 60 }], ['relay', { lat: 0.06, jit: 0.025, rate: 30 }]];
for (const [name, c] of cases) {
  const o = run({ ...c, newWay: false }), nw = run({ ...c, newWay: true }), rad = run({ ...c, newWay: true, gyroUnits: 57.3 }), nog = run({ ...c, newWay: true, gyroUnits: 0 });
  console.log(`${name.padEnd(20)} before: ${o.lagMs} ms behind (error ${o.rms}°)   after: ${nw.lagMs} ms (error ${nw.rms}°)   gyro in rad/s: ${rad.lagMs} ms   no gyro: ${nog.lagMs} ms (error ${nog.rms}°)`);
}
if (process.argv[2] === 'tune') for (const [name, c] of cases) for (const ML of [9, 14, 20]) for (const EX of [0, 15]) for (const kG of [45, 70]) { const r = run({ ...c, newWay: true, ML, EX, kG }); console.log(name, 'lead', ML, 'extra', EX, 'kG', kG, '->', r.lagMs, 'ms', r.rms); }

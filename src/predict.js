// Cancelling the phone delay. Every tilt message is a little old by the time the big screen draws it (network, frame,
// display). The phone also sends how fast it is turning (its gyroscope) and when it took the reading, so the screen can
// work out where the phone is *now* and draw that, instead of where it was. Pure functions, tested in test/predict-sim.mjs.
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

/* ---------- phone side: how fast is each tilt angle changing? ---------- */
// Gyroscope rates are the cleanest answer, but browsers disagree on which of the three gyro numbers belongs to which
// tilt (iPhones report them in a different order from the standard), on units (deg/s or rad/s) and on sign. So every
// gyro number is fitted against the change of each tilt angle, and one is trusted only once it clearly agrees.
// Until then, the change in angle over the last ~60 ms is used (steadier than reading to reading, which can repeat).
export function makeRate() {
  return { t: 0, hist: [], fd: [0, 0], sxy: [[0, 0, 0], [0, 0, 0]], sxx: [[0, 0, 0], [0, 0, 0]], syy: [0, 0], k: [0, 0], c: [-1, -1], ok: [false, false], prevA: null };
}
/** t in ms, a = [pitch, roll] degrees, g = the three gyro numbers [alpha, beta, gamma] in unknown units/order, or null.
 *  Returns [vp, vr] in deg/s. */
export function rateStep(f, t, a, g) {
  const out = [0, 0], dt = (t - f.t) / 1000;
  f.hist.push([t, a[0], a[1]]); while (f.hist.length > 2 && t - f.hist[0][0] > 60) f.hist.shift();
  const h0 = f.hist[0], span = (t - h0[0]) / 1000;
  for (let i = 0; i < 2; i++) {
    if (span > 0.02 && span < 0.2) f.fd[i] += ((a[i] - h0[i + 1]) / span - f.fd[i]) * 0.5; else if (span >= 0.2) f.fd[i] = 0;
    if (f.prevA && dt > 0.003 && dt < 0.12 && g) {
      const raw = (a[i] - f.prevA[i]) / dt;
      if (Math.abs(raw) > 4) {   // only learn while it is actually moving
        const d = 0.992; f.syy[i] = f.syy[i] * d + raw * raw; let best = -1, bestR = 0;
        for (let c = 0; c < 3; c++) {
          const x = g[c]; if (!isFinite(x)) continue;
          f.sxy[i][c] = f.sxy[i][c] * d + raw * x; f.sxx[i][c] = f.sxx[i][c] * d + x * x;
          if (f.sxx[i][c] > 1e-6 && f.syy[i] > 1) { const r2 = f.sxy[i][c] ** 2 / (f.sxx[i][c] * f.syy[i]); if (r2 > bestR) { bestR = r2; best = c; } }
        }
        if (best >= 0) {
          const k = f.sxy[i][best] / f.sxx[i][best], m = Math.abs(k);
          f.ok[i] = bestR > 0.5 && ((m > 0.6 && m < 1.7) || (m > 35 && m < 95));   // deg/s, or rad/s (x57.3)
          if (f.ok[i]) { f.k[i] = k; f.c[i] = best; }
        }
      }
    }
    out[i] = f.ok[i] && g && isFinite(g[f.c[i]]) ? f.k[i] * g[f.c[i]] : f.fd[i];
  }
  f.t = t; f.prevA = [a[0], a[1]];
  return out;
}

/* ---------- screen side: the two clocks ---------- */
// The screen pings with its own time; the phone answers with that and its own time. The answer with the shortest round
// trip gives the best estimate of how the two clocks differ, so each tilt reading can be dated in screen time.
export function makeClock() { return { ok: false, off: 0, rtt: 1e9 }; }
export function clockPong(c, sentAt, phoneT, now) {
  const rtt = now - sentAt; if (!(rtt >= 0 && rtt < 3000) || !isFinite(phoneT)) return;
  c.rtt += 0.4;                                   // let the best round trip age, so the estimate keeps up with changes
  if (!c.ok || rtt <= c.rtt) { c.rtt = rtt; c.off = phoneT - (sentAt + rtt / 2); c.ok = true; }
}

/* ---------- screen side: where is the phone now? ---------- */
// at: screen time of the reading. extra: how much later than "now" the picture reaches the eye (display + smoothing).
export function predict(s, now, extra, maxAhead, maxLead) {
  const ahead = clamp(now - s.at + extra, 0, maxAhead) / 1000;
  return [s.p + clamp(s.vp * ahead, -maxLead, maxLead), s.r + clamp(s.vr * ahead, -maxLead, maxLead)];
}

/* ---------- screen side: steady when still, quick when moving ("one euro" filter) ---------- */
// A fixed smoothing either lets hand tremor through (fast) or lags real moves (slow). This one changes with speed:
// at rest it smooths strongly (tremor and sensor noise vanish), while turning it barely smooths at all.
// speed comes from the gyroscope, so it is clean. minHz: smoothing at rest; perDeg: how fast it opens up with speed.
export function euroStep(state, x, speed, dt, minHz = 1.2, perDeg = 0.04) {   // tuned in the iPhone simulation: ~18 ms, little wobble
  if (state.v == null) { state.v = x; return x; }
  const hz = minHz + perDeg * Math.abs(speed), tau = 1 / (2 * Math.PI * hz), a = 1 / (1 + tau / Math.max(dt, 1e-3));
  state.v += (x - state.v) * a; return state.v;
}

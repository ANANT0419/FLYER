// Cancelling the phone delay. Every tilt message is a little old by the time the big screen draws it (network, frame,
// display). The phone also sends how fast it is turning (its gyroscope) and when it took the reading, so the screen can
// work out where the phone is *now* and draw that, instead of where it was. Pure functions, tested in test/predict-sim.mjs.
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

/* ---------- phone side: how fast is each tilt angle changing? ---------- */
// Gyroscope rates are the cleanest answer, but browsers disagree on units (deg/s or rad/s) and sign, so we fit the gyro
// against the change in angle and only trust it once the two agree. Until then, the change in angle itself is used.
export function makeRate() { return { t: 0, a: [0, 0], fd: [0, 0], sxy: [0, 0], sxx: [0, 0], syy: [0, 0], k: [0, 0], ok: [false, false] }; }
/** t in ms, a = [pitch, roll] degrees, g = [pitchGyro, rollGyro] in unknown units or null. Returns [vp, vr] in deg/s. */
export function rateStep(f, t, a, g) {
  const dt = (t - f.t) / 1000, out = [0, 0];
  for (let i = 0; i < 2; i++) {
    if (f.t && dt > 0.003 && dt < 0.12) {
      const raw = (a[i] - f.a[i]) / dt;
      f.fd[i] += (raw - f.fd[i]) * 0.55;
      if (g && isFinite(g[i]) && (Math.abs(raw) > 4 || Math.abs(g[i]) > 0.07)) {   // only learn while it is actually moving
        const d = 0.992; f.sxy[i] = f.sxy[i] * d + raw * g[i]; f.sxx[i] = f.sxx[i] * d + g[i] * g[i]; f.syy[i] = f.syy[i] * d + raw * raw;
        if (f.sxx[i] > 1e-6 && f.syy[i] > 1) {
          const k = f.sxy[i] / f.sxx[i], r2 = (f.sxy[i] * f.sxy[i]) / (f.sxx[i] * f.syy[i]), m = Math.abs(k);
          f.k[i] = k; f.ok[i] = r2 > 0.55 && ((m > 0.6 && m < 1.7) || (m > 35 && m < 95));   // deg/s, or rad/s (x57.3)
        }
      }
    } else if (!f.t || dt >= 0.12) f.fd[i] = 0;
    out[i] = f.ok[i] && g && isFinite(g[i]) ? f.k[i] * g[i] : f.fd[i];
  }
  f.t = t; f.a = [a[0], a[1]];
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

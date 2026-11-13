// Joining the line smoothly: the glider starts 18 m below and 18 m beside the line, the pilot steers toward it the way a
// person would (0.25 s late, a bit short), and we measure the sharpest jolt on the way in: peak change of climb rate,
// peak pitch and turn rates, compared with the same pilot and no help at all ('off'). A smooth join looks like 'off'.
// Needs: npx vite --port 5173. Run: node test/guide-join.cjs
const { chromium } = require('playwright');
(async () => {
  const b = await chromium.launch(); const pg = await b.newPage({ viewport: { width: 320, height: 240 } }); const errs = [];
  pg.on('pageerror', e => errs.push(e.message));
  await pg.addInitScript(() => { window.requestAnimationFrame = () => 0; localStorage.setItem('flyer.control', '"simple"'); localStorage.setItem('flyer.track', '"gorge"'); });
  await pg.goto('http://localhost:5173/?debug&fx=0'); await pg.waitForFunction(() => window.__game, null, { polling: 200, timeout: 60000 });
  for (const lvl of ['off', 'easy', 'normal', 'pro']) for (const startAt of [600, 1500, 2600]) {
    const r = await pg.evaluate(([lvl, startAt]) => {
      const g = window.__game, G = g.G; g.settings.guide = 'easy'; g.settings.control = 'simple'; g.start(); g.settings.control = 'phone'; g.settings.guide = lvl; G.state = 'play';
      const P = G.pos.clone(); for (let i = 0; i < 60 * 30 && G.s < startAt; i++) { G.bot = 'follow'; g.update(1 / 60); }
      G.pos.y -= 18; g.routePoint(G.s, P); G.pos.x += 18 * Math.cos(G.yaw); G.pos.z -= 18 * Math.sin(G.yaw); G.lock = 0; G.helpYaw = G.helpPitch = 0;
      const hist = [], c0 = G.crashes; let vyP = null, ayMax = 0, prMax = 0, yrMax = 0, joined = -1, yP = G.pos.y, pP = G.pitch, wP = G.yaw;
      for (let i = 0; i < 60 * 8; i++) {
        g.routePoint(Math.min(g.LEN, G.s + 70), P); const dx = P.x - G.pos.x, dz = P.z - G.pos.z, dy = P.y - G.pos.y, hd = Math.hypot(dx, dz) || 1;
        let a = Math.atan2(-dx, -dz) - G.yaw; while (a > Math.PI) a -= 2 * Math.PI; while (a < -Math.PI) a += 2 * Math.PI;
        hist.push([Math.max(-1, Math.min(1, (Math.atan2(dy, hd) + 0.1) / 0.78)), Math.max(-1, Math.min(1, a * 2.2))]);
        const h = hist[Math.max(0, hist.length - 15)]; G.bot = { p: h[0] * 0.85, t: h[1] * 0.85 };
        g.update(1 / 60); const vy = (G.pos.y - yP) * 60; yP = G.pos.y;
        if (G.crashT > 0 || G.rescueT > 0 || G.crashes > c0) { vyP = null; pP = G.pitch; wP = G.yaw; i = i; if (G.crashes > c0) break; continue; }
        if (vyP != null && i > 2) ayMax = Math.max(ayMax, Math.abs(vy - vyP) * 60); vyP = vy;
        if (i > 2) { prMax = Math.max(prMax, Math.abs(G.pitch - pP) * 60 * 57.3); let d = G.yaw - wP; while (d > Math.PI) d -= 2 * Math.PI; while (d < -Math.PI) d += 2 * Math.PI; yrMax = Math.max(yrMax, Math.abs(d) * 60 * 57.3); }
        pP = G.pitch; wP = G.yaw; if (joined < 0 && G.lineOff < 4) joined = i / 60;
      }
      G.bot = null; return { crashed: G.crashes > c0, ay: ayMax.toFixed(0), pr: prMax.toFixed(0), yr: yrMax.toFixed(0), joined: joined < 0 ? 'not within 8 s' : joined.toFixed(1) + ' s' };
    }, [lvl, startAt]);
    console.log(`${lvl.padEnd(6)} from ${String(startAt).padStart(4)} m: sharpest climb-rate jolt ${r.ay.padStart(3)} m/s²  peak pitch rate ${r.pr.padStart(3)}°/s  peak turn rate ${r.yr.padStart(3)}°/s  within 4 m of the line after ${r.joined}${r.crashed ? '  (hit the ground, stopped)' : ''}`);
  }
  console.log('errors:', errs.length ? errs : 'none'); await b.close();
})();

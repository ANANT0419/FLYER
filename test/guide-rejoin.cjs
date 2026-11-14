// Coming back to the line the way the owner does in the recorded flights (round 6: "once the player is off track and
// tries to go back, so many sudden moments"): the glider starts far off (above, below, beside), the pilot steers
// almost straight at the line, a quarter of a second late, and only levels out once it is reached. test/guide-join.cjs
// flies a tidy pilot who already follows the ideal curve; this one dives at the line like a person.
// Measured: how hard the help itself kicks (fastest change of the added pitch, in degrees per second; of the added
// turn rate; of the sideways pull, in m/s²), the sharpest jolt of the whole flight path (m/s²), how far the glider
// shoots past the line, and when it has settled on it. 'off' = the same pilot with no help.
// Needs: npx vite --port 5173. Run: node test/guide-rejoin.cjs [gorge|coaster]
const { chromium } = require('playwright');
const TRACK = process.argv[2] || 'coaster';
(async () => {
  const b = await chromium.launch(); const pg = await b.newPage({ viewport: { width: 320, height: 240 } }); const errs = [];
  pg.on('pageerror', e => errs.push(e.message));
  await pg.addInitScript(t => { window.requestAnimationFrame = () => 0; localStorage.setItem('flyer.control', '"simple"'); localStorage.setItem('flyer.track', JSON.stringify(t)); }, TRACK);
  await pg.goto('http://localhost:5173/?debug&fx=0'); await pg.waitForFunction(() => window.__game, null, { polling: 200, timeout: 60000 });
  const cases = [['60 m above', 60, 0], ['40 m below', -40, 0], ['40 m beside', 0, 40], ['30 up, 30 beside', 30, 30]];
  const worst = {};
  for (const lvl of ['off', 'easy', 'normal', 'pro']) for (const [name, up, side] of cases) for (const startAt of [700, 2400]) {
    const r = await pg.evaluate(([lvl, up, side, startAt]) => {
      const g = window.__game, G = g.G; g.settings.guide = 'easy'; g.settings.control = 'simple'; g.start(); g.settings.control = 'phone'; g.settings.guide = lvl; G.state = 'play';
      const P = G.pos.clone(); for (let i = 0; i < 60 * 40 && G.s < startAt; i++) { G.bot = 'follow'; g.update(1 / 60); }
      G.pos.y += up; G.pos.x += side * Math.cos(G.yaw); G.pos.z -= side * Math.sin(G.yaw); G.lock = 0; G.helpYaw = G.helpPitch = 0; G.invuln = 30;
      for (const k of ['help', 'ign', 'offV', 'eV']) if (k in G) G[k] = 0; if (G.pullV) G.pullV.set(0, 0, 0);
      const hist = [], pos = [], c0 = G.crashes; let hpP = 0, hyP = 0, dHp = 0, dHy = 0, aMax = 0, aSum = 0, n = 0, reached = -1, over = 0, settled = -1, lastBad = 0, okFor = 0, flips = 0, lkP = 0, lkDir = 0;
      for (let i = 0; i < 60 * 9; i++) {
        // the person: aims at the line a short way ahead (steep), late; once there, flies the line's own needs
        g.routePoint(Math.min(g.LEN, G.s + 30), P); const dx = P.x - G.pos.x, dz = P.z - G.pos.z, dy = P.y - G.pos.y, hd = Math.hypot(dx, dz) || 1;
        let a = Math.atan2(-dx, -dz) - G.yaw; while (a > Math.PI) a -= 2 * Math.PI; while (a < -Math.PI) a += 2 * Math.PI;
        const homing = [Math.max(-1, Math.min(1, (Math.atan2(dy, hd) + 0.1) / 0.78)), Math.max(-1, Math.min(1, a * 1.6))];
        hist.push(reached >= 0 ? [G.needP || 0, G.needT || 0] : homing);
        const h = hist[Math.max(0, hist.length - 16)]; G.bot = { p: h[0], t: h[1] };
        g.update(1 / 60); if (G.crashes > c0) break;
        pos.push(G.pos.clone()); const m = pos.length;
        if (m > 2) { const acc = pos[m - 1].clone().addScaledVector(pos[m - 2], -2).add(pos[m - 3]).length() * 3600; aMax = Math.max(aMax, acc); aSum += acc * acc; n++; }
        if (i > 0) { dHp = Math.max(dHp, Math.abs(G.helpPitch - hpP) * 60 * 57.3); dHy = Math.max(dHy, Math.abs(G.helpYaw - hyP) * 60 * 57.3); }
        hpP = G.helpPitch; hyP = G.helpYaw;
        const d = G.lock - lkP; if (Math.abs(d) > 0.004) { const s = Math.sign(d); if (lkDir && s !== lkDir) flips++; lkDir = s; } lkP = G.lock;
        if (reached < 0 && G.lineOff < 10) reached = i / 60;
        if (reached >= 0 && i / 60 < reached + 2.5) over = Math.max(over, G.lineOff);
        if (G.lineOff > 8) { lastBad = i / 60; okFor = 0; } else if (settled < 0 && ++okFor >= 60) settled = lastBad;
      }
      if (settled < 0) settled = 9; G.bot = null; G.invuln = 0;
      return { crashed: G.crashes > c0, dHp, dHy, aMax, aRms: Math.sqrt(aSum / Math.max(1, n)), reached, over, settled, flips };
    }, [lvl, up, side, startAt]);
    const w = worst[lvl] = worst[lvl] || { dHp: 0, dHy: 0, aMax: 0, aRms: 0, over: 0, settled: 0, flips: 0, never: 0, n: 0 };
    for (const k of ['dHp', 'dHy', 'aMax', 'over', 'settled']) w[k] = Math.max(w[k], r[k]); w.aRms += r.aRms; w.setSum = (w.setSum || 0) + r.settled; w.overSum = (w.overSum || 0) + r.over; w.flips += r.flips; w.n++; if (r.reached < 0) w.never++;
    console.log(`${lvl.padEnd(6)} ${name.padEnd(17)} at ${String(startAt).padStart(4)} m: help kick pitch ${r.dHp.toFixed(0).padStart(3)}°/s turn ${r.dHy.toFixed(0).padStart(3)}°/s²  path jolt ${r.aMax.toFixed(0).padStart(4)} (typical ${r.aRms.toFixed(0).padStart(3)}) m/s²  reached ${r.reached < 0 ? 'never' : r.reached.toFixed(1) + ' s'}  shot past by ${r.over.toFixed(0).padStart(3)} m  on the line to stay (within 8 m for a second) from ${r.settled.toFixed(1)} s  help on/off flips ${r.flips}${r.crashed ? '  (crashed)' : ''}`);
  }
  console.log('\nworst case per level:');
  for (const [lvl, w] of Object.entries(worst)) console.log(`${lvl.padEnd(6)} help kick pitch ${w.dHp.toFixed(0)}°/s, turn ${w.dHy.toFixed(0)}°/s²; path jolt ${w.aMax.toFixed(0)} m/s² (typical ${(w.aRms / w.n).toFixed(0)}); shot past by ${(w.overSum / w.n).toFixed(0)} m on average (worst ${w.over.toFixed(0)}); on the line to stay after ${(w.setSum / w.n).toFixed(1)} s on average (worst ${w.settled.toFixed(1)}); help on/off flips ${w.flips} in ${w.n} runs; never reached: ${w.never}`);
  console.log('errors:', errs.length ? errs : 'none'); await b.close();
})();

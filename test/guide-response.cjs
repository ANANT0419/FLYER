// Does the glider still answer every tilt while the guided line is helping? A pilot flies on the line, then turns
// 0.3 of full tilt harder for 0.3 s. We compare how far the heading moves against the same move with no help at all
// (100% = the glider follows your tilt exactly as if the line were not there). Also checks pitch.
// Needs: npx vite --port 5173. Run: node test/guide-response.cjs
const { chromium } = require('playwright');
(async () => {
  const b = await chromium.launch(); const pg = await b.newPage({ viewport: { width: 320, height: 240 } }); const errs = [];
  pg.on('pageerror', e => errs.push(e.message));
  await pg.addInitScript(() => { window.requestAnimationFrame = () => 0; localStorage.setItem('flyer.control', '"phone"'); localStorage.setItem('flyer.track', '"gorge"'); });
  await pg.goto('http://localhost:5173/?debug&fx=0'); await pg.waitForFunction(() => window.__game, null, { polling: 200, timeout: 60000 });
  const fly = (lvl, stepLvl, axis, step, T0) => pg.evaluate(([lvl, stepLvl, axis, step, T0]) => {
    const g = window.__game, G = g.G; g.settings.guide = lvl; g.settings.control = 'simple'; g.start(); G.state = 'play';
    for (let i = 0; i < T0 * 60; i++) { G.bot = 'follow'; g.update(1 / 60); }
    const lock = G.lock; g.settings.guide = stepLvl; const y0 = G.yaw, p0 = G.pos.y;
    const np = G.needP, nt = G.needT;   // hold the tilt the line wanted at that moment, plus the extra move
    for (let i = 0; i < 18; i++) { G.bot = { p: np + (axis === 'p' ? step : 0), t: nt + (axis === 't' ? step : 0) }; g.update(1 / 60); }
    G.bot = null; return { lock, dyaw: G.yaw - y0, dy: G.pos.y - p0 };
  }, [lvl, stepLvl, axis, step, T0]);
  for (const lvl of ['easy', 'normal', 'pro']) {
    const out = [];
    for (const T0 of [8, 14, 20]) for (const [axis, key] of [['t', 'dyaw'], ['p', 'dy']]) {
      const base = await fly(lvl, lvl, axis, 0, T0), moved = await fly(lvl, lvl, axis, 0.3, T0);
      const freeBase = await fly(lvl, 'off', axis, 0, T0), freeMoved = await fly(lvl, 'off', axis, 0.3, T0);
      out.push({ axis, lock: base.lock, pct: (moved[key] - base[key]) / (freeMoved[key] - freeBase[key]) * 100 });
    }
    const avg = a => Math.round(out.filter(o => o.axis === a).reduce((s, o) => s + o.pct, 0) / 3);
    console.log(`${lvl.padEnd(7)} on the line (lock ${out.map(o => o.lock.toFixed(2))[0]}): a quick extra turn shows ${avg('t')}%, a quick extra climb shows ${avg('p')}%`);
  }
  console.log('errors:', errs.length ? errs : 'none'); await b.close();
})();

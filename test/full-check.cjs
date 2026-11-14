// Full check of the game without a GPU: flies every course with a keyboard-style and a phone-style pilot on each guide
// level, frame by frame as the game loop does (flight, camera, scenery, HUD), and checks:
//  - the camera looks at the glider every frame and stays close behind it (last round's bug: it stopped turning)
//  - nothing becomes NaN, no errors are thrown, the issue log stays free of frame errors
//  - the glider follows the line with a decent pilot, and how much the view and the glider wobble
// Also: the tutorial, pause/resume and back to the menu. Needs: npx vite --port 5173. Run: node test/full-check.cjs
const { chromium } = require('playwright');
const fails = []; const fail = m => { fails.push(m); console.log('  FAIL', m); };
(async () => {
  const b = await chromium.launch();
  const open = async track => {
    const pg = await b.newPage({ viewport: { width: 640, height: 360 } }); pg.errs = []; pg.on('pageerror', e => pg.errs.push(e.message));
    await pg.addInitScript(t => { window.requestAnimationFrame = () => 0; localStorage.setItem('flyer.control', '"simple"'); localStorage.setItem('flyer.track', JSON.stringify(t)); }, track);
    await pg.goto('http://localhost:5173/?debug&fx=0'); await pg.waitForFunction(() => window.__game, null, { polling: 200, timeout: 60000 }); return pg;
  };
  for (const track of ['gorge', 'coaster', 'race', 'sky']) {
    const pg = await open(track);
    for (const control of ['simple', 'phone']) for (const lvl of ['easy', 'normal', 'pro']) {
      const r = await pg.evaluate(([control, lvl, race]) => {
        const g = window.__game, G = g.G, cam = g.camera; g.settings.control = 'simple'; g.settings.guide = lvl;
        if (race) g.beginRace(true); else g.start(); g.settings.control = control; G.state = 'play'; g.snapCam();   // start first: phone controls would open pairing
        const P = cam.position.clone(), fwd = cam.position.clone(), to = cam.position.clone(); const hist = [];
        let maxAim = 0, maxDist = 0, nan = 0, n = 0, on = 0, wob = 0, rp = [G.roll, G.roll], vs = 0, qPrev = cam.quaternion.clone(), wPrev = null, t = 0, frames = 0;
        let seed = 9; const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647) * 2 - 1; const nz = [0, 0];
        for (let i = 0; i < 60 * 40 && (G.state === 'play' || G.state === 'count'); i++) {
          if (G.state === 'count') G.state = 'play';
          g.routePoint(Math.min(g.LEN, G.s + 70), P); const dx = P.x - G.pos.x, dz = P.z - G.pos.z, dy = P.y - G.pos.y, hd = Math.hypot(dx, dz) || 1;
          let a = Math.atan2(-dx, -dz) - G.yaw; while (a > Math.PI) a -= 2 * Math.PI; while (a < -Math.PI) a += 2 * Math.PI;
          hist.push([Math.max(-1, Math.min(1, (Math.atan2(dy, hd) + 0.1) / 0.78)), Math.max(-1, Math.min(1, a * 2.2))]);
          const h = hist[Math.max(0, hist.length - 15)]; nz[0] += (rnd() * 0.06 - nz[0]) * 0.08; nz[1] += (rnd() * 0.06 - nz[1]) * 0.08;
          G.bot = { p: h[0] * 0.85 + nz[0], t: h[1] * 0.85 + nz[1] };
          const dt = 1 / 60; t += dt; g.update(dt); g.updateCamera(dt, false); g.updateVisuals(dt, t); g.updateHUD(); n++;
          if (![G.pos.x, G.pos.y, G.pos.z, G.yaw, G.pitch, G.roll, G.speed, cam.position.x].every(Number.isFinite)) nan++;
          if (G.crashT > 0 || G.rescueT > 0) continue;
          cam.getWorldDirection(fwd); to.copy(G.pos).sub(cam.position); const dist = to.length(); to.normalize();
          maxAim = Math.max(maxAim, Math.acos(Math.max(-1, Math.min(1, fwd.dot(to)))) * 180 / Math.PI); maxDist = Math.max(maxDist, dist); frames++;
          on += G.onLine > 0.5 ? 1 : 0; wob += (G.roll - 2 * rp[1] + rp[0]) ** 2; rp = [rp[1], G.roll];
          const q = qPrev.clone().invert().multiply(cam.quaternion), ang = 2 * Math.acos(Math.min(1, Math.abs(q.w))), s = Math.sqrt(1 - q.w * q.w) || 1;
          const w = [q.x / s * ang, q.y / s * ang, q.z / s * ang].map(x => x * 180 / Math.PI); if (wPrev) vs += (w[0] - wPrev[0]) ** 2 + (w[1] - wPrev[1]) ** 2 + (w[2] - wPrev[2]) ** 2; wPrev = w; qPrev = cam.quaternion.clone();
        }
        G.bot = null; const log = document.getElementById('issuePanel').textContent;
        // if the run stops in the middle of a crash (speed is 0 for that second by design), fly on until it is over before reading the speed
        for (let i = 0; i < 240 && G.state === 'play' && (G.crashT > 0 || G.rescueT > 0 || G.speed < 1); i++) { g.update(1 / 60); g.updateHUD(); }
        return { end: G.state, s: Math.round(G.s), n, frames, maxAim: maxAim.toFixed(1), maxDist: maxDist.toFixed(1), nan, on: Math.round(on / Math.max(1, frames) * 100), wob: (Math.sqrt(wob / frames) * 180 / Math.PI).toFixed(3), vs: Math.sqrt(vs / frames).toFixed(3), crashes: G.crashes, speedText: document.getElementById('speed').textContent, frameErr: /Frame/.test(log) };
      }, [control, lvl, track === 'race' || track === 'sky']);
      console.log(`${track.padEnd(7)} ${(control === 'phone' ? 'phone' : 'keys').padEnd(5)} ${lvl.padEnd(6)} camera aim ≤ ${r.maxAim.padStart(4)}°  distance ≤ ${r.maxDist} m  on the line ${String(r.on).padStart(3)}%  glider wobble ${r.wob}  view shake ${r.vs}  crashes ${r.crashes}  speed shown ${r.speedText}  frames ${r.n} state ${r.end} at ${r.s} m`);
      if (+r.maxAim > 25) fail(`${track}/${control}/${lvl}: camera points ${r.maxAim}° away from the glider`);
      if (+r.maxDist > 40) fail(`${track}/${control}/${lvl}: camera ${r.maxDist} m from the glider`);
      if (r.nan) fail(`${track}/${control}/${lvl}: ${r.nan} frames with broken numbers`);
      if (r.frameErr) fail(`${track}/${control}/${lvl}: frame error in the issue log`);
      if (!/^\d+$/.test(r.speedText) || r.speedText === '0') fail(`${track}/${control}/${lvl}: speed display '${r.speedText}'`);
      if (r.n < 1000) fail(`${track}/${control}/${lvl}: flight did not run (${r.n} frames)`);
      if (lvl === 'easy' && r.on < 60) fail(`${track}/${control}/${lvl}: a decent pilot only ${r.on}% on the line on Easy`);
    }
    if (pg.errs.length) fail(`${track}: page errors ${pg.errs.slice(0, 3)}`);
    await pg.close();
  }
  // tutorial, pause/resume, menu
  const pg = await open('gorge');
  const t = await pg.evaluate(() => { const g = window.__game, G = g.G; g.settings.control = 'simple'; g.startTutorial(); const mode = G.mode, st = G.state;
    for (let i = 0; i < 600; i++) { G.bot = { p: 0, t: 0 }; g.update(1 / 60); g.updateCamera(1 / 60, false); g.updateVisuals(1 / 60, i / 60); g.updateHUD(); }
    g.pause(); const paused = G.state; g.resume(); const resumed = G.state; g.toMenu(); return { mode, st, paused, resumed, menu: G.state, coach: document.getElementById('coach').innerText.slice(0, 60) }; });
  console.log('tutorial:', JSON.stringify(t));
  if (t.mode !== 'tut' || t.paused !== 'paused' || t.resumed !== 'play' || t.menu !== 'menu') fail('tutorial / pause / menu flow: ' + JSON.stringify(t));
  if (pg.errs.length) fail('tutorial: page errors ' + pg.errs.slice(0, 3));
  console.log(fails.length ? `\n${fails.length} problem(s) found` : '\nall checks passed');
  await b.close(); process.exit(fails.length ? 1 : 0);
})();

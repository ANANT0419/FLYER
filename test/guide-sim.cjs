// Flies the course with scripted pilots on each guide level, without drawing (no GPU here), and reports how the
// guided line behaves. Needs the dev server: npx vite --port 5173. Run: node test/guide-sim.cjs [gorge|coaster|race]
const { chromium } = require('playwright');
const TRACK = process.argv[2] || 'gorge', RACE = TRACK === 'race';
(async () => {
  const b = await chromium.launch(); const pg = await b.newPage({ viewport: { width: 320, height: 240 } });
  const errs = []; pg.on('pageerror', e => errs.push(e.message));
  await pg.addInitScript(race => { window.requestAnimationFrame = () => 0; localStorage.setItem('flyer.control', '"simple"'); localStorage.setItem('flyer.track', JSON.stringify(race)); }, TRACK);
  await pg.goto('http://localhost:5173/?debug&fx=0'); await pg.waitForFunction(() => window.__game, null, { polling: 100, timeout: 30000 });
  const pilots = {
    'hands off': 'none',
    'good (0.25 s reaction)': { lag: 15, gain: 0.95, noise: 0.05 },
    'rough (0.4 s, 70%, shaky)': { lag: 24, gain: 0.7, noise: 0.2 },
    'sloppy (0.6 s, 50%, very shaky)': { lag: 36, gain: 0.5, noise: 0.35 },
  };
  console.log({ gorge: 'Saffron Gorge', coaster: 'Skyline Coaster', race: 'Razorback Canyon' }[TRACK], '— up to 75 s of flying per run');
  for (const lvl of ['easy', 'normal', 'pro']) for (const [name, pl] of Object.entries(pilots)) {
    const r = await pg.evaluate(([lvl, pl, RACE]) => {
      const g = window.__game, G = g.G; g.settings.guide = lvl; if (RACE) g.beginRace(true); else g.start(); G.state = 'play';
      let seed = 3; const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647) * 2 - 1;
      const hist = []; let n = 0, lock = 0, on = 0, off = 0, spd = 0, crashes0 = G.crashes, nz = [0, 0];
      for (let i = 0; i < 60 * 75 && G.state === 'play' && G.s < g.FINISH_S - 5; i++) {
        hist.push([G.needP || 0, G.needT || 0]);
        if (pl === 'none') G.bot = { p: 0, t: 0 };
        else { const h = hist[Math.max(0, hist.length - 1 - pl.lag)]; nz[0] += (rnd() * pl.noise - nz[0]) * 0.1; nz[1] += (rnd() * pl.noise - nz[1]) * 0.1;
          G.bot = { p: h[0] * pl.gain + nz[0] * 3, t: h[1] * pl.gain + nz[1] * 3 }; }
        g.update(1 / 60); n++; lock += G.lock; on += G.onLine > 0.5 ? 1 : 0; off += G.lineOff; spd += G.speed * G.flow;
      }
      G.bot = null;
      return { t: (n / 60).toFixed(0), dist: Math.round(G.s), lock: (lock / n).toFixed(2), onLine: Math.round(on / n * 100) + '%', off: (off / n).toFixed(1), speed: Math.round(spd / n * 1.5), crashes: G.crashes - crashes0, pen: G.pen || 0 };
    }, [lvl, pl, RACE]);
    console.log(lvl.padEnd(7), name.padEnd(32), `on the line ${r.onLine.padStart(4)}  avg lock ${r.lock}  avg off ${r.off.padStart(5)} m  speed ${r.speed} km/h  ${r.dist} m in ${r.t} s  crashes ${r.crashes}${RACE ? '  penalty +' + r.pen + ' s' : ''}`);
  }
  console.log('errors:', errs.length ? errs.slice(0, 5) : 'none');
  await b.close();
})();

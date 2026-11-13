// Flight recorder: fly 30 s, crash once, quit to the menu, and check what would be sent to the database
// (the upload is intercepted here, since this sandbox cannot reach Supabase). Needs: npx vite --port 5173.
const { chromium } = require('playwright');
(async () => {
  const b = await chromium.launch(); const pg = await b.newPage({ viewport: { width: 320, height: 240 } }); const errs = []; let sent = null, headers = null;
  pg.on('pageerror', e => errs.push(e.message));
  await pg.route('**/rest/v1/flight_logs', async r => { sent = r.request().postData(); headers = r.request().headers(); await r.fulfill({ status: 201, body: '' }); });
  await pg.addInitScript(() => { window.requestAnimationFrame = () => 0; localStorage.setItem('flyer.control', '"simple"'); localStorage.setItem('flyer.track', '"gorge"'); });
  await pg.goto('http://localhost:5173/?debug&fx=0'); await pg.waitForFunction(() => window.__game, null, { polling: 200, timeout: 60000 });
  await pg.evaluate(() => { const g = window.__game, G = g.G; g.start(); let now = performance.now();
    for (let i = 0; i < 60 * 30; i++) { G.bot = i > 900 && i < 1000 ? { p: -1, t: 0 } : 'follow'; g.update(1 / 60); now += 16.7; g.recFrame(now, i === 500 ? 120 : 16.7, g.recSample); }
    G.bot = null; g.toMenu(); });
  await pg.waitForTimeout(1500);
  if (!sent) { console.log('FAIL: nothing was sent', errs); process.exit(1); }
  const d = JSON.parse(sent), n = d.data.cols.t.length;
  console.log('sent', (sent.length / 1024).toFixed(0), 'KB with apikey header:', !!headers.apikey, '· samples', n, '· columns', d.data.keys.join(','));
  console.log('meta:', JSON.stringify(d.meta).slice(0, 400));
  console.log('events:', JSON.stringify(d.data.events).slice(0, 300));
  const mdt = Math.max(...d.data.cols.mdt), lk = d.data.cols.lk.reduce((a, b) => a + b, 0) / n;
  console.log('longest frame recorded', mdt, 'ms (a 120 ms hitch was injected) · average lock', lk.toFixed(2));
  const ok = n > 550 && d.meta.result === 'quit' && mdt >= 120 && d.data.events.some(e => e[1] === 'crash' || e[1] === 'rescue') && !errs.length;
  console.log(ok ? 'recorder check passed' : 'FAIL recorder check', errs); await b.close(); process.exit(ok ? 0 : 1);
})();

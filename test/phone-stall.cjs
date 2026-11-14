// The phone goes silent in mid-flight (the owner's recordings show 1-3 s silences, twice followed by a crash).
// Two headless pages paired through a local PeerJS server; the phone page rolls steadily, then (1) its page is frozen
// for 1.3 s, (2) its messages are dropped for 1.3 s. Checked: the screen names the right cause, the tilt it flies with
// sags to level gradually instead of snapping (biggest change between two frames), and it stays in charge.
// Needs: npx vite --port 5173 and npx peerjs --port 9000 --host 127.0.0.1. Run: node test/phone-stall.cjs
const { chromium } = require('playwright');
(async () => {
  const o = { args: ['--disable-features=WebRtcHideLocalIpsWithMdns'] }, b = await chromium.launch(o), b2 = await chromium.launch(o);
  const ctx = await b.newContext({ viewport: { width: 320, height: 240 } }), ctx2 = await b2.newContext({ viewport: { width: 390, height: 700 } });
  const scr = await ctx.newPage(), errs = []; scr.on('pageerror', e => errs.push('screen: ' + e.message));
  await scr.addInitScript(() => { window.requestAnimationFrame = () => 0; });
  await ctx2.addInitScript(() => { const send = RTCDataChannel.prototype.send; RTCDataChannel.prototype.send = function (m) { if (!window.__drop) try { send.call(this, m); } catch (_) {} }; });
  await scr.goto('http://localhost:5173/?sig=127.0.0.1:9000&fx=0&debug'); await scr.waitForTimeout(1500);
  await scr.evaluate(() => document.querySelector('.ctlcard[data-ctl="phone"]').click()); await scr.waitForFunction(() => window.__pad && window.__pad.phone.url, null, { timeout: 15000, polling: 100 });
  const pad = await ctx2.newPage(); pad.on('pageerror', e => errs.push('pad: ' + e.message));
  await pad.goto(await scr.evaluate(() => window.__pad.phone.url)); await pad.click('#padGo');
  await scr.waitForFunction(() => window.__pad.phone.status === 'connected', null, { timeout: 20000, polling: 100 });
  await scr.evaluate(() => { const P = window.__pad; window.__log = []; let pL = 0; setInterval(() => { P.updatePhone(performance.now()); window.__log.push([performance.now(), P.phone.L, Math.abs(P.phone.L - pL), P.phone.live ? 1 : 0, P.phone.hold ? 1 : 0]); pL = P.phone.L; }, 16); });
  // a steady 22 degree roll with a slow sway, like holding a turn
  await pad.evaluate(() => { const t0 = performance.now(); setInterval(() => { const t = (performance.now() - t0) / 1000;
    window.dispatchEvent(new DeviceMotionEvent('devicemotion', { rotationRate: { alpha: 0, beta: 0, gamma: 3 * Math.cos(t) } }));
    window.dispatchEvent(new DeviceOrientationEvent('deviceorientation', { alpha: 0, beta: 0, gamma: 22 * Math.min(1, t) + 3 * Math.sin(t) })); }, 1000 / 60); });
  await scr.waitForTimeout(3000);
  let bad = 0;
  for (const [name, how, want] of [['phone page frozen 1.3 s', () => pad.evaluate(() => { const e = performance.now() + 1300; while (performance.now() < e); }), 'browser paused'],
    ['messages dropped 1.3 s', async () => { await pad.evaluate(() => { window.__drop = 1; }); await pad.waitForTimeout(1300); await pad.evaluate(() => { window.__drop = 0; }); }, 'network']]) {
    await scr.evaluate(() => { window.__log.length = 0; window.__pad.phone.stalls.length = 0; });
    await how(); await scr.waitForTimeout(2500);
    const r = await scr.evaluate(() => { const L = window.__log; let jump = 0, minL = 9, notLive = 0, lost = 0; for (const [, l, d, live, hold] of L) { jump = Math.max(jump, d); minL = Math.min(minL, Math.abs(l)); if (!live) notLive++; if (!hold) lost++; }
      return { jump, minL, notLive: notLive * 16, lost, before: Math.abs(L[0][1]), after: Math.abs(L[L.length - 1][1]), stalls: window.__pad.phone.stalls.slice() }; });
    const ok = r.stalls.length === 1 && r.stalls[0][1].includes(want) && r.jump < 0.12 && r.lost === 0 && Math.abs(r.after - r.before) < 0.15;
    if (!ok) bad++;
    console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}: screen saw ${r.stalls.map(s => s[0] + ' ms, ' + s[1]).join('; ') || 'no stall'} · turn tilt ${r.before.toFixed(2)} sagged to ${r.minL.toFixed(2)} and came back to ${r.after.toFixed(2)} · biggest change in one frame ${r.jump.toFixed(3)} (a snap to level would be ${r.before.toFixed(2)}) · without readings for ${r.notLive} ms · control handed away for ${r.lost} frames`);
  }
  console.log('errors:', errs.length ? errs : 'none', bad ? '· ' + bad + ' problem(s)' : '· phone stall check passed'); await b.close(); await b2.close(); process.exit(bad ? 1 : 0);
})();

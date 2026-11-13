// Phone glider end to end in two headless pages: pairs through a local PeerJS server, feeds the phone page a rolling
// motion, and measures how far the big screen's dial trails the phone (both clocks put on one timeline with timeOrigin).
const { chromium } = require('playwright');
(async () => {
  const o = { args: ['--disable-features=WebRtcHideLocalIpsWithMdns'] }, b = await chromium.launch(o), b2 = await chromium.launch(o); const ctx = await b.newContext({ viewport: { width: 320, height: 240 } }), ctx2 = await b2.newContext();   // two browsers, so neither page is a throttled background tab
  const scr = await ctx.newPage();
  // no GPU here: one frame takes about a second and blocks everything, so stop the game's frame loop and drive the phone link from a timer instead
  await scr.addInitScript(() => { window.requestAnimationFrame = () => 0; });
  // DELAY=ms adds that much network delay each way (both pages hold every data-channel message back)
  const lag = +process.env.DELAY || 0;
  const slow = d => { const send = RTCDataChannel.prototype.send; RTCDataChannel.prototype.send = function (m) { setTimeout(() => { try { send.call(this, m); } catch (_) {} }, d); }; };
  if (lag) { await scr.addInitScript(slow, lag); await ctx2.addInitScript(slow, lag); } const errs = []; scr.on('pageerror', e => errs.push('screen: ' + e.message));
  await scr.goto('http://localhost:5173/?sig=127.0.0.1:9000&fx=0&debug'); await scr.waitForTimeout(1500);
  await scr.evaluate(() => document.querySelector('.ctlcard[data-ctl="phone"]').click()); await scr.waitForFunction(() => window.__pad && window.__pad.phone.url, null, { timeout: 15000, polling: 100 });
  const url = await scr.evaluate(() => window.__pad.phone.url);
  const pad = await ctx2.newPage(); pad.on('pageerror', e => errs.push('pad: ' + e.message));
  await pad.goto(url); await pad.click('#padGo');
  await scr.waitForFunction(() => window.__pad && window.__pad.phone.status === 'connected', null, { timeout: 20000, polling: 100 });
  await scr.evaluate(() => setInterval(() => window.__pad.updatePhone(performance.now()), 16));
  const W = 2 * Math.PI * 0.8;
  const padT0 = await pad.evaluate(W => { const t0 = performance.timeOrigin + performance.now();
    setInterval(() => { const t = (performance.timeOrigin + performance.now() - t0) / 1000, g = 20 * Math.sin(W * t), gr = 20 * W * Math.cos(W * t);   // deg/s, as phones report it
      window.dispatchEvent(new DeviceMotionEvent('devicemotion', { rotationRate: { alpha: 0, beta: 0, gamma: gr } }));
      window.dispatchEvent(new DeviceOrientationEvent('deviceorientation', { alpha: 0, beta: 0, gamma: g })); }, 1000 / 60); return t0; }, W);
  await scr.waitForTimeout(3500);
  // sample the screen's estimate of the phone roll "right now" (latest reading carried forward by its age, link.js)
  // at 200 Hz from a timer, since the page itself renders at ~1 frame a second here without a GPU
  const run = mode => scr.evaluate(mode => new Promise(res => { const out = [], P = window.__pad; const end = performance.now() + 4000;
    const iv = setInterval(() => { const now = performance.now(); let v;
      if (mode === 'raw') v = P.st.r; else v = P.predict(P.st, now, 0, 160, 18)[1];
      out.push([performance.timeOrigin + now, v]); if (now > end) { clearInterval(iv); res({ out, clock: P.clock, ms: P.phone.ms }); } }, 5); }), mode);
  const fit = samples => { let best = 0, bestE = 1e18; for (let lag = -150; lag <= 300; lag += 1) { let e = 0; for (const [t, v] of samples) e += (v - 20 * Math.sin(W * (t - lag - padT0) / 1000)) ** 2; if (e < bestE) { bestE = e; best = lag; } } return [best, Math.sqrt(bestE / samples.length).toFixed(2)]; };
  const raw = await run('raw'), pred = await run('pred');
  console.log('clock sync:', JSON.stringify(pred.clock), 'one-way delay estimate', pred.ms.toFixed(1), 'ms');
  console.log('last reading as received trails the phone by', fit(raw.out)[0], 'ms (rms', fit(raw.out)[1], 'deg)');
  console.log('with prediction it trails by', fit(pred.out)[0], 'ms (rms', fit(pred.out)[1], 'deg), over', pred.out.length, 'samples');
  console.log('phone check:', await scr.evaluate(() => { const p = window.__pad.phone; return [p.via, Math.round(p.ms) + ' ms', p.hz + ' readings/s', 'gyro ' + p.gyro].join(' · '); }));
  console.log('errors:', errs.length ? errs : 'none');
  await b.close(); await b2.close();
})();

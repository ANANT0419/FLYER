// Two tabs in one room (same-browser stand-in for the race service): the host's guide level must reach the guest.
// Needs: FAKE_RT=1 npx vite --port 5174. Run: node test/race-guide.cjs
const { chromium } = require('playwright');
(async () => {
  const b = await chromium.launch(); const ctx = await b.newContext({ viewport: { width: 800, height: 600 } }); const errs = [];
  const open = async (url, lvl, name) => { const p = await ctx.newPage(); p.on('pageerror', e => errs.push(name + ': ' + e.message));
    await p.addInitScript(([lvl, name]) => { window.requestAnimationFrame = () => 0; localStorage.setItem('flyer.control', '"simple"'); localStorage.setItem('flyer.track', '"race"'); localStorage.setItem('flyer.guide', JSON.stringify(lvl)); localStorage.setItem('flyer.name', JSON.stringify(name)); }, [lvl, name]);
    await p.goto(url); await p.waitForFunction(() => window.__game, null, { polling: 200, timeout: 60000 }); return p; };
  const host = await open('http://localhost:5174/?debug', 'pro', 'Host');
  await host.evaluate(() => { window.__game.start(); document.getElementById('rCreate').click(); });
  await host.waitForFunction(() => !document.getElementById('rIn').hidden, null, { polling: 200, timeout: 15000 });
  const code = await host.textContent('#rRoom');
  const guest = await open('http://localhost:5174/?debug&room=' + code, 'easy', 'Guest');
  await guest.waitForFunction(() => !document.getElementById('rIn').hidden && document.querySelectorAll('#rPlayers li').length === 2, null, { polling: 200, timeout: 15000 });
  await guest.waitForTimeout(1500);
  console.log('host lobby :', await host.textContent('#rGuide'));
  console.log('guest lobby:', await guest.evaluate(() => { const ul = document.getElementById('rPlayers'); return document.getElementById('rGuide').textContent; }));
  await host.evaluate(() => document.getElementById('rStart').click());
  await guest.waitForFunction(() => window.__game.G.mode === 'race' && window.__game.G.state !== 'menu', null, { polling: 200, timeout: 15000 });
  console.log('guest flies with:', await guest.evaluate(() => window.__game.guideLevel()), '(own setting', await guest.evaluate(() => window.__game.settings.guide) + ')');
  console.log('host flies with :', await host.evaluate(() => window.__game.guideLevel()));
  console.log('errors:', errs.length ? errs : 'none');
  await b.close();
})();

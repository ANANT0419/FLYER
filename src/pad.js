// Phone glider, phone side. Opened by scanning the code on the big screen (?pad=CODE).
import { Peer } from 'peerjs';
import { peerOptions, padId } from './link.js';
import { joinRelay } from './relay.js';

export function startPad(code) {
  document.title = 'Flyer glider';
  document.documentElement.classList.add('padmode');
  document.body.innerHTML = `
  <main class="padpage" id="pad">
    <div class="padtop"><span class="eyebrow">Flyer · phone glider</span><span class="padstat" id="padStat">Not connected</span></div>
    <div class="padstage" id="padStage">
      <div class="paddial"><div class="padhorizon"></div><div class="padwing" id="padWing"><i></i></div></div>
      <div class="padhint" id="padHint">Hold the phone flat, screen up, top edge pointing at the big screen.</div>
      <button class="primary-btn padgo" id="padGo">Tap to connect</button>
      <div class="padboost" id="padBoost" hidden>TAP TO BOOST</div>
    </div>
    <div class="padbar"><button class="secondary" id="padLevel" disabled>Set level</button><span class="small" id="padNums"></span></div>
  </main>`;
  const $ = id => document.getElementById(id);
  let peer = null, conn = null, b0 = null, g0 = null, beta = 0, gamma = 0, curP = 0, curR = 0, started = false, wake = null, gotSensor = false;
  let relay = null, relayUp = false, beat = 0;
  const up = () => (conn && conn.open) || relayUp;
  const send = d => { if (conn && conn.open) { try { conn.send(d); } catch (_) {} } else if (relayUp) relay.send(d); };
  function linked(kind) { stat(kind === 'relay' ? 'Connected (relay)' : 'Connected', true); $('padGo').hidden = true; $('padBoost').hidden = false; $('padLevel').disabled = false;
    $('padHint').textContent = 'Tilt the nose up to climb, down to dive. Roll to turn.'; }
  const stat = (t, ok) => { $('padStat').textContent = t; $('padStat').classList.toggle('ok', !!ok); };

  function onTilt(e) {
    if (e.beta == null || e.gamma == null) return;
    gotSensor = true; beta = e.beta; gamma = e.gamma;
    if (b0 === null) { b0 = beta; g0 = gamma; }
    // flat on the palm: beta is nose up/down, gamma is the roll. Past ~60 degrees the two start to blend, which is beyond any flying tilt.
    const p = Math.max(-80, Math.min(80, beta - b0)), r = Math.max(-80, Math.min(80, gamma - g0));
    $('padWing').style.transform = `translateY(${(-p * 1.6).toFixed(1)}px) rotate(${r.toFixed(1)}deg)`;
    curP = p; curR = r;
  }
  // send the latest tilt on a steady beat, so the big screen always knows the phone is there even when it is held still
  // the direct link gets every beat (60 a second); the relay gets every other one
  setInterval(() => { beat++; if (!gotSensor) return; const m = [+curP.toFixed(2), +curR.toFixed(2)];
    if (conn && conn.open) { try { conn.send(m); } catch (_) {} } else if (relayUp && beat % 2 === 0) relay.send(m); }, 16);
  function connect() {
    stat('Connecting…');
    try { if (peer) peer.destroy(); } catch (_) {}
    peer = new Peer(peerOptions());
    peer.on('open', () => {
      conn = peer.connect(padId(code), { reliable: false, serialization: 'json' });
      conn.on('open', () => { linked('direct'); b0 = null; });
      conn.on('data', d => { if (d && d.v && navigator.vibrate) try { navigator.vibrate(d.v); } catch (_) {} });
      conn.on('close', lost);
    });
    peer.on('error', e => { if (up()) return; stat(e && e.type === 'peer-unavailable' ? 'Code not found. Open the phone glider screen on the big screen and scan again.' : 'Connection problem. Tap to retry.'); retry(); });
    setTimeout(() => { if (!up()) { stat('Could not reach the big screen. Put the phone on the same Wi‑Fi as it, then tap to retry.'); retry(); } }, 14000);
    // in parallel, the relay: works even when the two devices cannot see each other directly
    if (!relay) joinRelay(code, d => { if (!d) return; if (d.k && !relayUp) { relayUp = true; if (!(conn && conn.open)) linked('relay'); } else if (d.v && navigator.vibrate) try { navigator.vibrate(d.v); } catch (_) {} })
      .then(r => { relay = r; if (!r) return; const hello = setInterval(() => { if (relayUp) clearInterval(hello); else r.send({ h: 1 }); }, 500); });
  }
  function lost() { if (relayUp) { stat('Connected (relay)', true); return; } stat('Connection lost. Tap to reconnect.'); retry(); }
  function retry() { $('padGo').hidden = false; $('padGo').textContent = 'Tap to reconnect'; $('padBoost').hidden = true; }

  $('padGo').onclick = async () => {
    if (!started) {
      let refused = false;
      try {   // iPhones ask before a page may read motion sensors, and only from a tap
        if (typeof DeviceOrientationEvent !== 'undefined' && typeof DeviceOrientationEvent.requestPermission === 'function') refused = (await DeviceOrientationEvent.requestPermission()) !== 'granted';
      } catch (_) { refused = true; }
      window.addEventListener('deviceorientation', onTilt);
      started = true;
      // only complain if no tilt actually arrives: some browsers answer the question oddly but still deliver the data
      setTimeout(() => { if (!gotSensor) $('padHint').textContent = refused ? 'Motion access was refused. Allow motion sensors for this site in the browser settings, then reload.' : 'This device is not reporting any tilt. Phone glider needs a phone with motion sensors.'; }, 2500);
      try { wake = await navigator.wakeLock.request('screen'); } catch (_) {}
      document.addEventListener('visibilitychange', async () => { if (!document.hidden) try { wake = await navigator.wakeLock.request('screen'); } catch (_) {} });
    }
    connect();
  };
  $('padLevel').onclick = () => { b0 = beta; g0 = gamma; stat('Level set', true); if (navigator.vibrate) navigator.vibrate(12); };
  $('padStage').addEventListener('pointerdown', e => {
    if (e.target.closest('button') || !up()) return;
    send({ b: 1 });
    $('padBoost').classList.add('hit'); setTimeout(() => $('padBoost').classList.remove('hit'), 180);
  });
}

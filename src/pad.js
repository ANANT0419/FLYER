// Phone glider, phone side. Opened by scanning the code on the big screen (?pad=CODE).
import { Peer } from 'peerjs';
import { peerOptions, padId } from './link.js';
import { joinRelay } from './relay.js';
import { rtcOffer } from './rtc.js';

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
  let relay = null, relayUp = false, dch = null, offer = null, rtcT = 0;
  // two ways to the screen directly: the PeerJS link (conn) or our own link built through the relay (dch). Either is fast.
  const directOpen = () => (conn && conn.open) || (dch && dch.readyState === 'open');
  const dsend = d => { try { if (conn && conn.open) conn.send(d); else dch.send(JSON.stringify(d)); } catch (_) {} };
  const up = () => directOpen() || relayUp;
  const send = d => { if (directOpen()) dsend(d); else if (relayUp) relay.send(d); };
  const fromScreen = d => { echo(d); if (d && d.v && navigator.vibrate) try { navigator.vibrate(d.v); } catch (_) {} };
  // build our own direct link through the relay; retried every 8 s while only the relay works
  async function tryRtc() {
    if (directOpen() || !relayUp || typeof RTCPeerConnection === 'undefined') return;
    if (offer) offer.close();
    try { offer = await rtcOffer(m => relay.send(m), fromScreen, ch => { dch = ch; linked('direct'); }, ch => { if (dch === ch) { dch = null; lost(); } }); } catch (_) {}
    clearTimeout(rtcT); rtcT = setTimeout(tryRtc, 8000);
  }
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
    sendTilt(false);   // send the moment the sensor reports, rather than waiting for the next beat
  }
  // the direct link gets every sensor reading (up to ~100 a second). The relay shares a message limit with everyone
  // playing (including race rooms), so it gets up to 30 a second but only when the tilt has changed, plus a slow heartbeat.
  let lastSent = 0, sentP = 1e9, sentR = 1e9;
  function sendTilt(beatTick) {
    if (!gotSensor) return; const t = performance.now(), direct = directOpen();
    if (direct) { if (t - lastSent < 8 || (beatTick && t - lastSent < 40)) return; }
    else { const moved = Math.abs(curP - sentP) > 0.4 || Math.abs(curR - sentR) > 0.4; if (t - lastSent < 33 || (!moved && t - lastSent < 300)) return; }
    const m = [+curP.toFixed(2), +curR.toFixed(2)]; lastSent = t; sentP = curP; sentR = curR;
    if (direct) dsend(m); else if (relayUp) relay.send(m);
  }
  // and a steady beat, so the big screen knows the phone is there even when it is held perfectly still
  setInterval(() => sendTilt(true), 50);
  const echo = d => { if (d && d.p) send({ q: d.p }); };
  function connect(quiet) {
    if (!quiet || !relayUp) stat('Connecting…');
    try { if (peer) peer.destroy(); } catch (_) {}
    peer = new Peer(peerOptions());
    peer.on('open', () => {
      conn = peer.connect(padId(code), { reliable: false, serialization: 'json' });
      conn.on('open', () => { linked('direct'); b0 = null; });
      conn.on('data', fromScreen);
      conn.on('close', lost);
    });
    peer.on('error', e => { if (up()) return; stat(e && e.type === 'peer-unavailable' ? 'Waiting for the big screen… (if this lasts, open the phone glider screen there and scan again)' : 'Connection problem. Retrying…'); retry(); });
    setTimeout(() => { if (!up()) { stat('Could not reach the big screen yet. Still trying… (same Wi‑Fi as the screen helps)'); retry(); } }, 14000);
    // in parallel, the relay: works even when the two devices cannot see each other directly
    if (!relay) joinRelay(code, d => { if (!d) return; if (d.rtc === 'answer') { if (offer) offer.answer(d.sdp); } else if (d.p) { if (!directOpen()) echo(d); } else if (d.k && !relayUp) { relayUp = true; if (!directOpen()) { linked('relay'); setTimeout(tryRtc, 1200); } } else if (d.v && navigator.vibrate) try { navigator.vibrate(d.v); } catch (_) {} })
      .then(r => { relay = r; if (!r) return; const hello = setInterval(() => { if (relayUp) clearInterval(hello); else r.send({ h: 1 }); }, 500); });
  }
  function lost() { if (directOpen()) return; if (relayUp) { stat('Connected (relay)', true); autoRetry(); clearTimeout(rtcT); rtcT = setTimeout(tryRtc, 1000); return; } stat('Connection lost. Reconnecting…'); retry(); }
  function retry() { $('padGo').hidden = false; $('padGo').textContent = 'Tap to reconnect'; $('padBoost').hidden = true; autoRetry(); }
  // keep trying by itself (the big screen may just be reloading, for example when switching to the race canyon)
  let retryT = 0;
  function autoRetry() { if (retryT || !started) return; retryT = setTimeout(() => { retryT = 0; if (!directOpen()) connect(true); }, relayUp ? 20000 : 3000); }   // on the relay, only try the direct link now and then

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

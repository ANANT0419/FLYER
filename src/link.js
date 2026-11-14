// Phone glider, big-screen side. The phone is held flat, top edge toward the screen, and tilted like a glider.
// Its motion sensors measure tilt directly, so this is the steadiest way to fly. The two devices talk straight
// to each other (WebRTC); a public PeerJS server is used only to introduce them.
import { Peer } from 'peerjs';
import { joinRelay } from './relay.js';
import { rtcAnswer , fastChannel, chOpen } from './rtc.js';
import { makeClock, clockPong, predict, euroStep } from './predict.js';

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const load = (k, d) => { try { const v = JSON.parse(localStorage.getItem('flyer.' + k)); return v == null ? d : v; } catch (_) { return d; } };
const save = (k, v) => { try { localStorage.setItem('flyer.' + k, JSON.stringify(v)); } catch (_) {} };
const PITCH_FULL = 28, ROLL_FULL = 34, PITCH_DEAD = 1.6, ROLL_DEAD = 2.2;   // degrees of phone tilt
const shape = (v, dead, full) => { const a = Math.abs(v); if (a < dead) return 0; const t = clamp((a - dead) / (full - dead), 0, 1); return Math.sign(v) * (t * 0.6 + t * t * 0.4); };

export function peerOptions() {   // ?sig=host:port points at a different introduction server (used for testing)
  const sig = new URLSearchParams(location.search).get('sig');
  if (!sig) return { debug: 0 };
  const [host, port] = sig.split(':'); return { host, port: +port || 9000, path: '/', secure: false, debug: 0 };
}
export const padId = code => 'flyer-pad-' + String(code).toLowerCase();

export const phone = {
  stalls: [], hold: false, path: '',
  status: 'off',        // off | starting | waiting | connected | error
  error: '', code: '', url: '',
  live: false,          // tilt data is arriving right now
  pitch: 0, roll: 0,    // degrees after levelling (pitch + = nose up, roll + = right side down)
  L: 0, R: 0,           // arm values for the game
  sens: load('padSens', 1),
};
let relay = null, relayAcked = false, dch = null, answerer = null;
const directOpen = () => (conn && conn.open) || (dch && dch.readyState === 'open');
function onData(d, viaRelay, viaFast) {
  if (!d) return;
  if (viaRelay && d.rtc === 'offer') {   // the phone offers our own direct link through the relay
    if (answerer) answerer.close();
    rtcAnswer(d.sdp, m => relay && relay.send(m), m => onData(m, false),
      ch => { dch = ch; phone.status = 'connected'; phone.via = 'direct'; phone.ms = 0; pings = 0; },
      ch => { if (dch === ch) dch = null; }).then(a => { answerer = a; }).catch(() => {});
    if (!relayAcked && relay) { relayAcked = true; relay.send({ k: 1 }); }
    return;
  }
  if (viaRelay) { if (!relayAcked && relay) { relayAcked = true; relay.send({ k: 1 }); } if (phone.status === 'waiting' || phone.status === 'starting') phone.status = 'connected'; phone.via = directOpen() ? 'direct' : 'relay'; }
  if (Array.isArray(d)) {
    const t = performance.now(), p = +d[0] || 0, r = +d[1] || 0;
    if (d.length >= 5) {   // new phones: [pitch, roll, pitch rate, roll rate, phone time of the reading]
      const tp = +d[4];
      if (tp <= lastPhoneT && tp > lastPhoneT - 5000) return;   // an older reading overtaken by a newer one: ignore it
      if (tp < lastPhoneT - 5000) clock.ok = false;              // the phone page reloaded: its clock restarted
      lastPhoneT = tp; st.vp = +d[2] || 0; st.vr = +d[3] || 0;
      st.at = clock.ok ? Math.min(t, tp - clock.off) : t - (phone.ms || 15);
    } else {   // an older phone page still open: estimate the rate from successive readings
      const gap = Math.max(0.008, (t - lastMsg) / 1000);
      if (lastMsg && gap < 0.35) { st.vp += ((p - st.p) / gap - st.vp) * 0.5; st.vr += ((r - st.r) / gap - st.vr) * 0.5; } else st.vp = st.vr = 0;
      st.at = t - (phone.ms || 15);
    }
    // a silence in the middle of a flight (the recordings show 1-3 s ones, twice followed by a crash): note it; the phone's
    // next health note says whether its own page or sensor paused, otherwise it was the network between the two
    if (lastMsg && t - lastMsg > 500 && t - lastMsg < 20000) { stallMs = t - lastMsg; stallAt = t; burstN = 0; }
    if (stallMs && t - stallAt < 150) burstN++;   // readings that pour in right after a silence were held back, not lost
    phone.path = viaRelay ? 'relay' : viaFast ? 'direct, no re-sending' : 'direct, re-sending';
    st.p = p; st.r = r; phone.pitch = p; phone.roll = r; lastMsg = t; phone.via = directOpen() ? 'direct' : 'relay';
  }
  // delay shown = the middle of the last five pings: one late answer is not 'a slow link'
  else if (d.q) { const now = performance.now(), rtt = now - d.q; if (rtt >= 0 && rtt < 5000) { rtts.push(rtt / 2); if (rtts.length > 5) rtts.shift(); phone.ms = [...rtts].sort((a, b) => a - b)[rtts.length >> 1]; } if (d.t != null) clockPong(clock, d.q, +d.t, now); pings++; }
  else if (d.st) { phone.hz = +d.st[0] || 0; phone.gyro = ['off', 'on', 'learning'][+d.st[1]] || 'off';
    if (stallMs && performance.now() - stallAt < 4000) { const tg = +d.st[2] || 0, sg = +d.st[3] || 0, need = stallMs * 0.5;
      phone.stalls.push([Math.round(stallMs), (d.st.length < 4 ? 'cause unknown (old phone page)' : tg > need ? 'the phone’s browser paused' : sg > need ? 'the phone’s tilt sensor paused' : 'the network between phone and screen stalled') + ' (' + phone.path + (burstN > 20 ? '; ' + burstN + ' held-back readings arrived at once' : burstN ? '; ' + burstN + ' readings in the first 0.15 s after' : '') + ')']); stallMs = 0; } }
  else if (d.h && relay) relay.send({ k: 1 });
  else if (d.b) for (const cb of boostCbs) { try { cb(); } catch (_) {} }
}
let stallMs = 0, stallAt = 0, burstN = 0, fast = null; const rtts = [];
let peer = null, conn = null, lastMsg = 0, sp = 0, sr = 0, lastT = 0, lastPing = 0, lastPhoneT = -1e12, pings = 0;
const st = { p: 0, r: 0, vp: 0, vr: 0, at: 0 }, clock = makeClock(), eP = {}, eR = {};
const boostCbs = [];
export function onPhoneBoost(cb) { boostCbs.push(cb); }
export function setPhoneSens(v) { phone.sens = clamp(+v || 1, 0.6, 1.6); save('padSens', phone.sens); }
function toPhone(d) { try { if (chOpen(fast)) fast.send(JSON.stringify(d)); else if (conn && conn.open) conn.send(d); else if (dch && dch.readyState === 'open') dch.send(JSON.stringify(d)); else if (relay && relayAcked) relay.send(d); } catch (_) {} }
export function phoneBuzz(pattern) { toPhone({ v: pattern }); }

// the pairing code survives a reload of this tab (switching to the race canyon reloads), so a paired phone reconnects by itself
const savedCode = () => { try { return sessionStorage.getItem('flyer.padCode') || ''; } catch (_) { return ''; } };
const keepCode = c => { try { if (c) sessionStorage.setItem('flyer.padCode', c); else sessionStorage.removeItem('flyer.padCode'); } catch (_) {} };
export const phoneWasPaired = () => !!savedCode();
export function hostPhone() {
  if (peer && !peer.destroyed) return;
  const abc = 'abcdefghjkmnpqrstuvwxyz23456789'; let code = savedCode(); if (!code) for (let i = 0; i < 5; i++) code += abc[Math.floor(Math.random() * abc.length)];
  keepCode(code);
  phone.code = code; phone.status = 'starting'; phone.error = '';
  const u = new URL(location.href); u.search = ''; u.hash = ''; u.searchParams.set('pad', code);
  const sig = new URLSearchParams(location.search).get('sig'); if (sig) u.searchParams.set('sig', sig);
  phone.url = u.toString();
  relayAcked = false; joinRelay(code, d => onData(d, true)).then(r => { if (phone.code !== code) { if (r) r.close(); return; } relay = r; if (r && phone.status !== 'connected') phone.status = 'waiting'; });
  startPeer(code);
}
function startPeer(code) {
  peer = new Peer(padId(code), peerOptions());
  peer.on('open', () => { if (phone.status === 'starting') phone.status = 'waiting'; });
  peer.on('connection', c => {
    if (conn && conn.open) try { conn.close(); } catch (_) {}
    conn = c;
    c.on('open', () => { phone.status = 'connected'; phone.via = 'direct'; pings = 0; fast = fastChannel(c.peerConnection, d => onData(d, false, true)); });
    c.on('data', d => onData(d, false));
    c.on('close', () => { if (conn === c) { conn = null; if (phone.status === 'connected' && !relayAcked) phone.status = 'waiting'; } });
  });
  peer.on('disconnected', () => { try { peer.reconnect(); } catch (_) {} });
  peer.on('error', e => {
    // just after a reload the introduction server may still hold this code for the old page: try again shortly
    if (e && e.type === 'unavailable-id') { const p = peer; setTimeout(() => { if (peer === p && phone.code === code) { try { p.destroy(); } catch (_) {} startPeer(code); } }, 4000); return; }
    if (phone.status === 'connected' || relay) return;   // a live link, or the relay, carries on without the introduction server
    phone.status = 'error'; phone.error = 'Could not set up the phone link (' + (e && e.type ? e.type : e) + '). Check the internet connection and try again.';
  });
}
export function stopPhone() { keepCode(''); if (answerer) answerer.close(); answerer = null; dch = null; try { if (peer) peer.destroy(); } catch (_) {} if (relay) relay.close(); relay = null; relayAcked = false; phone.code = ''; peer = null; conn = null; phone.status = 'off'; phone.ms = 0; phone.via = ''; phone.live = false; clock.ok = false; pings = 0; lastPhoneT = -1e12; phone.L = phone.R = 0; }

/** Call once per frame. */
export function updatePhone(now) {
  const dt = Math.min(0.1, lastT ? (now - lastT) / 1000 : 0.016); lastT = now;
  phone.live = phone.status === 'connected' && now - lastMsg < 600;
  // during a silence the phone stays in charge for 3 s with its last tilt (it used to snap to level in one frame and
  // hand over to the keyboard); the game steers along the line meanwhile and hands back softly
  phone.hold = phone.status === 'connected' && now - lastMsg < 3000;
  // ping often at first (to learn how the two clocks differ), then now and then to keep the delay figure fresh
  if (phone.status === 'connected' && now - lastPing > (pings < 8 ? 250 : phone.via === 'relay' ? 3000 : 1000)) { lastPing = now; toPhone({ p: now }); }
  // Draw where the phone is now, not where it was: carry the last reading forward by its age plus the time until this
  // frame is on the display (~20 ms) and the game's own smoothing (~30 ms), using how fast the phone was turning.
  const relay = phone.via === 'relay';
  // only predict far with the gyroscope's clean rates; until it is learned, the change in angle is noisier, so lead a little only
  const gy = phone.gyro === 'on', lead = gy ? (relay ? 25 : 18) : 4;
  const [tp, tr] = phone.live ? predict(st, now, 20 + 1000 / 60 + 1000 / 70, relay ? 260 : gy ? 160 : 90, lead) : [0, 0];
  phone.lead = phone.live ? Math.round(Math.min(relay ? 260 : 160, now - st.at + 50)) : 0;
  if (phone.live) { sp = euroStep(eP, tp, st.vp, dt); sr = euroStep(eR, tr, st.vr, dt); }   // steady when still, quick when turning
  else if (!phone.hold) { const g = 1 - Math.exp(-dt * 4); sp += (0 - sp) * g; sr += (0 - sr) * g; eP.v = sp; eR.v = sr; }   // a silence: keep the last tilt (the game flies the line meanwhile); ease to level once it is given up
  const p = shape(sp * phone.sens, PITCH_DEAD, PITCH_FULL), t = shape(-sr * phone.sens, ROLL_DEAD, ROLL_FULL);   // t + = turn left
  phone.L = phone.hold ? clamp(p + t, -1, 1) : 0; phone.R = phone.hold ? clamp(p - t, -1, 1) : 0;
  phone.sp = sp; phone.sr = sr;
}
// ?debug exposes the link's inner state for test/phone-e2e.cjs
if (/[?&]debug\b/.test(location.search)) window.__pad = { phone, st, clock, predict, updatePhone };

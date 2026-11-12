// Phone glider, big-screen side. The phone is held flat, top edge toward the screen, and tilted like a glider.
// Its motion sensors measure tilt directly, so this is the steadiest way to fly. The two devices talk straight
// to each other (WebRTC); a public PeerJS server is used only to introduce them.
import { Peer } from 'peerjs';
import { joinRelay } from './relay.js';
import { rtcAnswer } from './rtc.js';

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
  status: 'off',        // off | starting | waiting | connected | error
  error: '', code: '', url: '',
  live: false,          // tilt data is arriving right now
  pitch: 0, roll: 0,    // degrees after levelling (pitch + = nose up, roll + = right side down)
  L: 0, R: 0,           // arm values for the game
  sens: load('padSens', 1),
};
let relay = null, relayAcked = false, dch = null, answerer = null;
const directOpen = () => (conn && conn.open) || (dch && dch.readyState === 'open');
function onData(d, viaRelay) {
  if (!d) return;
  if (viaRelay && d.rtc === 'offer') {   // the phone offers our own direct link through the relay
    if (answerer) answerer.close();
    rtcAnswer(d.sdp, m => relay && relay.send(m), m => onData(m, false),
      ch => { dch = ch; phone.status = 'connected'; phone.via = 'direct'; phone.ms = 0; },
      ch => { if (dch === ch) dch = null; }).then(a => { answerer = a; }).catch(() => {});
    if (!relayAcked && relay) { relayAcked = true; relay.send({ k: 1 }); }
    return;
  }
  if (viaRelay) { if (!relayAcked && relay) { relayAcked = true; relay.send({ k: 1 }); } if (phone.status === 'waiting' || phone.status === 'starting') phone.status = 'connected'; phone.via = directOpen() ? 'direct' : 'relay'; }
  if (Array.isArray(d)) {
    const t = performance.now(), p = +d[0] || 0, r = +d[1] || 0, gap = Math.max(0.008, (t - lastMsg) / 1000);
    // how fast the tilt is changing, so the screen can run slightly ahead between messages instead of trailing them
    if (lastMsg && gap < 0.35) { vp += ((p - phone.pitch) / gap - vp) * 0.5; vr += ((r - phone.roll) / gap - vr) * 0.5; } else { vp = vr = 0; }
    phone.pitch = p; phone.roll = r; lastMsg = t; phone.via = directOpen() ? 'direct' : 'relay';
  }
  else if (d.q) { const rtt = performance.now() - d.q; if (rtt >= 0 && rtt < 5000) phone.ms = phone.ms ? phone.ms * 0.7 + rtt / 2 * 0.3 : rtt / 2; }
  else if (d.h && relay) relay.send({ k: 1 });
  else if (d.b) for (const cb of boostCbs) { try { cb(); } catch (_) {} }
}
let peer = null, conn = null, lastMsg = 0, sp = 0, sr = 0, lastT = 0, vp = 0, vr = 0, lastPing = 0;
const boostCbs = [];
export function onPhoneBoost(cb) { boostCbs.push(cb); }
export function setPhoneSens(v) { phone.sens = clamp(+v || 1, 0.6, 1.6); save('padSens', phone.sens); }
function toPhone(d) { try { if (conn && conn.open) conn.send(d); else if (dch && dch.readyState === 'open') dch.send(JSON.stringify(d)); else if (relay && relayAcked) relay.send(d); } catch (_) {} }
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
    c.on('open', () => { phone.status = 'connected'; phone.via = 'direct'; });
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
export function stopPhone() { keepCode(''); if (answerer) answerer.close(); answerer = null; dch = null; try { if (peer) peer.destroy(); } catch (_) {} if (relay) relay.close(); relay = null; relayAcked = false; phone.code = ''; peer = null; conn = null; phone.status = 'off'; phone.ms = 0; phone.via = ''; phone.live = false; phone.L = phone.R = 0; }

/** Call once per frame. */
export function updatePhone(now) {
  const dt = Math.min(0.1, lastT ? (now - lastT) / 1000 : 0.016); lastT = now;
  phone.live = phone.status === 'connected' && now - lastMsg < 600;
  if (phone.status === 'connected' && now - lastPing > (phone.via === 'relay' ? 3000 : 1000)) { lastPing = now; toPhone({ p: now }); }   // measures the delay, shown on the setup screen
  // aim a little ahead along the current motion (at most 50 ms), then glide there: hides the gaps between messages without trailing them
  const age = Math.min(phone.via === 'relay' ? 0.08 : 0.05, (now - lastMsg) / 1000), lead = phone.live ? 1 : 0;
  const tp = phone.live ? phone.pitch + vp * age * lead : 0, tr = phone.live ? phone.roll + vr * age * lead : 0;
  const g = 1 - Math.exp(-dt * (phone.live ? 55 : 6));   // ease to level if the messages stop
  sp += (tp - sp) * g; sr += (tr - sr) * g;
  const p = shape(sp * phone.sens, PITCH_DEAD, PITCH_FULL), t = shape(-sr * phone.sens, ROLL_DEAD, ROLL_FULL);   // t + = turn left
  phone.L = phone.live ? clamp(p + t, -1, 1) : 0; phone.R = phone.live ? clamp(p - t, -1, 1) : 0;
  phone.sp = sp; phone.sr = sr;
}

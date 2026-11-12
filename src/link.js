// Phone glider, big-screen side. The phone is held flat, top edge toward the screen, and tilted like a glider.
// Its motion sensors measure tilt directly, so this is the steadiest way to fly. The two devices talk straight
// to each other (WebRTC); a public PeerJS server is used only to introduce them.
import { Peer } from 'peerjs';

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
let peer = null, conn = null, lastMsg = 0, sp = 0, sr = 0, lastT = 0;
const boostCbs = [];
export function onPhoneBoost(cb) { boostCbs.push(cb); }
export function setPhoneSens(v) { phone.sens = clamp(+v || 1, 0.6, 1.6); save('padSens', phone.sens); }
export function phoneBuzz(pattern) { if (conn && conn.open) try { conn.send({ v: pattern }); } catch (_) {} }

export function hostPhone() {
  if (peer && !peer.destroyed) return;
  const abc = 'abcdefghjkmnpqrstuvwxyz23456789'; let code = ''; for (let i = 0; i < 5; i++) code += abc[Math.floor(Math.random() * abc.length)];
  phone.code = code; phone.status = 'starting'; phone.error = '';
  const u = new URL(location.href); u.search = ''; u.hash = ''; u.searchParams.set('pad', code);
  const sig = new URLSearchParams(location.search).get('sig'); if (sig) u.searchParams.set('sig', sig);
  phone.url = u.toString();
  peer = new Peer(padId(code), peerOptions());
  peer.on('open', () => { if (phone.status === 'starting') phone.status = 'waiting'; });
  peer.on('connection', c => {
    if (conn && conn.open) try { conn.close(); } catch (_) {}
    conn = c;
    c.on('open', () => { phone.status = 'connected'; });
    c.on('data', d => {
      if (!d) return;
      if (Array.isArray(d)) { phone.pitch = +d[0] || 0; phone.roll = +d[1] || 0; lastMsg = performance.now(); }
      else if (d.b) for (const cb of boostCbs) { try { cb(); } catch (_) {} }
    });
    c.on('close', () => { if (conn === c) { conn = null; if (phone.status === 'connected') phone.status = 'waiting'; } });
  });
  peer.on('disconnected', () => { try { peer.reconnect(); } catch (_) {} });
  peer.on('error', e => {
    if (phone.status === 'connected') return;           // an introduction-server hiccup does not affect a live link
    phone.status = 'error'; phone.error = 'Could not set up the phone link (' + (e && e.type ? e.type : e) + '). Check the internet connection and try again.';
  });
}
export function stopPhone() { try { if (peer) peer.destroy(); } catch (_) {} peer = null; conn = null; phone.status = 'off'; phone.live = false; phone.L = phone.R = 0; }

/** Call once per frame. */
export function updatePhone(now) {
  const dt = Math.min(0.1, lastT ? (now - lastT) / 1000 : 0.016); lastT = now;
  phone.live = phone.status === 'connected' && now - lastMsg < 600;
  const g = 1 - Math.exp(-dt * (phone.live ? 30 : 6));   // glide between sensor messages; ease to level if they stop
  sp += ((phone.live ? phone.pitch : 0) - sp) * g; sr += ((phone.live ? phone.roll : 0) - sr) * g;
  const p = shape(sp * phone.sens, PITCH_DEAD, PITCH_FULL), t = shape(-sr * phone.sens, ROLL_DEAD, ROLL_FULL);   // t + = turn left
  phone.L = phone.live ? clamp(p + t, -1, 1) : 0; phone.R = phone.live ? clamp(p - t, -1, 1) : 0;
  phone.sp = sp; phone.sr = sr;
}

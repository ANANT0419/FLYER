// Multiplayer race rooms. Everyone in a room joins the same Supabase Realtime channel (the same service the phone relay uses):
//  - presence lists who is in the room; whoever has been in it longest is the host and starts races
//  - broadcast carries the start signal, each racer's position about 10 times a second, and finish times
// Racers pass through each other, so a little network delay never causes an unfair bump.
// Positions go out 5 times a second (the service has a project-wide message limit shared with the phone relay); each
// racer is drawn where they are predicted to be right now, from their last position and velocity, then smoothed.
import { rtClient, rtReady, rtSend } from './rt.js';

export const raceNetReady = rtReady;
const ABC = 'abcdefghjkmnpqrstuvwxyz23456789';
export const newRoomCode = () => { let c = ''; for (let i = 0; i < 5; i++) c += ABC[Math.floor(Math.random() * ABC.length)]; return c; };
export const cleanCode = c => String(c || '').toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 8);

const COLORS = ['#ff7a59', '#5ec8ff', '#b98cff', '#7be08a', '#ffd25e', '#ff8fc7', '#62e6d3', '#c9a27a'];

export const room = {
  status: 'off',            // off | joining | in | error
  error: '', code: '',
  me: { id: Math.random().toString(36).slice(2, 10), name: '' },
  players: new Map(),       // id -> { id, name, color, t (joined), host, st: latest state, buf: [[time, state]...], fin: {time, pen} | null }
  rid: 0,                   // the current race number; finish times are kept per race
  results: [],              // [{id, name, time, pen}] for the current race, fastest first
  isHost: false,
};

let sb = null, ch = null, joinedAt = 0;
const cbs = { start: [], change: [] };
/** tag: set before joining, so each race track has its own set of rooms ('' = Razorback Canyon, as before). */
export const raceCfg = { tag: '' };
export function onRaceStart(cb) { cbs.start.push(cb); }
export function onRoomChange(cb) { cbs.change.push(cb); }
const emit = (k, ...a) => { for (const cb of cbs[k]) try { cb(...a); } catch (_) {} };

function colorFor(id) { let h = 0; for (const c of id) h = (h * 31 + c.charCodeAt(0)) | 0; return COLORS[Math.abs(h) % COLORS.length]; }
function player(id) {
  let p = room.players.get(id);
  if (!p) { p = { id, name: 'Flyer', color: colorFor(id), t: Infinity, host: false, st: null, buf: [], fin: null, seen: 0 }; room.players.set(id, p); }
  return p;
}
function pickHost() {
  let best = null;
  for (const p of room.players.values()) if (p.t !== Infinity && (!best || p.t < best.t || (p.t === best.t && p.id < best.id))) best = p;
  for (const p of room.players.values()) p.host = p === best;
  room.isHost = !!best && best.id === room.me.id;
}
function addResult(id, name, time, pen) {
  if (room.results.some(r => r.id === id)) return;
  room.results.push({ id, name, time, pen }); room.results.sort((a, b) => a.time - b.time);
  const p = room.players.get(id); if (p) p.fin = { time, pen };
  emit('change');
}

/** Join (or create) the room with this code. Resolves true once in. */
export async function joinRoom(code, name) {
  leaveRoom();
  room.code = cleanCode(code); room.me.name = String(name || 'Flyer').slice(0, 16); room.status = 'joining'; room.error = '';
  room.players.clear(); room.results = []; room.rid = 0; emit('change');
  if (!raceNetReady) { room.status = 'error'; room.error = 'Race rooms are switched off in this build.'; emit('change'); return false; }
  try {
    sb = await rtClient();
    ch = sb.channel('flyer-race-' + raceCfg.tag + room.code, { config: { broadcast: { self: false, ack: false }, presence: { key: room.me.id } } });
    ch.on('presence', { event: 'sync' }, () => {
      const state = ch.presenceState(), here = new Set();
      for (const id in state) { const meta = state[id][0] || {}; here.add(id); const p = player(id); p.name = String(meta.name || 'Flyer').slice(0, 16); p.t = +meta.t || Infinity; p.lvl = String(meta.lvl || ''); }
      for (const id of [...room.players.keys()]) if (!here.has(id)) room.players.delete(id);
      pickHost(); emit('change');
    });
    ch.on('broadcast', { event: 'go' }, ({ payload }) => { if (!payload || payload.rid === room.rid) return; room.rid = payload.rid; room.results = []; for (const p of room.players.values()) { p.fin = null; p.buf = []; p.st = null; } emit('start', payload); emit('change'); });
    ch.on('broadcast', { event: 'st' }, ({ payload: d }) => {
      if (!d || d.id === room.me.id) return; const p = player(d.id), now = performance.now();
      if (d.rid !== room.rid) return;
      p.st = d; p.seen = now; p.buf.push([now, d]); if (p.buf.length > 12) p.buf.shift();
    });
    ch.on('broadcast', { event: 'fin' }, ({ payload: d }) => { if (d && d.rid === room.rid) addResult(d.id, d.name, d.time, d.pen); });
    joinedAt = Date.now();
    const ok = await new Promise(resolve => {
      const to = setTimeout(() => resolve(false), 12000);
      ch.subscribe(async st => {
        if (st === 'SUBSCRIBED') { clearTimeout(to); try { await ch.track({ name: room.me.name, t: joinedAt, lvl: myLvl }); } catch (_) {} resolve(true); }
        else if (st === 'CHANNEL_ERROR' || st === 'TIMED_OUT') { clearTimeout(to); resolve(false); }
      });
    });
    if (!ok) throw new Error('could not reach the race server');
    const me = player(room.me.id); me.name = room.me.name; me.t = joinedAt; pickHost();
    room.status = 'in'; emit('change'); return true;
  } catch (e) {
    leaveRoom(); room.status = 'error'; room.error = 'Could not join the room (' + (e && e.message ? e.message : e) + '). Check the internet connection and try again.'; emit('change'); return false;
  }
}
export function leaveRoom() {
  try { if (ch) ch.untrack(); } catch (_) {}
  try { if (sb && ch) sb.removeChannel(ch); } catch (_) {}
  sb = null; ch = null; room.status = 'off'; room.code = ''; room.players.clear(); room.results = []; room.isHost = false; emit('change');
}
let myLvl = '';
export function setMyName(name) {
  room.me.name = String(name || 'Flyer').slice(0, 16);
  if (ch && room.status === 'in') try { ch.track({ name: room.me.name, t: joinedAt, lvl: myLvl }); } catch (_) {}
}
/** My guided-line level, shared through presence so the lobby can show the host's before the race starts. */
export function setMyLevel(lvl) { myLvl = String(lvl || ''); setMyName(room.me.name); }
const send = (event, payload) => { if (room.status === 'in') rtSend(ch, event, payload); };

/** Host only: start a race for everyone in the room. Returns the start payload (the host starts too). */
export function startRace(extra) {
  const payload = { ...(extra || {}), rid: room.rid + 1, at: Date.now() };   // extra: e.g. the host's guide level
  room.rid = payload.rid; room.results = []; for (const p of room.players.values()) { p.fin = null; p.buf = []; p.st = null; }
  send('go', payload); setTimeout(() => send('go', payload), 400); emit('change'); return payload;   // sent twice in case one is lost
}
let lastSend = 0;
/** Share where I am. Call every frame; it sends 5 times a second. */
export function sendState(now, s) {
  if (room.status !== 'in' || now - lastSend < 195) return; lastSend = now;
  send('st', { id: room.me.id, rid: room.rid, p: s.p.map(v => Math.round(v * 10) / 10), a: s.a.map(v => Math.round(v * 100) / 100), s: Math.round(s.s), arm: s.arm, done: !!s.done, t: Math.round(now) });
}
export function sendFinish(time, pen) {
  addResult(room.me.id, room.me.name, time, pen);
  const f = { id: room.me.id, rid: room.rid, name: room.me.name, time, pen }; send('fin', f); setTimeout(() => send('fin', f), 1500);
}
/** Where a racer is right now: their last reported position carried forward along their velocity (measured with the
 *  sender's own clock, so network jitter does not bend it), allowing for the trip across the network, then smoothed so
 *  corrections glide instead of jump. Returns null if they have gone quiet. */
const LATENCY = 80;   // ms, a typical one-way trip through the service
export function ghostPose(p, now) {
  if (!p.buf.length || now - p.seen > 3000) return null;
  const [r1, s1] = p.buf[p.buf.length - 1];
  let v = [0, 0, 0], w = [0, 0, 0];
  if (p.buf.length > 1) {
    const s0 = p.buf[p.buf.length - 2][1], dt = (s1.t && s0.t ? s1.t - s0.t : r1 - p.buf[p.buf.length - 2][0]) || 1;
    if (dt > 20 && dt < 1000) { for (let k = 0; k < 3; k++) { v[k] = (s1.p[k] - s0.p[k]) / dt; let d = s1.a[k] - s0.a[k]; while (d > Math.PI) d -= 2 * Math.PI; while (d < -Math.PI) d += 2 * Math.PI; w[k] = d / dt; } }
  }
  const ahead = Math.min(450, now - r1 + LATENCY);
  const tp = [0, 1, 2].map(k => s1.p[k] + v[k] * ahead), ta = [0, 1, 2].map(k => s1.a[k] + w[k] * Math.min(ahead, 250));
  const dt = p.lastPose ? Math.min(0.1, (now - p.lastPose) / 1000) : 1; p.lastPose = now;
  if (!p.disp || dt >= 1 || Math.hypot(tp[0] - p.disp.p[0], tp[1] - p.disp.p[1], tp[2] - p.disp.p[2]) > 40) p.disp = { p: tp.slice(), a: ta.slice() };
  else {
    const g = 1 - Math.exp(-dt * 10);
    for (let k = 0; k < 3; k++) { p.disp.p[k] += v[k] * dt * 1000; p.disp.p[k] += (tp[k] - p.disp.p[k]) * g;   // keep moving, then ease onto the prediction
      let d = ta[k] - p.disp.a[k]; while (d > Math.PI) d -= 2 * Math.PI; while (d < -Math.PI) d += 2 * Math.PI; p.disp.a[k] += d * g; }
  }
  return { p: p.disp.p, a: p.disp.a, s: s1.s, done: s1.done };
}

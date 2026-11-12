// Multiplayer race rooms. Everyone in a room joins the same Supabase Realtime channel (the same service the phone relay uses):
//  - presence lists who is in the room; whoever has been in it longest is the host and starts races
//  - broadcast carries the start signal, each racer's position about 10 times a second, and finish times
// Racers pass through each other, so a little network delay never causes an unfair bump.
// Positions go out 4 times a second (the service has a project-wide message limit shared with the phone relay).
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
    ch = sb.channel('flyer-race-' + room.code, { config: { broadcast: { self: false, ack: false }, presence: { key: room.me.id } } });
    ch.on('presence', { event: 'sync' }, () => {
      const state = ch.presenceState(), here = new Set();
      for (const id in state) { const meta = state[id][0] || {}; here.add(id); const p = player(id); p.name = String(meta.name || 'Flyer').slice(0, 16); p.t = +meta.t || Infinity; }
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
        if (st === 'SUBSCRIBED') { clearTimeout(to); try { await ch.track({ name: room.me.name, t: joinedAt }); } catch (_) {} resolve(true); }
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
export function setMyName(name) {
  room.me.name = String(name || 'Flyer').slice(0, 16);
  if (ch && room.status === 'in') try { ch.track({ name: room.me.name, t: joinedAt }); } catch (_) {}
}
const send = (event, payload) => { if (room.status === 'in') rtSend(ch, event, payload); };

/** Host only: start a race for everyone in the room. Returns the start payload (the host starts too). */
export function startRace() {
  const payload = { rid: room.rid + 1, at: Date.now() };
  room.rid = payload.rid; room.results = []; for (const p of room.players.values()) { p.fin = null; p.buf = []; p.st = null; }
  send('go', payload); setTimeout(() => send('go', payload), 400); emit('change'); return payload;   // sent twice in case one is lost
}
let lastSend = 0;
/** Share where I am. Call every frame; it sends 4 times a second. */
export function sendState(now, s) {
  if (room.status !== 'in' || now - lastSend < 245) return; lastSend = now;
  send('st', { id: room.me.id, rid: room.rid, p: s.p.map(v => Math.round(v * 10) / 10), a: s.a.map(v => Math.round(v * 100) / 100), s: Math.round(s.s), arm: s.arm, done: !!s.done });
}
export function sendFinish(time, pen) {
  addResult(room.me.id, room.me.name, time, pen);
  const f = { id: room.me.id, rid: room.rid, name: room.me.name, time, pen }; send('fin', f); setTimeout(() => send('fin', f), 1500);
}
/** Where a racer was ~320 ms ago (a little over one message gap), smoothly between the messages received. Returns null if they have gone quiet. */
export function ghostPose(p, now) {
  if (!p.buf.length || now - p.seen > 3000) return null;
  const t = now - 320, b = p.buf;
  if (t <= b[0][0]) return b[0][1];
  for (let i = b.length - 1; i > 0; i--) {
    if (b[i - 1][0] <= t) {
      const [t0, s0] = b[i - 1], [t1, s1] = b[i]; if (t >= t1) return s1;
      const k = (t - t0) / Math.max(1, t1 - t0), lerp = (a, c) => a + (c - a) * k;
      const ang = (a, c) => { let d = c - a; while (d > Math.PI) d -= 2 * Math.PI; while (d < -Math.PI) d += 2 * Math.PI; return a + d * k; };
      return { p: [lerp(s0.p[0], s1.p[0]), lerp(s0.p[1], s1.p[1]), lerp(s0.p[2], s1.p[2])], a: [ang(s0.a[0], s1.a[0]), ang(s0.a[1], s1.a[1]), ang(s0.a[2], s1.a[2])], s: lerp(s0.s, s1.s), done: s1.done };
    }
  }
  return b[b.length - 1][1];
}

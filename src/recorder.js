// Flight recorder (owner's wish: "make me play and then you observe everything"). Records each flight 20 times a
// second: what the player's controls said, what the guided line asked for and added, what the glider did, frame times
// and every event. When the flight ends it goes to the game's Supabase project (table flight_logs, insert-only for
// the game), where the developer reads it. Switch: "Send my flights for review" in the settings.
import { RELAY_URL, RELAY_KEY } from './relay-config.js';

const load = (k, d) => { try { const v = JSON.parse(localStorage.getItem('flyer.' + k)); return v == null ? d : v; } catch (_) { return d; } };
export const recorder = { on: load('record', true), last: '' };
export function setRecording(on) { recorder.on = !!on; try { localStorage.setItem('flyer.record', JSON.stringify(recorder.on)); } catch (_) {} }

const KEYS = ['t', 's', 'off', 'lk', 'ol', 'pi', 'ti', 'np', 'nt', 'hy', 'hp', 'p', 'r', 'yw', 'v', 'y', 'gy', 'mdt', 'pp', 'pr', 'fp', 'fr', 'pl', 'ms'];
const MAX = 6000;   // 5 minutes at 20 a second
let cur = null, lastSample = 0, maxDt = 0, frames = 0, frameSum = 0;

/** A flight starts. meta: plain facts (course, controls, level...). */
export function recStart(meta) {
  if (!recorder.on || !RELAY_URL || !RELAY_KEY) { cur = null; return; }
  cur = { meta: { ...meta, started: new Date().toISOString(), build: typeof __BUILD__ !== 'undefined' ? __BUILD__ : 'dev', ua: navigator.userAgent,
    screen: [innerWidth, innerHeight, devicePixelRatio] }, cols: Object.fromEntries(KEYS.map(k => [k, []])), events: [], t0: performance.now(), n: 0 };
  lastSample = 0; maxDt = 0; frames = 0; frameSum = 0;
}
/** Every frame while flying. get() returns the sample (only called 20 times a second). */
export function recFrame(now, dtMs, get) {
  if (!cur) return;
  maxDt = Math.max(maxDt, dtMs); frames++; frameSum += dtMs;
  if (now - lastSample < 50) return; lastSample = now;
  const s = get(); s.t = (now - cur.t0) / 1000; s.mdt = maxDt; maxDt = 0;
  const c = cur.cols;
  if (cur.n >= MAX) for (const k of KEYS) c[k].shift(); else cur.n++;
  for (const k of KEYS) { const v = s[k]; c[k].push(typeof v === 'number' && isFinite(v) ? Math.round(v * 1000) / 1000 : v == null ? null : +v); }
}
/** Something happened: a crash, a ring, a gate, a quality step, an issue-log line... */
export function recEvent(kind, info) {
  if (!cur) return;
  cur.events.push([Math.round(performance.now() - cur.t0) / 1000, kind, info == null ? '' : String(info).slice(0, 300)]);
  if (cur.events.length > 2000) cur.events.shift();
}
/** The flight ended (finished, quit, restarted, page hidden). Sends it; resolves to a short status word. */
export async function recEnd(result, extra) {
  const c = cur; cur = null;
  if (!c || c.n < 40) return '';   // under 2 seconds: nothing worth reading
  c.meta.result = result; c.meta.seconds = Math.round((performance.now() - c.t0) / 100) / 10; c.meta.avgFps = frames ? Math.round(1000 / (frameSum / frames)) : 0;
  Object.assign(c.meta, extra || {});
  const body = JSON.stringify({ meta: c.meta, data: { keys: KEYS, cols: c.cols, events: c.events } });
  try {
    const r = await fetch(RELAY_URL + '/rest/v1/flight_logs', { method: 'POST', keepalive: body.length < 60000,
      headers: { apikey: RELAY_KEY, Authorization: 'Bearer ' + RELAY_KEY, 'Content-Type': 'application/json', Prefer: 'return=minimal' }, body });
    recorder.last = r.ok ? 'sent' : 'failed (' + r.status + ')';
  } catch (e) { recorder.last = 'failed (offline)'; }
  return recorder.last;
}
export const recording = () => !!cur;

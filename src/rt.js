// One shared connection to the Supabase Realtime service per page, used by the phone relay and by race rooms.
// The free plan allows about 100 messages a second for the whole project, so everything that sends through it
// keeps its rate low, and nothing sends while the connection is down (the library would otherwise fall back to
// one web request per message, which only adds to an overload).
import { RELAY_URL, RELAY_KEY } from './relay-config.js';
export const rtReady = !!(RELAY_URL && RELAY_KEY);
let client = null;
export async function rtClient() {
  if (!rtReady) return null;
  if (!client) {
    const { createClient } = await import('@supabase/supabase-js');
    client = createClient(RELAY_URL, RELAY_KEY, { auth: { persistSession: false }, realtime: { params: { eventsPerSecond: 60 } } });
  }
  return client;
}
export const rtStats = { dropped: 0, limited: 0 };
/** Send on a channel only if it is connected; otherwise drop it (the next update replaces it anyway). */
export function rtSend(ch, event, payload) {
  if (!ch || ch.state !== 'joined') { rtStats.dropped++; return false; }
  try { const r = ch.send({ type: 'broadcast', event, payload }); if (r && r.then) r.then(v => { if (v === 'rate limited') rtStats.limited++; }).catch(() => {}); } catch (_) { return false; }
  return true;
}

// A shared "room" both devices connect out to, so it works on any network. Slower than the direct link, so it is the fallback.
import { rtClient, rtReady, rtSend } from './rt.js';
export const relayReady = rtReady;
/** Join the room for a pairing code. Resolves to { send(data), close() } or null if the relay is off or unreachable. */
export async function joinRelay(code, onData) {
  if (!relayReady) return null;
  try {
    const sb = await rtClient();
    const ch = sb.channel('flyer-pad-' + String(code).toLowerCase(), { config: { broadcast: { self: false, ack: false } } });
    ch.on('broadcast', { event: 'm' }, msg => { try { onData(msg.payload && msg.payload.d); } catch (_) {} });
    return await new Promise(resolve => {
      const t = setTimeout(() => resolve(null), 10000);
      ch.subscribe(st => {
        if (st === 'SUBSCRIBED') { clearTimeout(t); resolve({ send: d => rtSend(ch, 'm', { d }), close: () => { try { sb.removeChannel(ch); } catch (_) {} } }); }
        else if (st === 'CHANNEL_ERROR' || st === 'TIMED_OUT') { clearTimeout(t); resolve(null); }
      });
    });
  } catch (_) { return null; }
}

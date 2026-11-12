// Test-only stand-in for Supabase Realtime: tabs of the same browser talk through a BroadcastChannel.
// Used by `FAKE_RT=1 vite build` so the race rooms can be tested where the real service is unreachable.
export function createClient() {
  return {
    channel(name, opts) {
      const me = (opts && opts.config && opts.config.presence && opts.config.presence.key) || Math.random().toString(36).slice(2);
      const bc = new BroadcastChannel('fake-rt-' + name), handlers = [], pres = {}; let myMeta = null;
      const sync = () => handlers.filter(h => h.type === 'presence').forEach(h => h.cb());
      bc.onmessage = ({ data: m }) => {
        if (m.k === 'b') handlers.filter(h => h.type === 'broadcast' && h.event === m.event).forEach(h => h.cb({ payload: m.payload }));
        else if (m.k === 'p') { const isNew = !pres[m.key]; pres[m.key] = [m.meta]; sync(); if (isNew && myMeta && !m.reply) bc.postMessage({ k: 'p', key: me, meta: myMeta, reply: true }); }
        else if (m.k === 'leave') { delete pres[m.key]; sync(); }
      };
      const ch = {
        on(type, filter, cb) { handlers.push({ type, event: filter.event, cb }); return ch; },
        state: 'closed',
        subscribe(cb) { setTimeout(() => { ch.state = 'joined'; cb('SUBSCRIBED'); }, 50); return ch; },
        async track(meta) { myMeta = meta; pres[me] = [meta]; sync(); bc.postMessage({ k: 'p', key: me, meta }); },
        untrack() { bc.postMessage({ k: 'leave', key: me }); },
        presenceState() { return pres; },
        send({ event, payload }) { bc.postMessage({ k: 'b', event, payload }); },
        _close() { bc.close(); },
      };
      return ch;
    },
    removeChannel(ch) { ch._close(); },
  };
}

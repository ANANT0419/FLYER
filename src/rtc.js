// A second way to build the direct phone-to-screen link, independent of the public PeerJS server.
// The two devices already share a relay room (relay.js); we pass the WebRTC handshake through it, then the tilt flows
// straight between the devices on an unordered, no-retry data channel (lowest delay: a late message is simply replaced).
const ICE = [{ urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'] }, { urls: 'stun:stun.cloudflare.com:3478' }];

function gathered(pc, ms) {   // wait for the network routes to be found (or give up after ms), so one message carries all of them
  return new Promise(res => {
    if (pc.iceGatheringState === 'complete') return res();
    const t = setTimeout(res, ms);
    pc.addEventListener('icegatheringstatechange', () => { if (pc.iceGatheringState === 'complete') { clearTimeout(t); res(); } });
  });
}
const wire = (ch, onMsg, onOpen, onClose) => {
  ch.onopen = () => onOpen(ch); ch.onclose = () => onClose(ch);
  ch.onmessage = e => { try { onMsg(JSON.parse(e.data)); } catch (_) {} };
};

/**
 * A second channel on a link that already exists (the PeerJS one), for the tilt itself. The PeerJS channel re-sends
 * every lost message until it arrives; after a Wi-Fi hiccup that holds everything back for a second or more (the
 * owner's recordings: silences of ~1.4 s, "network stalled"). This one never re-sends: a lost reading is simply
 * replaced by the next one 16 ms later. Both sides open it with the same number, so no extra handshake is needed;
 * if the other side is an older page it just never opens and the old channel carries on.
 */
export function fastChannel(pc, onMsg) {
  try {
    const ch = pc.createDataChannel('tilt-fast', { negotiated: true, id: 100, ordered: false, maxRetransmits: 0 });
    ch.onmessage = e => { try { onMsg(JSON.parse(e.data)); } catch (_) {} };
    return ch;
  } catch (_) { return null; }
}
const isOpen = ch => !!ch && ch.readyState === 'open';
export { isOpen as chOpen };

/** Phone side: offer a link. send(obj) goes over the relay. Returns { answer(sdp), close() }. */
export async function rtcOffer(send, onMsg, onOpen, onClose) {
  const pc = new RTCPeerConnection({ iceServers: ICE });
  const ch = pc.createDataChannel('tilt', { ordered: false, maxRetransmits: 0 });
  wire(ch, onMsg, onOpen, onClose);
  await pc.setLocalDescription(await pc.createOffer());
  await gathered(pc, 2500);
  send({ rtc: 'offer', sdp: pc.localDescription.sdp });
  return {
    async answer(sdp) { try { await pc.setRemoteDescription({ type: 'answer', sdp }); } catch (_) {} },
    close() { try { pc.close(); } catch (_) {} },
  };
}
/** Screen side: answer an offer that arrived over the relay. */
export async function rtcAnswer(sdp, send, onMsg, onOpen, onClose) {
  const pc = new RTCPeerConnection({ iceServers: ICE });
  pc.ondatachannel = e => wire(e.channel, onMsg, onOpen, onClose);
  await pc.setRemoteDescription({ type: 'offer', sdp });
  await pc.setLocalDescription(await pc.createAnswer());
  await gathered(pc, 2500);
  send({ rtc: 'answer', sdp: pc.localDescription.sdp });
  return { close() { try { pc.close(); } catch (_) {} } };
}

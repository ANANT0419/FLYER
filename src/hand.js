// Camera control: your flat hand is the glider.
// Fingertips up = climb, fingertips down = dive, roll the hand like a wing = turn, close a fist = boost.
// Works with either hand and follows whichever hand you bring up.

const BASE = import.meta.env.BASE_URL;
const BONES = [[0,1],[1,2],[2,3],[3,4],[0,5],[5,6],[6,7],[7,8],[5,9],[9,10],[10,11],[11,12],[9,13],[13,14],[14,15],[15,16],[13,17],[17,18],[18,19],[19,20],[0,17]];
const TIPS = [8, 12, 16, 20];
const PITCH_FULL = 0.56, ROLL_FULL = 0.66;   // radians of hand tilt for full deflection (~32 and ~38 degrees)
const PITCH_DEAD = 0.06, ROLL_DEAD = 0.07;
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

export const hand = {
  enabled: false,      // camera control switched on
  status: 'off',       // off | starting | ready | error
  error: '',
  tracking: false,     // a hand is being followed right now
  side: '',            // 'left' | 'right' (the player's own hand)
  L: 0, R: 0,          // arm values fed to the game (-1 up .. +1 down)
  pitch: 0, roll: 0,   // -1..1 after calibration (pitch + = climb, roll + = left)
  fist: false,
  openness: 1,
  calibrated: false,
  calibProgress: 0,    // 0..1 while holding steady
  lostFor: 0,          // seconds since the hand was last seen
  fps: 0,
};

let landmarker = null, video = null, stream = null, lastVideoTime = -1;
let neutral = { pitch: 0.12, roll: 0 };
let raw = { pitch: 0, roll: 0 }, smoothP = 0, smoothR = 0;
let calibHold = 0, calibSumP = 0, calibSumR = 0, calibN = 0, wantCalib = false;
let lastSeen = 0, lastT = 0, fpsN = 0, fpsT = 0;
let hands = [];          // last detection, for drawing
let activeIdx = -1;
const fistCbs = [], canvases = new Set();

export function onFist(cb) { fistCbs.push(cb); }
export function attachCanvas(c) { canvases.add(c); }
export function requestCalibration() { wantCalib = true; hand.calibrated = false; calibHold = 0; calibN = 0; calibSumP = calibSumR = 0; hand.calibProgress = 0; }

/** Pure maths, exported so it can be tested without a camera.
 *  world: 21 points in camera-aligned metres (x right in the raw image, y down, z away).
 *  Returns hand attitude in radians as the player sees it in a mirrored view. */
export function attitude(world) {
  const w = world[0];
  let tx = 0, ty = 0, tz = 0;
  for (const i of [8, 12, 16]) { tx += world[i].x; ty += world[i].y; tz += world[i].z; }
  // finger direction: wrist to the average of the three longest fingertips
  let fx = tx / 3 - w.x, fy = ty / 3 - w.y, fz = tz / 3 - w.z;
  const fl = Math.hypot(fx, fy, fz) || 1; fx /= fl; fy /= fl; fz /= fl;
  // wing line: across the knuckles, pinky to index
  let sx = world[5].x - world[17].x, sy = world[5].y - world[17].y, sz = world[5].z - world[17].z;
  const sl = Math.hypot(sx, sy, sz) || 1; sx /= sl; sy /= sl; sz /= sl;
  // point the wing line toward the player's right (the raw image is un-mirrored, so that is -x)
  if (sx > 0) { sx = -sx; sy = -sy; sz = -sz; }
  const pitch = Math.asin(clamp(-fy, -1, 1));                 // + = fingertips raised
  const roll = Math.atan2(sy, Math.hypot(sx, sz));            // + = right side dipped = banking right
  // openness: how far the fingertips are from the wrist, relative to the palm length
  const palm = Math.hypot(world[9].x - w.x, world[9].y - w.y, world[9].z - w.z) || 1e-3;
  let o = 0; for (const i of TIPS) o += Math.hypot(world[i].x - w.x, world[i].y - w.y, world[i].z - w.z);
  return { pitch, roll, openness: o / 4 / palm, wingConfidence: Math.abs(sx) };
}

const shape = (v, dead, full) => { const a = Math.abs(v); if (a < dead) return 0; const t = clamp((a - dead) / (full - dead), 0, 1); return Math.sign(v) * (t * 0.65 + t * t * 0.35); };

export async function enableHand() {
  if (hand.status === 'starting' || hand.status === 'ready') { hand.enabled = true; return true; }
  hand.status = 'starting'; hand.error = '';
  try {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) throw new Error('This browser cannot open the camera here (it needs https or localhost).');
    stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user', width: { ideal: 640 }, height: { ideal: 480 }, frameRate: { ideal: 60 } }, audio: false });
    video = document.createElement('video'); video.playsInline = true; video.muted = true; video.srcObject = stream; await video.play();
    if (!landmarker) {
      const { FilesetResolver, HandLandmarker } = await import('@mediapipe/tasks-vision');
      const files = await FilesetResolver.forVisionTasks(BASE + 'mediapipe');
      const make = delegate => HandLandmarker.createFromOptions(files, {
        baseOptions: { modelAssetPath: BASE + 'models/hand_landmarker.task', delegate },
        runningMode: 'VIDEO', numHands: 2, minHandDetectionConfidence: 0.5, minHandPresenceConfidence: 0.5, minTrackingConfidence: 0.5,
      });
      try { landmarker = await make('GPU'); } catch (_) { landmarker = await make('CPU'); }
    }
    hand.status = 'ready'; hand.enabled = true; lastVideoTime = -1; requestCalibration();
    return true;
  } catch (e) {
    stopStream();
    hand.status = 'error'; hand.enabled = false;
    hand.error = e && e.name === 'NotAllowedError' ? 'Camera permission was blocked. Allow the camera for this site and try again.'
      : e && e.name === 'NotFoundError' ? 'No camera was found on this device.'
      : 'Could not start camera control: ' + (e && e.message ? e.message : e);
    return false;
  }
}
function stopStream() { if (stream) for (const t of stream.getTracks()) t.stop(); stream = null; video = null; }
export function disableHand() { hand.enabled = false; hand.tracking = false; hand.L = hand.R = 0; hand.status = 'off'; stopStream(); hands = []; draw(); }

/** Call once per frame. Runs detection on new camera frames and updates `hand`. */
export function updateHand(now) {
  if (!hand.enabled || hand.status !== 'ready' || !video || video.readyState < 2) return;
  const dt = Math.min(0.1, lastT ? (now - lastT) / 1000 : 0.016); lastT = now;
  if (video.currentTime !== lastVideoTime) {
    lastVideoTime = video.currentTime;
    let res = null; try { res = landmarker.detectForVideo(video, now); } catch (_) { res = null; }
    fpsN++;
    hands = [];
    if (res && res.landmarks) for (let i = 0; i < res.landmarks.length; i++) {
      const lm = res.landmarks[i], wl = res.worldLandmarks && res.worldLandmarks[i]; if (!wl) continue;
      // the model labels hands as if the image were mirrored; the raw camera image is not, so swap
      const label = res.handednesses && res.handednesses[i] && res.handednesses[i][0] ? res.handednesses[i][0].categoryName : '';
      const side = label === 'Left' ? 'right' : label === 'Right' ? 'left' : '';
      let minX = 1, maxX = 0, minY = 1, maxY = 0; for (const p of lm) { minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x); minY = Math.min(minY, p.y); maxY = Math.max(maxY, p.y); }
      hands.push({ lm, wl, side, size: Math.max(maxX - minX, maxY - minY) });
    }
    pickActive();
    if (activeIdx >= 0) measure(hands[activeIdx], now);
  }
  fpsT += dt; if (fpsT >= 1) { hand.fps = Math.round(fpsN / fpsT); fpsN = 0; fpsT = 0; }
  hand.lostFor = (now - lastSeen) / 1000;
  hand.tracking = lastSeen > 0 && hand.lostFor < 0.35;
  // smooth toward the measured attitude; faster when the hand moves fast, calmer when it is still
  const tp = hand.tracking ? raw.pitch : 0, tr = hand.tracking ? raw.roll : 0;
  const k = (cur, target) => 1 - Math.exp(-dt * (9 + 60 * Math.min(1, Math.abs(target - cur) * 2.2)));
  if (!hand.fist || !hand.tracking) { smoothP += (tp - smoothP) * k(smoothP, tp); smoothR += (tr - smoothR) * k(smoothR, tr); }
  hand.pitch = shape(smoothP, PITCH_DEAD, PITCH_FULL);
  hand.roll = shape(-smoothR, ROLL_DEAD, ROLL_FULL);          // + = turn left, matching the game's arms
  const live = hand.tracking && hand.calibrated;
  hand.L = live ? clamp(hand.pitch + hand.roll, -1, 1) : 0;
  hand.R = live ? clamp(hand.pitch - hand.roll, -1, 1) : 0;
  draw();
}

// Follow one hand; switch when it leaves, or when the other hand is clearly the one being presented.
function pickActive() {
  if (!hands.length) { activeIdx = -1; return; }
  let cur = hands.findIndex(h => h.side && h.side === hand.side);
  let big = 0; for (let i = 1; i < hands.length; i++) if (hands[i].size > hands[big].size) big = i;
  if (cur < 0 || (big !== cur && hands[big].size > hands[cur].size * 1.35)) cur = big;
  activeIdx = cur; hand.side = hands[cur].side || hand.side;
}

function measure(h, now) {
  const a = attitude(h.wl);
  lastSeen = now; hand.openness = a.openness;
  const wasFist = hand.fist;
  if (!hand.fist && a.openness < 1.28) hand.fist = true; else if (hand.fist && a.openness > 1.55) hand.fist = false;
  if (hand.fist && !wasFist && hand.calibrated) for (const cb of fistCbs) { try { cb(); } catch (_) {} }
  if (hand.fist) return;                                       // a fist has no usable finger direction: hold the last attitude
  if (wantCalib) {
    // hold a flat hand steady for a moment; its attitude becomes "level"
    const steady = Math.abs(a.pitch - raw.pitch - neutral.pitch) < 0.09 && Math.abs(a.roll - raw.roll - neutral.roll) < 0.09 && a.openness > 1.6;
    if (steady) { calibHold += 1; calibSumP += a.pitch; calibSumR += a.roll; calibN++; } else { calibHold = 0; calibSumP = calibSumR = 0; calibN = 0; }
    hand.calibProgress = clamp(calibN / 22, 0, 1);
    if (calibN >= 22) { neutral = { pitch: calibSumP / calibN, roll: calibSumR / calibN }; wantCalib = false; hand.calibrated = true; hand.calibProgress = 1; smoothP = smoothR = 0; }
  }
  raw.pitch = a.pitch - neutral.pitch; raw.roll = a.roll - neutral.roll;
}

/* ---------- the tracking view: mirrored camera, hand skeleton, attitude dial ---------- */
function draw() {
  for (const c of canvases) {
    if (!c.isConnected || c.offsetParent === null) continue;
    const dpr = Math.min(2, window.devicePixelRatio || 1), W = c.clientWidth, H = c.clientHeight;
    if (!W || !H) continue;
    if (c.width !== Math.round(W * dpr)) { c.width = Math.round(W * dpr); c.height = Math.round(H * dpr); }
    const g = c.getContext('2d'); g.setTransform(dpr, 0, 0, dpr, 0, 0); g.clearRect(0, 0, W, H);
    g.fillStyle = '#0d1020'; g.fillRect(0, 0, W, H);
    if (video && video.readyState >= 2) {
      // cover-fit, mirrored like a selfie
      const vw = video.videoWidth, vh = video.videoHeight, sc = Math.max(W / vw, H / vh), dw = vw * sc, dh = vh * sc, ox = (W - dw) / 2, oy = (H - dh) / 2;
      g.save(); g.translate(W, 0); g.scale(-1, 1); g.globalAlpha = 0.62; g.drawImage(video, ox, oy, dw, dh); g.restore(); g.globalAlpha = 1;
      const px = p => W - (ox + p.x * dw), py = p => oy + p.y * dh;
      hands.forEach((h, i) => {
        const act = i === activeIdx, col = act ? (hand.fist ? '#86f0ff' : '#ffb04a') : 'rgba(255,246,234,.35)';
        g.lineCap = 'round'; g.strokeStyle = col; g.lineWidth = act ? Math.max(2, W / 110) : 1.5;
        if (act) { g.shadowColor = col; g.shadowBlur = 10; }
        g.beginPath(); for (const [a, b] of BONES) { g.moveTo(px(h.lm[a]), py(h.lm[a])); g.lineTo(px(h.lm[b]), py(h.lm[b])); } g.stroke(); g.shadowBlur = 0;
        g.fillStyle = act ? '#fff6ea' : 'rgba(255,246,234,.4)';
        for (let k = 0; k < 21; k++) { g.beginPath(); g.arc(px(h.lm[k]), py(h.lm[k]), act ? (TIPS.includes(k) ? W / 90 : W / 140) + 1 : 2, 0, 7); g.fill(); }
        if (act) { // a line showing where the glider is pointing
          const wx = px(h.lm[0]), wy = py(h.lm[0]), tx = (px(h.lm[8]) + px(h.lm[12]) + px(h.lm[16])) / 3, ty = (py(h.lm[8]) + py(h.lm[12]) + py(h.lm[16])) / 3;
          g.strokeStyle = 'rgba(134,240,255,.8)'; g.lineWidth = 2; g.setLineDash([5, 5]); g.beginPath(); g.moveTo(wx, wy); g.lineTo(wx + (tx - wx) * 1.45, wy + (ty - wy) * 1.45); g.stroke(); g.setLineDash([]);
        }
      });
    }
    // attitude dial: a little glider seen from behind, tilting and rising with your hand
    const r = Math.min(W, H) * 0.17, cx = W - r - 10, cy = H - r - 10;
    g.fillStyle = 'rgba(13,16,32,.72)'; g.strokeStyle = 'rgba(255,246,234,.25)'; g.lineWidth = 1; g.beginPath(); g.arc(cx, cy, r, 0, 7); g.fill(); g.stroke();
    g.strokeStyle = 'rgba(255,246,234,.18)'; g.beginPath(); g.moveTo(cx - r, cy); g.lineTo(cx + r, cy); g.stroke();
    if (hand.tracking) {
      g.save(); g.translate(cx, cy - hand.pitch * r * 0.6); g.rotate(-hand.roll * 0.9);
      g.strokeStyle = hand.fist ? '#86f0ff' : '#ffb04a'; g.lineWidth = 3; g.lineCap = 'round';
      g.beginPath(); g.moveTo(-r * 0.72, 0); g.lineTo(-r * 0.16, 0); g.moveTo(r * 0.16, 0); g.lineTo(r * 0.72, 0); g.stroke();
      g.fillStyle = g.strokeStyle; g.beginPath(); g.arc(0, 0, r * 0.11, 0, 7); g.fill(); g.restore();
    }
    // status strip
    const msg = hand.status === 'starting' ? 'Starting camera…' : !hand.tracking ? 'Show a flat hand' : !hand.calibrated ? 'Hold your hand flat and still' : hand.fist ? 'Fist: boost' : (hand.side ? hand.side.toUpperCase() + ' HAND' : 'HAND') + ' · tracking';
    g.font = '700 ' + Math.max(10, Math.round(W / 22)) + 'px "Bricolage Grotesque",system-ui,sans-serif'; g.textBaseline = 'top';
    const tw = g.measureText(msg).width; g.fillStyle = 'rgba(13,16,32,.72)'; g.fillRect(6, 6, tw + 14, Math.max(10, W / 22) + 10);
    g.fillStyle = hand.tracking && hand.calibrated ? '#9be08a' : '#ffb04a'; g.fillText(msg, 13, 11);
    if (wantCalib && hand.tracking) { g.fillStyle = 'rgba(255,246,234,.2)'; g.fillRect(0, H - 5, W, 5); g.fillStyle = '#9be08a'; g.fillRect(0, H - 5, W * hand.calibProgress, 5); }
  }
}

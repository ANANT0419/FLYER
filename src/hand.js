// Camera control: your flat hand is the glider.
// Fingertips up = climb, fingertips down = dive, roll the hand like a wing = turn, close a fist = boost.
// Works with either hand and follows whichever hand you bring up.

import { obj, objStartLearning, objStep, objDraw } from './objtrack.js';
const BASE = import.meta.env.BASE_URL;
const BONES = [[0,1],[1,2],[2,3],[3,4],[0,5],[5,6],[6,7],[7,8],[5,9],[9,10],[10,11],[11,12],[9,13],[13,14],[14,15],[15,16],[13,17],[17,18],[18,19],[19,20],[0,17]];
const TIPS = [8, 12, 16, 20];
// How far the hand must tilt (radians) for full deflection. The defaults follow what a wrist can do comfortably:
// bending down goes further than bending up, and a palm-down hand rolls outward (thumb rising) much further than inward.
// The setup screen replaces these with the player's own reach.
const DEFAULT_RANGE = { up: 0.48, down: 0.54, out: 0.6, inn: 0.36 };
const PITCH_DEAD = 0.045, ROLL_DEAD = 0.055;
const FINGER_SPAN = 2.9;      // wrist-to-fingertip length in knuckle-widths, as seen end-on (nearer fingertips look bigger)
const CAM_VFOV = 0.72;        // typical webcam vertical field of view, radians
const load = (k, d) => { try { const v = JSON.parse(localStorage.getItem('flyer.' + k)); return v == null ? d : v; } catch (_) { return d; } };
const save = (k, v) => { try { localStorage.setItem('flyer.' + k, JSON.stringify(v)); } catch (_) {} };
const OBJ_RANGE = { up: 0.45, down: 0.45, out: 0.55, inn: 0.55 };
const rangeKey = () => (hand.mode === 'object' ? 'objRange' : 'handRange'), rangeDef = () => (hand.mode === 'object' ? OBJ_RANGE : DEFAULT_RANGE);
let range = Object.assign({}, DEFAULT_RANGE, load('handRange', null) || {});
let pushFrames = 0;
let learning = false, peak = { up: 0, down: 0, out: 0, inn: 0 };

// One Euro filter: heavy smoothing while the hand is still (kills jitter), light smoothing while it moves (no lag).
class OneEuro {
  constructor(minCut, beta) { this.minCut = minCut; this.beta = beta; this.x = null; this.dx = 0; }
  reset() { this.x = null; this.dx = 0; }
  step(x, dt) {
    if (this.x === null) { this.x = x; return x; }
    const a = c => 1 / (1 + 1 / (2 * Math.PI * c * dt));
    const dx = (x - this.x) / dt; this.dx += (dx - this.dx) * a(1.0);
    this.x += (x - this.x) * a(this.minCut + this.beta * Math.abs(this.dx));
    return this.x;
  }
}
const fPitch = new OneEuro(0.9, 3.2), fRoll = new OneEuro(0.9, 3.2);
const med3 = (h, v) => { h.push(v); if (h.length > 3) h.shift(); if (h.length < 3) return v; const [a, b, c] = h; return Math.max(Math.min(a, b), Math.min(Math.max(a, b), c)); };
let histP = [], histR = [], fistFrames = 0, lastMeasureT = 0;
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
function load0(k, d) { try { const v = JSON.parse(localStorage.getItem('flyer.' + k)); return v == null ? d : v; } catch (_) { return d; } }

export const hand = {
  enabled: false,      // camera control switched on
  mode: load0('camMode', 'hand'),   // 'hand' = bare hand, 'object' = any held object
  status: 'off',       // off | starting | ready | error
  error: '',
  tracking: false,     // a hand is being followed right now
  side: '',            // 'left' | 'right' (the player's own hand)
  L: 0, R: 0,          // arm values fed to the game (-1 up .. +1 down)
  pitch: 0, roll: 0,   // -1..1 after calibration (pitch + = climb, roll + = left)
  fist: false,
  openness: 1,
  sens: load('handSens', 1),   // extra hand sensitivity, 0.6 .. 1.6
  rawPitch: 0, rawRoll: 0,     // filtered tilt in radians after levelling (roll + = banking right)
  calibrated: false,
  calibProgress: 0,    // 0..1 while holding steady
  lostFor: 0,          // seconds since the hand was last seen
  fps: 0,
};

let landmarker = null, video = null, stream = null, lastVideoTime = -1;
let neutral = { pitch: 0, roll: 0 };
let raw = { pitch: 0, roll: 0 }, smoothP = 0, smoothR = 0;
let calibHold = 0, calibSumP = 0, calibSumR = 0, calibN = 0, wantCalib = false;
let lastSeen = 0, lastT = 0, fpsN = 0, fpsT = 0;
let hands = [];          // last detection, for drawing
let activeIdx = -1;
const fistCbs = [], canvases = new Set();

export function onFist(cb) { fistCbs.push(cb); }
export function attachCanvas(c) { canvases.add(c); }
export function setHandSens(v) { hand.sens = clamp(+v || 1, 0.6, 1.6); save('handSens', hand.sens); }
/** While learning, the furthest comfortable tilt in each direction is recorded; commit turns it into the player's own range. */
export function beginRangeLearning() { learning = true; peak = { up: 0, down: 0, out: 0, inn: 0 }; }
export function commitRangeLearning() {
  if (!learning) return; learning = false;
  for (const k in peak) if (peak[k] > 0.2) range[k] = clamp(peak[k] * 0.8, 0.2, 0.95);
  save(rangeKey(), range);
}
/** Switch between bare-hand and any-object tracking. */
export function setCamMode(m) { hand.mode = m === 'object' ? 'object' : 'hand'; save('camMode', hand.mode); range = Object.assign({}, rangeDef(), load(rangeKey(), null) || {}); hand.fist = false; requestCalibration(); }
export function resetHandRange() { range = Object.assign({}, rangeDef()); save(rangeKey(), range); }
export function requestCalibration() { fPitch.reset(); fRoll.reset(); histP = []; histR = []; if (hand.mode === 'object') objStartLearning(); wantCalib = true; hand.calibrated = false; calibHold = 0; calibN = 0; calibSumP = calibSumR = 0; hand.calibProgress = 0; }

/** Pure maths, exported so it can be tested without a camera.
 *  The hand is held flat, palm down, fingers pointing at the screen. Seen from the camera that pose makes depth
 *  unreliable, so tilt is read from the image itself, where the tracker is steady:
 *   - roll  = the slope of the knuckle line (index knuckle to little-finger knuckle)
 *   - pitch = how far the fingertips sit above or below the wrist, measured across that line, in knuckle-widths
 *  lm: 21 image points (x right, y down, 0..1, raw un-mirrored camera). world: the same in metres. aspect: width / height. */
export function attitude(lm, world, aspect) {
  const X = p => (1 - p.x) * aspect, Y = p => p.y;                    // mirrored, square units
  let kx = X(lm[5]) - X(lm[17]), ky = Y(lm[5]) - Y(lm[17]);
  if (kx < 0) { kx = -kx; ky = -ky; }                                  // knuckle line, pointing to the player's right
  const W = Math.hypot(kx, ky) || 1e-4; kx /= W; ky /= W;
  const roll = Math.atan2(ky, kx);                                     // + = right side lower = banking right
  const tx = (X(lm[8]) + X(lm[12]) + X(lm[16])) / 3 - X(lm[0]), ty = (Y(lm[8]) + Y(lm[12]) + Y(lm[16])) / 3 - Y(lm[0]);
  const lift = (tx * ky - ty * kx) / W;                                // fingertips above the wrist, across the knuckle line
  let pitch = Math.asin(clamp(lift / FINGER_SPAN, -1, 1));
  // a hand held low in the frame is seen from above and looks tipped down; undo that so moving the hand does not steer
  const cy = (lm[0].y + lm[9].y) / 2;
  pitch += Math.atan((cy - 0.5) * 2 * Math.tan(CAM_VFOV / 2));
  // open or fist: fingertip distance from the wrist against palm length, in 3D
  const w = world[0], palm = Math.hypot(world[9].x - w.x, world[9].y - w.y, world[9].z - w.z) || 1e-3;
  let o = 0; for (const i of TIPS) o += Math.hypot(world[i].x - w.x, world[i].y - w.y, world[i].z - w.z);
  return { pitch, roll, openness: o / 4 / palm };
}

// dead zone at the centre, then a curve that is gentle near level and firm toward the end of the reach
const shape = (v, dead, full) => { const a = Math.abs(v); if (a < dead) return 0; const t = clamp((a - dead) / Math.max(0.05, full - dead), 0, 1); return Math.sign(v) * (t * 0.6 + t * t * 0.4); };

export async function enableHand() {
  if (hand.status === 'starting' || hand.status === 'ready') { hand.enabled = true; return true; }
  hand.status = 'starting'; hand.error = '';
  range = Object.assign({}, rangeDef(), load(rangeKey(), null) || {});
  try {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) throw new Error('This browser cannot open the camera here (it needs https or localhost).');
    stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user', width: { ideal: 640 }, height: { ideal: 480 }, frameRate: { ideal: 60 } }, audio: false });
    video = document.createElement('video'); video.playsInline = true; video.muted = true; video.srcObject = stream; await video.play();
    if (!landmarker) {
      const { FilesetResolver, HandLandmarker } = await import('@mediapipe/tasks-vision');
      const files = await FilesetResolver.forVisionTasks(BASE + 'mediapipe');
      const make = delegate => HandLandmarker.createFromOptions(files, {
        baseOptions: { modelAssetPath: BASE + 'models/hand_landmarker.task', delegate },
        runningMode: 'VIDEO', numHands: 2, minHandDetectionConfidence: 0.4, minHandPresenceConfidence: 0.4, minTrackingConfidence: 0.4,
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
    fpsN++;
    hands = [];
    if (hand.mode === 'object') { measureObject(now); }
    else {
    let res = null; try { res = landmarker.detectForVideo(video, now); } catch (_) { res = null; }
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
  }
  fpsT += dt; if (fpsT >= 1) { hand.fps = Math.round(fpsN / fpsT); fpsN = 0; fpsT = 0; }
  hand.lostFor = (now - lastSeen) / 1000;
  hand.tracking = lastSeen > 0 && hand.lostFor < 0.35;
  // the filtered tilt arrives at camera rate; glide toward it so the suit moves smoothly between camera frames
  const tp = hand.tracking ? raw.pitch : 0, tr = hand.tracking ? raw.roll : 0, g = 1 - Math.exp(-dt * (hand.tracking ? 26 : 6));
  smoothP += (tp - smoothP) * g; smoothR += (tr - smoothR) * g;
  hand.rawPitch = smoothP; hand.rawRoll = smoothR;
  // a palm-down hand rolls outward (thumb rising) further than inward, and which way is "outward" depends on the hand
  const rightHand = hand.side !== 'left', bankRight = smoothR > 0, outward = hand.mode === 'object' ? true : bankRight === rightHand;
  hand.pitch = shape(smoothP * hand.sens, PITCH_DEAD, smoothP > 0 ? range.up : range.down);
  hand.roll = shape(-smoothR * hand.sens, ROLL_DEAD, outward ? range.out : range.inn);   // + = turn left, matching the game's arms
  if (learning && hand.tracking && hand.calibrated && !hand.fist) {
    if (smoothP > peak.up) peak.up = smoothP; if (-smoothP > peak.down) peak.down = -smoothP;
    const ar = Math.abs(smoothR); if (outward) { if (ar > peak.out) peak.out = ar; } else if (ar > peak.inn) peak.inn = ar;
  }
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

// Any-object mode: height in the frame is climb and dive, the object's long axis is the roll, a push toward the camera is boost.
function measureObject(now) {
  const dt = clamp(lastMeasureT ? (now - lastMeasureT) / 1000 : 1 / 30, 1 / 120, 0.2); lastMeasureT = now;
  const found = objStep(video);
  hand.objState = obj.state;
  hand.calibProgress = obj.state === 'tracking' ? 1 : obj.learnProgress;
  if (obj.state === 'tracking' && wantCalib) { wantCalib = false; hand.calibrated = true; smoothP = smoothR = 0; fPitch.reset(); fRoll.reset(); }
  if (obj.state === 'idle' && obj.learnFailed && wantCalib) objStartLearning();      // nothing stood out: keep trying
  if (!found) { pushFrames = 0; return; }
  lastSeen = now; hand.side = '';
  // moving up a fifth of the frame counts like a 25 degree tilt, so the same reach-learning works for both modes
  const p = fPitch.step((obj.neutral.cy - obj.cy) * 2.2, dt), r = fRoll.step(obj.angle - obj.neutral.angle, dt);
  raw.pitch = p; raw.roll = obj.elong > 1.25 ? r : raw.roll * 0.9;   // a round blob has no reliable long axis
  const wasFist = hand.fist;
  if (obj.push > 1.7) pushFrames = Math.min(pushFrames + 1, 6); else if (obj.push < 1.3) pushFrames = 0;
  hand.fist = pushFrames >= 3;
  if (hand.fist && !wasFist && hand.calibrated) for (const cb of fistCbs) { try { cb(); } catch (_) {} }
}

function measure(h, now) {
  const a = attitude(h.lm, h.wl, video.videoWidth / (video.videoHeight || 1));
  const dt = clamp(lastMeasureT ? (now - lastMeasureT) / 1000 : 1 / 30, 1 / 120, 0.2); lastMeasureT = now;
  lastSeen = now; hand.openness = a.openness;
  // a fist must hold for a few camera frames, so one bad frame cannot fire the boost or freeze the steering
  const wasFist = hand.fist;
  if (a.openness < 1.2) fistFrames = Math.min(fistFrames + 1, 6); else if (a.openness > 1.5) fistFrames = 0;
  hand.fist = fistFrames >= 3;
  if (hand.fist && !wasFist && hand.calibrated) for (const cb of fistCbs) { try { cb(); } catch (_) {} }
  if (fistFrames > 0) return;                                  // closing or closed: hold the last tilt
  const p = fPitch.step(med3(histP, a.pitch), dt), r = fRoll.step(med3(histR, a.roll), dt);
  if (wantCalib) {
    // hold a flat hand steady for a moment; its tilt becomes "level"
    const steady = Math.abs(a.pitch - p) < 0.07 && Math.abs(a.roll - r) < 0.07 && a.openness > 1.5;
    if (steady) { calibSumP += p; calibSumR += r; calibN++; } else { calibSumP = calibSumR = 0; calibN = 0; }
    hand.calibProgress = clamp(calibN / 24, 0, 1);
    if (calibN >= 24) { neutral = { pitch: calibSumP / calibN, roll: calibSumR / calibN }; wantCalib = false; hand.calibrated = true; hand.calibProgress = 1; smoothP = smoothR = 0; }
  }
  raw.pitch = p - neutral.pitch; raw.roll = r - neutral.roll;
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
      if (hand.mode === 'object') objDraw(g, ox, oy, dw, dh);
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
    const msg = hand.status === 'starting' ? 'Starting camera…' : hand.mode === 'object' ? (obj.state === 'empty' ? 'Keep the box empty' : obj.state !== 'tracking' ? 'Hold your object in the box' : !hand.tracking ? 'Object lost: bring it back' : hand.fist ? 'Push: boost' : 'OBJECT · tracking') : !hand.tracking ? 'Point a flat hand at the screen' : !hand.calibrated ? 'Hold your hand flat and still' : hand.fist ? 'Fist: boost' : (hand.side ? hand.side.toUpperCase() + ' HAND' : 'HAND') + ' · tracking';
    g.font = '700 ' + Math.max(10, Math.round(W / 22)) + 'px "Bricolage Grotesque",system-ui,sans-serif'; g.textBaseline = 'top';
    const tw = g.measureText(msg).width; g.fillStyle = 'rgba(13,16,32,.72)'; g.fillRect(6, 6, tw + 14, Math.max(10, W / 22) + 10);
    g.fillStyle = hand.tracking && hand.calibrated ? '#9be08a' : '#ffb04a'; g.fillText(msg, 13, 11);
    if (wantCalib && (hand.tracking || hand.mode === 'object')) { g.fillStyle = 'rgba(255,246,234,.2)'; g.fillRect(0, H - 5, W, 5); g.fillStyle = '#9be08a'; g.fillRect(0, H - 5, W * hand.calibProgress, 5); }
  }
}

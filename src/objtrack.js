// Any-object camera control. Hold up something with a colour that stands out (a notebook, a bottle, a toy),
// let the game learn it, then: raise it to climb, lower it to dive, tilt it like a wing to turn,
// push it toward the camera to boost. Learn a different object whenever you like.
//
// How: while learning, colours inside the on-screen box are compared with colours outside it. Afterwards every
// camera frame is searched for those colours near where the object was last seen; the blob's centre gives
// height and its long axis gives tilt.
const W = 160, H = 120, BINS = 16 * 16 * 4;
const BOX = { x0: 0.3, x1: 0.7, y0: 0.3, y1: 0.7 };
const cv = typeof document !== 'undefined' ? document.createElement('canvas') : null;
if (cv) { cv.width = W; cv.height = H; }
const ctx = cv ? cv.getContext('2d', { willReadFrequently: true }) : null;
const mask = new Uint8Array(W * H);
let hObj = new Float32Array(BINS), hBg = new Float32Array(BINS), like = new Float32Array(BINS);

export const obj = {
  state: 'idle',        // idle | empty (learning the room) | learning (learning the object) | tracking
  learnProgress: 0, found: false,
  cx: 0.5, cy: 0.5, angle: 0, area: 0, elong: 1,     // mirrored, 0..1; angle in radians
  neutral: { cy: 0.5, angle: 0, area: 0.05 },
  push: 1,              // current size relative to the learned size
};
let learnN = 0, emptyN = 0, lastAngle = 0, lostFrames = 99;
const EMPTY_FRAMES = 24, LEARN_FRAMES = 30;

const bin = (r, g, b) => { const s = r + g + b + 1; return (Math.min(15, (r * 16 / s) | 0) * 16 + Math.min(15, (g * 16 / s) | 0)) * 4 + Math.min(3, s >> 8 > 2 ? 3 : (s / 192) | 0); };

export function objStartLearning() { hObj.fill(0); hBg.fill(0); learnN = 0; emptyN = 0; obj.state = 'empty'; obj.learnProgress = 0; obj.found = false; lostFrames = 99; }

/** Blob statistics for a mask (exported for tests). Returns null if too few pixels. */
export function blobStats(m, w, h, x0, y0, x1, y1) {
  let n = 0, sx = 0, sy = 0, sxx = 0, syy = 0, sxy = 0;
  for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) if (m[y * w + x]) { n++; sx += x; sy += y; sxx += x * x; syy += y * y; sxy += x * y; }
  if (n < 30) return null;
  const mx = sx / n, my = sy / n, a = sxx / n - mx * mx, b = sxy / n - mx * my, c = syy / n - my * my;
  const d = Math.sqrt((a - c) * (a - c) / 4 + b * b), l1 = (a + c) / 2 + d, l2 = Math.max(1e-6, (a + c) / 2 - d);
  return { n, mx, my, angle: 0.5 * Math.atan2(2 * b, a - c), elong: Math.sqrt(l1 / l2) };
}

/** Process one camera frame. Returns true when the object was found. */
export function objStep(video) {
  if (!ctx || obj.state === 'idle') return false;
  ctx.save(); ctx.translate(W, 0); ctx.scale(-1, 1); ctx.drawImage(video, 0, 0, W, H); ctx.restore();   // mirrored, like the view
  const px = ctx.getImageData(0, 0, W, H).data;
  if (obj.state === 'empty') {
    // first, the scene without the object: you, your clothes, the room. Whatever is here is not the object.
    for (let i = 0; i < W * H * 4; i += 4) hBg[bin(px[i], px[i + 1], px[i + 2])] += 2;
    emptyN++; obj.learnProgress = 0.45 * Math.min(1, emptyN / EMPTY_FRAMES);
    if (emptyN >= EMPTY_FRAMES) obj.state = 'learning';
    return false;
  }
  if (obj.state === 'learning') {
    const bx0 = BOX.x0 * W, bx1 = BOX.x1 * W, by0 = BOX.y0 * H, by1 = BOX.y1 * H;
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const i = (y * W + x) * 4, k = bin(px[i], px[i + 1], px[i + 2]);
      const inner = x > bx0 + 6 && x < bx1 - 6 && y > by0 + 6 && y < by1 - 6, outer = x < bx0 - 10 || x > bx1 + 10 || y < by0 - 10 || y > by1 + 10;
      if (inner) hObj[k]++; else if (outer) hBg[k]++;
    }
    learnN++; obj.learnProgress = 0.45 + 0.55 * Math.min(1, learnN / LEARN_FRAMES);
    if (learnN >= LEARN_FRAMES) {
      let so = 0, sb = 0; for (let k = 0; k < BINS; k++) { so += hObj[k]; sb += hBg[k]; }
      for (let k = 0; k < BINS; k++) { const o = hObj[k] / so, b = hBg[k] / sb; like[k] = o > 0.004 ? o / (o + b * 4 + 1e-6) : 0; }
      obj.state = 'tracking'; lostFrames = 99;
      if (find(px, true)) { obj.neutral = { cy: obj.cy, angle: obj.angle, area: obj.area }; lastAngle = obj.angle; }
      else { obj.state = 'idle'; obj.learnFailed = true; return false; }   // nothing distinctive was in the box
      obj.learnFailed = false;
    }
    return false;
  }
  return find(px, false);
}

function find(px, first) {
  // look near where it was; if it has been lost for a while, look everywhere
  let x0 = 0, y0 = 0, x1 = W, y1 = H;
  if (first) { x0 = (BOX.x0 * W) | 0; x1 = (BOX.x1 * W) | 0; y0 = (BOX.y0 * H) | 0; y1 = (BOX.y1 * H) | 0; }
  else if (lostFrames < 12) { const r = Math.max(28, Math.sqrt(obj.area * W * H) * 2.2); x0 = Math.max(0, (obj.cx * W - r) | 0); x1 = Math.min(W, (obj.cx * W + r) | 0); y0 = Math.max(0, (obj.cy * H - r) | 0); y1 = Math.min(H, (obj.cy * H + r) | 0); }
  mask.fill(0);
  for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) { const i = (y * W + x) * 4; if (like[bin(px[i], px[i + 1], px[i + 2])] > 0.62) mask[y * W + x] = 1; }
  const s = blobStats(mask, W, H, x0, y0, x1, y1);
  if (!s || s.n > W * H * 0.6) { lostFrames++; obj.found = false; return false; }
  let a = s.angle;                                   // an axis has no front or back: keep it on the same side as last time
  while (a - lastAngle > Math.PI / 2) a -= Math.PI; while (a - lastAngle < -Math.PI / 2) a += Math.PI;
  lastAngle = a; lostFrames = 0;
  obj.cx = s.mx / W; obj.cy = s.my / H; obj.angle = a; obj.area = s.n / (W * H); obj.elong = s.elong; obj.found = true;
  obj.push = obj.neutral.area > 0 ? obj.area / obj.neutral.area : 1;
  return true;
}

/** Draw the learning box, or the tracked object's outline and axis, over the camera view. */
export function objDraw(g, ox, oy, dw, dh) {
  if (obj.state !== 'tracking') {
    g.strokeStyle = '#86f0ff'; g.lineWidth = 2; g.setLineDash([8, 6]);
    g.strokeRect(ox + BOX.x0 * dw, oy + BOX.y0 * dh, (BOX.x1 - BOX.x0) * dw, (BOX.y1 - BOX.y0) * dh); g.setLineDash([]);
    return;
  }
  // tint the pixels that count as the object
  g.fillStyle = 'rgba(255,176,74,.5)'; const sx = dw / W, sy = dh / H;
  for (let y = 0; y < H; y += 2) for (let x = 0; x < W; x += 2) if (mask[y * W + x]) g.fillRect(ox + x * sx, oy + y * sy, sx * 2, sy * 2);
  if (!obj.found) return;
  const cx = ox + obj.cx * dw, cy = oy + obj.cy * dh, L = Math.sqrt(obj.area) * dw * 0.9;
  g.strokeStyle = '#86f0ff'; g.lineWidth = 3; g.lineCap = 'round'; g.shadowColor = '#86f0ff'; g.shadowBlur = 10;
  g.beginPath(); g.moveTo(cx - Math.cos(obj.angle) * L, cy - Math.sin(obj.angle) * L); g.lineTo(cx + Math.cos(obj.angle) * L, cy + Math.sin(obj.angle) * L); g.stroke(); g.shadowBlur = 0;
  g.fillStyle = '#fff6ea'; g.beginPath(); g.arc(cx, cy, 5, 0, 7); g.fill();
  g.strokeStyle = 'rgba(255,246,234,.35)'; g.lineWidth = 1; g.setLineDash([4, 6]); g.beginPath(); g.moveTo(ox, oy + obj.neutral.cy * dh); g.lineTo(ox + dw, oy + obj.neutral.cy * dh); g.stroke(); g.setLineDash([]);
}

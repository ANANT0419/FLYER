// Halcyon Skyway: the minimalist race track (owner's choices, round 6: pastel sky, about a minute long, with the
// phases "colour flip", "pulsing gates" and "big drop and slalom"; light scenery so it runs smoothly with friends).
// Everything here is a handful of draw calls: a gradient sky, a soft sea of clouds, one batch of cloud puffs, one of
// light pylons for the slalom and one of big rings down the drop. The colours of the whole world come from a palette
// that the game flips as you fly through gates.
import * as THREE from 'three';

const ss = (a, b, x) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
const on = (s, a, b, w) => ss(a - w, a + w, s) * (1 - ss(b - w, b + w, s));

// Where each phase runs, in metres along the track.
export const SKY_PH = { open: [0, 1500], pulse: [1500, 3600], drop: [3850, 4550], slalom: [4900, 6900], climb: [7000, 7800], end: 8700 };
export const SKY_FLOOR = 4;   // the top of the cloud sea (metres); touching it ends like any other crash

/** The shape of the track at s metres: [turn (radians per metre, + = left), slope (metres up per metre)]. */
export function skyShape(s) {
  const P = SKY_PH; let turn = 0, slope = -0.045;
  turn += on(s, 250, P.open[1], 150) * 0.0013 * Math.sin(s / 250);                          // opening: wide lazy curves
  const pu = on(s, P.pulse[0], P.pulse[1], 150);
  turn += pu * 0.0021 * Math.sin(s / 200 + 1.2); slope += pu * 0.085 * Math.sin(s / 240);   // pulsing gates: rolling waves
  slope += on(s, 3620, 3800, 60) * 0.2;                                                     // the lip before the drop
  slope += on(s, P.drop[0], P.drop[1], 130) * -0.62;                                        // the big drop
  const sl = on(s, P.slalom[0], P.slalom[1], 200);
  turn += sl * 0.0036 * Math.cos((s - P.slalom[0]) * 2 * Math.PI / 520);                    // slalom: left, right, left...
  slope += on(s, P.climb[0], P.climb[1], 160) * 0.33;                                       // the soaring climb out
  turn += on(s, P.climb[0], P.end, 200) * 0.0009 * Math.sin(s / 300);
  return [turn, slope];
}

/** Control points of the centre line, 100 m apart, heading toward -Z like the other tracks. */
export function skyPoints() {
  const SEG = 100, n = Math.round(SKY_PH.end / SEG) + 1, pts = []; let x = 0, y = 0, z = 0, hd = 0, minY = 0;
  for (let i = 0; i < n; i++) {
    pts.push(new THREE.Vector3(x, y, z)); minY = Math.min(minY, y);
    const [turn, slope] = skyShape(i * SEG + SEG / 2); hd += turn * SEG; const run = SEG / Math.hypot(1, slope);
    x -= Math.sin(hd) * run; z -= Math.cos(hd) * run; y += slope * run;
  }
  for (const p of pts) p.y += 62 - minY;    // the lowest stretch (the end of the slalom) skims ~85 m above the clouds
  return pts;
}

// Four pastel moods. top / mid / hor: the sky from overhead to the horizon; cloud / shade: the cloud sea; sun: its glow.
const hex = h => new THREE.Color(h);
export const PALETTES = [
  { top: '#6f9ae6', mid: '#eeb0cb', hor: '#f7d9c0', cloud: '#f6ebe2', shade: '#e4b2c6', sun: '#fff1d6' },   // peach morning
  { top: '#7f8dea', mid: '#b3a4ee', hor: '#bfe9db', cloud: '#e6f6f0', shade: '#9fd3ca', sun: '#f4fff0' },   // mint and lilac
  { top: '#ea9550', mid: '#f3b878', hor: '#f7e4b0', cloud: '#f6ecd0', shade: '#e8b47c', sun: '#ffffff' },   // apricot
  { top: '#5262c0', mid: '#e888ac', hor: '#f7bf98', cloud: '#f4d8cc', shade: '#d28eb0', sun: '#fff0dc' },   // rose dusk
].map(p => Object.fromEntries(Object.entries(p).map(([k, v]) => [k, hex(v)])));
export const NIGHT = Object.fromEntries(Object.entries({ top: '#1c2150', mid: '#463c8a', hor: '#9278cc', cloud: '#c6b6ee', shade: '#6a5eb2', sun: '#e8dcff' }).map(([k, v]) => [k, hex(v)]));

/**
 * Builds the sky world into the scene. o: { scene, timeU, worldAt(s,d,h,out), frame(s) -> {c,r,t}, floorY(s), LEN, isTouch, rnd }.
 * Returns { update(dt, camera, s), setPalette(i), palette }.
 */
export function buildSkyWorld(o) {
  const { scene, timeU, isTouch, rnd } = o, P = SKY_PH;
  const cur = Object.fromEntries(Object.entries(PALETTES[0]).map(([k, v]) => [k, v.clone()])); let target = 0;
  const U = { top: { value: cur.top }, mid: { value: cur.mid }, hor: { value: cur.hor }, cloud: { value: cur.cloud }, shade: { value: cur.shade }, sun: { value: cur.sun }, uTime: timeU,
    sunDir: { value: new THREE.Vector3(-0.3, 0.32, -1).normalize() } };

  // the sky: three-colour gradient with a soft pale sun and a few faint high streaks
  const dome = new THREE.Mesh(new THREE.SphereGeometry(2600, 24, 12), new THREE.ShaderMaterial({ side: THREE.BackSide, depthWrite: false, fog: false, uniforms: U,
    vertexShader: 'varying vec3 vW;void main(){vW=normalize(position);gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}',
    fragmentShader: `uniform vec3 top,mid,hor,sun,sunDir;uniform float uTime;varying vec3 vW;
void main(){vec3 d=normalize(vW);float h=d.y;
vec3 c=mix(hor,mid,smoothstep(-0.02,0.22,h));c=mix(c,top,smoothstep(0.16,0.75,h));
float sd=max(dot(d,sunDir),0.0);c+=sun*(pow(sd,90.0)*0.35+pow(sd,7.0)*0.14);
float st=sin(d.x*9.0/(abs(h)+0.25)+uTime*0.02)*sin(d.z*5.0/(abs(h)+0.25)+1.7);c=mix(c,hor,smoothstep(0.55,1.0,st)*0.16*smoothstep(0.05,0.3,h));
gl_FragColor=vec4(c,1.0);}` }));
  dome.renderOrder = -1; dome.frustumCulled = false; scene.add(dome);

  // the sea of clouds: one flat sheet that follows you, soft billows drifting slowly, melting into the horizon colour
  const sea = new THREE.Mesh(new THREE.PlaneGeometry(9000, 9000, 1, 1), new THREE.ShaderMaterial({ fog: false, uniforms: U,
    vertexShader: 'varying vec3 vP;void main(){vec4 w=modelMatrix*vec4(position,1.0);vP=w.xyz;gl_Position=projectionMatrix*viewMatrix*w;}',
    fragmentShader: `uniform vec3 hor,cloud,shade;uniform float uTime;varying vec3 vP;
float hsh(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}
float vn(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*(3.0-2.0*f);return mix(mix(hsh(i),hsh(i+vec2(1.0,0.0)),f.x),mix(hsh(i+vec2(0.0,1.0)),hsh(i+vec2(1.0,1.0)),f.x),f.y);}
void main(){vec2 p=vP.xz*0.0016+vec2(uTime*0.004,0.0);float n=vn(p)*0.55+vn(p*2.7+3.1)*0.3+vn(p*6.3-1.7)*0.15;
float b=smoothstep(0.32,0.72,n);vec3 c=mix(shade,cloud,b);c=mix(c,cloud*1.03,smoothstep(0.62,0.8,n)*0.6);
float dist=length(vP.xz-cameraPosition.xz);c=mix(c,hor,smoothstep(700.0,3600.0,dist));gl_FragColor=vec4(c,1.0);}` }));
  sea.rotation.x = -Math.PI / 2; sea.position.y = SKY_FLOOR - 4; sea.frustumCulled = false; scene.add(sea);

  // cloud puffs beside the track: a few round lumps each, all in one batch
  const puffMat = new THREE.MeshLambertMaterial({ color: 0xffffff, emissive: 0x777788, flatShading: false });
  const lumps = []; const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), v = new THREE.Vector3(), sc = new THREE.Vector3(), c0 = new THREE.Vector3();
  const R = (a, b) => a + (b - a) * rnd();
  for (let s = 150; s < o.LEN; s += R(isTouch ? 150 : 95, isTouch ? 260 : 170)) {
    const inSlalom = s > P.slalom[0] - 200 && s < P.slalom[1] + 200, side = rnd() < 0.5 ? -1 : 1;
    o.worldAt(s, side * R(inSlalom ? 110 : 70, 420), 0, c0); c0.y = o.floorY(s) + 60 + R(-150, 90); if (c0.y < SKY_FLOOR + 30) c0.y = SKY_FLOOR + R(18, 40);
    const big = R(16, 44), k = 3 + Math.floor(rnd() * 3);
    for (let i = 0; i < k; i++) { v.set(c0.x + R(-1, 1) * big * 1.3, c0.y + R(-0.25, 0.3) * big, c0.z + R(-1, 1) * big * 1.3); const r = big * R(0.55, 1); sc.set(r * R(1, 1.5), r * R(0.55, 0.8), r * R(1, 1.5)); lumps.push(m4.compose(v, q, sc).clone()); }
  }
  const puffs = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(1, 2), puffMat, lumps.length); lumps.forEach((m, i) => puffs.setMatrixAt(i, m)); puffs.frustumCulled = false; scene.add(puffs);

  // slalom: a tall pylon of light on the inside of every bend, the thing you weave around (you pass through it unharmed)
  const pylMat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.85, fog: true }); const pyl = [];
  for (let k = 0; ; k++) { const s = P.slalom[0] + 130 + k * 260; if (s > P.slalom[1] - 60) break;
    const f = o.frame(s), inner = (k % 2 ? 1 : -1) * 21; o.worldAt(s, inner, 0, v); const top = o.floorY(s) + 60 + 75, h = top - SKY_FLOOR;
    v.y = SKY_FLOOR + h / 2; sc.set(2.2, h, 2.2); pyl.push(m4.compose(v, q, sc).clone()); void f; }
  const pylons = new THREE.InstancedMesh(new THREE.CylinderGeometry(1, 1.6, 1, 10, 1, true), pylMat, Math.max(1, pyl.length)); pyl.forEach((m, i) => pylons.setMatrixAt(i, m)); pylons.count = pyl.length; pylons.frustumCulled = false; scene.add(pylons);

  // the drop: big thin hoops all the way down, so the plunge reads as speed
  const hoopMat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.7 }); const hp = []; const zAxis = new THREE.Vector3(0, 0, 1), one = new THREE.Vector3(1, 1, 1);
  for (let s = P.drop[0] - 120; s < P.drop[1] + 260; s += 75) { const f = o.frame(s); o.worldAt(s, 0, 60, v); q.setFromUnitVectors(zAxis, f.t); hp.push(m4.compose(v, q, one).clone()); }
  q.set(0, 0, 0, 1);
  const hoops = new THREE.InstancedMesh(new THREE.TorusGeometry(34, 0.5, 6, 48), hoopMat, hp.length); hp.forEach((m, i) => hoops.setMatrixAt(i, m)); hoops.frustumCulled = false; scene.add(hoops);

  const tmp = new THREE.Color();
  return {
    palette: cur, dome, sea, puffs, pylons, hoops,
    setPalette(i) { target = i; },
    /** each frame: ease the colours toward the chosen palette (the drop turns the world to night and back), follow the camera */
    update(dt, camera, s, lights) {
      const night = on(s, P.drop[0] - 60, P.drop[1] + 150, 110), pal = PALETTES[((target % PALETTES.length) + PALETTES.length) % PALETTES.length], k = 1 - Math.exp(-dt * 5);
      for (const key in cur) { tmp.copy(pal[key]).lerp(NIGHT[key], night); cur[key].lerp(tmp, k); }
      dome.position.copy(camera.position); sea.position.x = Math.round(camera.position.x / 500) * 500; sea.position.z = Math.round(camera.position.z / 500) * 500;
      if (scene.fog) scene.fog.color.copy(cur.hor);
      puffMat.color.copy(cur.cloud); puffMat.emissive.copy(cur.shade).multiplyScalar(0.42);
      pylMat.color.copy(cur.sun).lerp(cur.top, 0.25); hoopMat.color.copy(cur.sun).lerp(cur.mid, 0.3);
      if (lights) { lights.hemi.color.copy(cur.top).lerp(cur.cloud, 0.6); lights.hemi.groundColor.copy(cur.shade); lights.sun.color.copy(cur.sun); }
    },
  };
}

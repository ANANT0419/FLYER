// Painterly look: soft bloom, then one pass that turns the frame into brushwork
// (an edge-preserving smoothing filter) and grades it: warm light, deep cool shadows, vignette, paper grain.
import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';

const PaintShader = {
  uniforms: { tDiffuse: { value: null }, uRes: { value: new THREE.Vector2(1, 1) }, uTime: { value: 0 }, uBrush: { value: 1 }, uSpeed: { value: 0 }, uHi: { value: 0.28 }, uTone: { value: 1 }, uVig: { value: 0.62 } },
  vertexShader: 'varying vec2 vUv;void main(){vUv=uv;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}',
  fragmentShader: `
uniform sampler2D tDiffuse;uniform vec2 uRes;uniform float uTime,uBrush,uSpeed,uHi,uTone,uVig;varying vec2 vUv;
float hash(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}
// 4-sector Kuwahara: each pixel takes the mean of whichever neighbouring quadrant is calmest,
// which flattens detail into strokes while keeping silhouettes crisp.
vec3 kuwahara(vec2 uv){
  vec2 px=uBrush/uRes;vec3 best=vec3(0.0);float bestVar=1e9;
  for(int q=0;q<4;q++){
    vec2 dir=vec2(q==0||q==3?-1.0:1.0,q<2?-1.0:1.0);vec3 m=vec3(0.0),s=vec3(0.0);
    for(int i=0;i<3;i++)for(int j=0;j<3;j++){vec3 c=texture2D(tDiffuse,uv+dir*vec2(float(i),float(j))*px).rgb;m+=c;s+=c*c;}
    m/=9.0;s=abs(s/9.0-m*m);float v=s.r+s.g+s.b;if(v<bestVar){bestVar=v;best=m;}
  }
  return best;
}
void main(){
  vec3 c=uBrush>0.01?kuwahara(vUv):texture2D(tDiffuse,vUv).rgb;
  float l=dot(c,vec3(0.299,0.587,0.114));
  // split-tone: cool, inky shadows and warm, glowing lights
  c=mix(c,c*vec3(0.86,0.92,1.12),smoothstep(0.45,0.0,l)*0.55*uTone);
  c=mix(c,c*vec3(1.10,1.02,0.90),smoothstep(0.5,1.0,l)*0.6*uTone);
  c=mix(vec3(l),c,1.22);                       // richer colour
  c=c*c*(3.0-2.0*c)*0.42+c*0.58;                // gentle contrast curve
  {float hl=dot(c,vec3(0.299,0.587,0.114));c*=1.0-uHi*smoothstep(0.62,1.0,hl);}   // soften the brightest areas (the sun)
  vec2 d=vUv-0.5;float vig=smoothstep(0.92,0.25,length(d*vec2(1.0,0.82)));
  c*=mix(uVig,1.0,vig);
  c+=vec3(1.0,0.75,0.5)*uSpeed*0.05*(1.0-vig);  // edges warm up at speed
  c+=(hash(vUv*uRes+fract(uTime)*91.7)-0.5)*0.022; // paper grain, hides banding
  gl_FragColor=vec4(clamp(c,0.0,1.0),1.0);
}`,
};

export function createPost(renderer, scene, camera, { lite = false } = {}) {
  const size = new THREE.Vector2(); renderer.getDrawingBufferSize(size);
  let target;
  if (renderer.capabilities.isWebGL2 && !lite) { target = new THREE.WebGLMultisampleRenderTarget(size.x, size.y, { format: THREE.RGBAFormat }); target.samples = 4; }
  const composer = target ? new EffectComposer(renderer, target) : new EffectComposer(renderer);
  composer.addPass(new RenderPass(scene, camera));
  const bloom = new UnrealBloomPass(new THREE.Vector2(size.x / 2, size.y / 2), lite ? 0.26 : 0.34, 0.85, 0.86);   // strength, radius, threshold: less sun bloom
  composer.addPass(bloom);
  const paint = new ShaderPass(PaintShader); composer.addPass(paint);
  const api = {
    level: lite ? 1 : 2,   // 2 = bloom + brushwork, 1 = bloom + grade, 0 = plain
    /** a bright world (the Skyway) needs a lighter hand: bloom only on the very brightest, no dimming of highlights, a soft vignette */
    brightWorld() { bloom.strength = lite ? 0.14 : 0.2; bloom.threshold = 0.97; paint.uniforms.uHi.value = 0.04; paint.uniforms.uTone.value = 0.3; paint.uniforms.uVig.value = 0.86; },
    setLevel(n) { api.level = n; bloom.enabled = n >= 1; paint.uniforms.uBrush.value = n >= 2 ? 1 : 0; },
    setSize(w, h, pr) { composer.setPixelRatio(pr); composer.setSize(w, h); paint.uniforms.uRes.value.set(w * pr, h * pr); if (api.level >= 2) paint.uniforms.uBrush.value = Math.max(1, pr * 0.8); },
    render(time, speed01) {
      if (api.level === 0) { renderer.render(scene, camera); return; }
      paint.uniforms.uTime.value = time; paint.uniforms.uSpeed.value = speed01 || 0; composer.render();
    },
  };
  api.setLevel(api.level);
  return api;
}

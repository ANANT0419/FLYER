// Flyer: a wingsuit gliding game. Grown from Glidepath v6 (see legacy/).
import * as THREE from 'three';
import {hand,enableHand,disableHand,updateHand,onFist,attachCanvas,requestCalibration,setCamMode,beginRangeLearning,commitRangeLearning,resetHandRange,setHandSens} from './hand.js';
import {createPost} from './post.js';
import {skyPoints,buildSkyWorld,SKY_PH,SKY_FLOOR} from './skyworld.js';
import {phone,hostPhone,stopPhone,updatePhone,onPhoneBoost,phoneBuzz,setPhoneSens,phoneWasPaired} from './link.js';
import QRCode from 'qrcode';
import {rtStats} from './rt.js';
import {recorder,setRecording,recStart,recFrame,recEvent,recEnd} from './recorder.js';
import {room,joinRoom,leaveRoom,setMyName,setMyLevel,startRace,sendState,sendFinish,onRaceStart,onRoomChange,ghostPose,newRoomCode,cleanCode,raceCfg} from './race.js';
(function(){
"use strict";
/* ================= issue log ================= */
const $=id=>document.getElementById(id);
const issues=[],issueKeys=new Set();
function logIssue(kind,msg){
  msg=String(msg==null?'':msg).slice(0,500);const key=kind+'|'+msg;if(issueKeys.has(key))return;issueKeys.add(key);
  issues.push({t:new Date().toLocaleTimeString(),kind,msg});renderIssues();try{recEvent('issue',kind+': '+msg);}catch(e){}
}
function renderIssues(){
  const b=$('issueBtn'),l=$('issueList');b.textContent='Issue log ('+issues.length+')';b.classList.toggle('has',issues.length>0);
  l.innerHTML='';if(!issues.length){const e=document.createElement('div');e.className='empty';e.textContent='No issues recorded in this session.';l.appendChild(e);return;}
  for(const it of issues){const d=document.createElement('div');d.className='item';const tm=document.createElement('time');tm.textContent=it.t;
    const k=document.createElement('b');k.textContent=it.kind;d.append(tm,k,document.createTextNode(it.msg));l.appendChild(d);}
}
window.addEventListener('error',e=>logIssue('Error',(e.message||'Unknown error')+(e.filename?' ('+e.filename.split('/').pop()+':'+e.lineno+')':'')));
window.addEventListener('unhandledrejection',e=>logIssue('Promise',(e.reason&&e.reason.message)||e.reason));
const _ce=console.error;console.error=function(...a){try{logIssue('Console',a.map(x=>x&&x.message?x.message:String(x)).join(' '))}catch(_){}_ce.apply(console,a)};
$('issueBtn').onclick=()=>{const p=$('issuePanel');p.hidden=!p.hidden;$('issueBtn').setAttribute('aria-expanded',String(!p.hidden));};
$('issueClose').onclick=()=>{$('issuePanel').hidden=true;$('issueBtn').setAttribute('aria-expanded','false');};
$('issueClear').onclick=()=>{issues.length=0;issueKeys.clear();renderIssues();};
$('issueCopy').onclick=()=>{
  const txt=(issues.length?issues.map(i=>`[${i.t}] ${i.kind}: ${i.msg}`).join('\n'):'No issues recorded.')+'\n\nDevice: '+navigator.userAgent;
  const done=()=>{$('issueCopy').textContent='Copied';setTimeout(()=>$('issueCopy').textContent='Copy all',1200)};
  const sel=()=>{const r=document.createRange();r.selectNodeContents($('issueList'));const s=getSelection();s.removeAllRanges();s.addRange(r);$('issueCopy').textContent='Selected, copy it';};
  try{navigator.clipboard.writeText(txt).then(done,sel);}catch(e){sel();}
};
renderIssues();
if(typeof THREE==='undefined'){logIssue('Load','The 3D engine (three.js) did not load. Check your connection and reload.');$('startBtn').disabled=true;$('tutBtn').disabled=true;return;}

/* ================= storage & settings ================= */
const store={get(k,d){try{const v=localStorage.getItem('flyer.'+k);return v==null?d:JSON.parse(v)}catch(e){return d}},
             set(k,v){try{localStorage.setItem('flyer.'+k,JSON.stringify(v))}catch(e){}}};
const hot=window.claude&&window.claude.hot;
const ROOM_PARAM=new URLSearchParams(location.search).get('room');if(ROOM_PARAM)store.set('track',new URLSearchParams(location.search).get('trk')==='sky'?'sky':'race');
// the race tracks are different worlds, so they are chosen when the page loads. SKY = Halcyon Skyway (skyworld.js)
const SKY=store.get('track','gorge')==='sky',RACE=SKY||store.get('track','gorge')==='race';
const WALL_D=RACE?58:92;                           // where the canyon walls start, metres from the middle
const bestKey=()=>TRACK==='coaster'?'best.coaster':'best';let best=store.get('best',0);
const isTouch=!!(window.matchMedia&&matchMedia('(pointer:coarse)').matches);let lastInput=isTouch?'touch':'keys';
const settings={view:store.get('view','3p')==='fp'?'fp':'3p',invert:store.get('invert',false),sens:store.get('sens',1),mode:store.get('mode','two'),guide:['easy','normal','pro'].includes(store.get('guide','easy'))?store.get('guide','easy'):'easy',control:store.get('control',isTouch?'touch':'simple')};
if(isTouch&&settings.control!=='camera')settings.control='touch';if(!isTouch&&settings.control==='touch')settings.control='simple';
const ctlMode=()=>lastInput==='touch'?settings.mode:lastInput==='remote'?(settings.control==='phone'?'phone':'hand'):lastInput==='keys'?(settings.control==='arms'?'keys':'simple'):lastInput;

/* ================= renderer ================= */
const canvas=$('c');let renderer;
try{renderer=new THREE.WebGLRenderer({canvas,antialias:true,powerPreference:'high-performance'});}
catch(e){logIssue('WebGL','Could not start 3D on this device: '+e.message);$('startBtn').disabled=true;$('tutBtn').disabled=true;return;}
let pixelRatio=Math.min(window.devicePixelRatio||1,isTouch?1.6:1.75);renderer.setPixelRatio(pixelRatio);
canvas.addEventListener('webglcontextlost',e=>{e.preventDefault();logIssue('WebGL','Graphics context was lost (device under memory pressure). Reload the page.');});
const scene=new THREE.Scene();
const HORIZON=new THREE.Color('#f7b98c'),SKYTOP=new THREE.Color('#27477a'),SKYLOW=new THREE.Color('#8a6688');
scene.fog=new THREE.Fog(HORIZON.clone(),200,1500);
const camera=new THREE.PerspectiveCamera(66,1,0.3,3000);
const CAM={dist:10.5,up:3.3,fov:62,look:12};   // chase camera: metres behind, metres up, field of view, how far ahead of the glider it looks
let post=null;
function resize(){const w=window.innerWidth,h=window.innerHeight;renderer.setSize(w,h,false);if(post)post.setSize(w,h,pixelRatio);camera.aspect=w/h;camera.updateProjectionMatrix();
  if(w<h)Object.assign(CAM,{dist:9,up:2.9,fov:80});else if(isTouch||w<820)Object.assign(CAM,{dist:8.4,up:2.6,fov:64});else Object.assign(CAM,{dist:10.5,up:3.3,fov:62});}
window.addEventListener('resize',resize);
const timeU={value:0};
try{post=createPost(renderer,scene,camera,{lite:isTouch});}catch(e){logIssue('Graphics','Painterly effects could not start: '+e.message);post={level:0,setLevel(){},setSize(){},render(){renderer.render(scene,camera);}};}
{const fx=new URLSearchParams(location.search).get('fx');if(fx!==null&&fx!=='')post.setLevel(Math.max(0,Math.min(2,parseInt(fx,10)||0)));}

/* ================= helpers ================= */
function mulberry(a){return function(){a|=0;a=a+0x6D2B79F5|0;let t=Math.imul(a^a>>>15,1|a);t=t+Math.imul(t^t>>>7,61|t)^t;return((t^t>>>14)>>>0)/4294967296}}
const rnd=mulberry(20261013),rr=(a,b)=>a+(b-a)*rnd(),clamp=(v,a,b)=>v<a?a:v>b?b:v;
const smoothstep=(a,b,x)=>{const t=clamp((x-a)/(b-a),0,1);return t*t*(3-2*t);};
const smooth=(a,b,x)=>{const t=clamp((x-a)/(b-a),0,1);return t*t*(3-2*t);};
const UP=new THREE.Vector3(0,1,0);
const GLSL_NOISE=`float hash2(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}
float vnoise(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*(3.0-2.0*f);return mix(mix(hash2(i),hash2(i+vec2(1.0,0.0)),f.x),mix(hash2(i+vec2(0.0,1.0)),hash2(i+vec2(1.0,1.0)),f.x),f.y);}
float fbm(vec2 p){float v=0.0,a=0.5;for(int i=0;i<${isTouch?3:4};i++){v+=a*vnoise(p);p*=2.03;a*=0.5;}return v;}
`;
// Wind: gust fronts roll down the gorge (toward -Z) at ~30 m/s; the same field drives grass, trees, flags, leaves, wind lines and the pilot.
const GLSL_GUST=`float gust(vec3 w,float t){float a=sin(w.z*0.011+w.x*0.002+t*0.33)*0.5+0.5;float b=sin(w.z*0.0047+w.x*0.003+t*0.1+1.3)*0.5+0.5;return (a*a*a*0.7+b*b*b*b*0.6)*(0.6+0.4*sin(t*0.13));}
`;
function gustAt(x,z,t){const a=Math.sin(z*0.011+x*0.002+t*0.33)*0.5+0.5,b=Math.sin(z*0.0047+x*0.003+t*0.1+1.3)*0.5+0.5;return (a*a*a*0.7+b*b*b*b*0.6)*(0.6+0.4*Math.sin(t*0.13));}
function radialTex(){const c=document.createElement('canvas');c.width=c.height=64;const g=c.getContext('2d');const gr=g.createRadialGradient(32,32,0,32,32,32);
  gr.addColorStop(0,'rgba(255,255,255,1)');gr.addColorStop(0.4,'rgba(255,255,255,0.55)');gr.addColorStop(1,'rgba(255,255,255,0)');g.fillStyle=gr;g.fillRect(0,0,64,64);return new THREE.CanvasTexture(c);}
function cloudTex(){const c=document.createElement('canvas');c.width=256;c.height=128;const g=c.getContext('2d');
  for(const [x,y,r] of [[70,80,50],[128,62,62],[188,78,48],[104,90,40],[160,92,42],[40,96,30],[220,96,28]]){const gr=g.createRadialGradient(x,y,0,x,y,r);
    gr.addColorStop(0,'rgba(255,255,255,0.95)');gr.addColorStop(0.6,'rgba(255,255,255,0.5)');gr.addColorStop(1,'rgba(255,255,255,0)');g.fillStyle=gr;g.beginPath();g.arc(x,y,r,0,7);g.fill();}
  return new THREE.CanvasTexture(c);}

/* ================= track ================= */
const cps=[];
if(SKY)cps.push(...skyPoints());
else if(RACE){const fx=i=>Math.sin(i*1.25)*95+Math.sin(i*0.55+2)*60;   // tighter, twistier, steeper than the classic gorge
  for(let i=0;i<16;i++)cps.push(new THREE.Vector3(fx(i)-fx(0),660-i*44+Math.sin(i*1.9)*14,-i*290));}
else for(let i=0;i<17;i++){const z=-i*420;const x=i<1?0:Math.sin(i*0.85)*165+Math.sin(i*0.31+1)*105-Math.sin(1)*105;const y=660-i*40+Math.sin(i*1.7)*16;cps.push(new THREE.Vector3(x,y,z));}
const curve=new THREE.CatmullRomCurve3(cps,false,'catmullrom',0.5);
const LEN=curve.getLength(),S=1600,STEP=LEN/(S-1);
const C=[],T=[],R=[];const pts=curve.getSpacedPoints(S-1);
for(let i=0;i<S;i++){C.push(pts[i]);const t=curve.getTangentAt(i/(S-1)).clone();T.push(t);const r=new THREE.Vector3().crossVectors(t,UP);r.y=0;r.normalize();R.push(r);}
const FLOOR=35;const _c=new THREE.Vector3(),_r=new THREE.Vector3(),_t=new THREE.Vector3();
function frame(s){s=clamp(s,0,LEN);const f=s/STEP;const i=Math.min(S-2,Math.floor(f));const k=f-i;
  _c.copy(C[i]).lerp(C[i+1],k);_r.copy(R[i]).lerp(R[i+1],k).normalize();_t.copy(T[i]).lerp(T[i+1],k).normalize();}
function floorY(s){s=clamp(s,0,LEN);const f=s/STEP;const i=Math.min(S-2,Math.floor(f));const k=f-i;return C[i].y+(C[i+1].y-C[i].y)*k-FLOOR;}
// value noise for the rock walls and mountains (deterministic, so the ground under you always matches what you see)
function h2(x,y){let h=(x*374761393+y*668265263)|0;h=Math.imul(h^(h>>>13),1274126177);return((h^(h>>>16))>>>0)/4294967296;}
function vn(x,y){const xi=Math.floor(x),yi=Math.floor(y),xf=x-xi,yf=y-yi,u=xf*xf*(3-2*xf),v=yf*yf*(3-2*yf);
  const a=h2(xi,yi),b=h2(xi+1,yi),c=h2(xi,yi+1),d=h2(xi+1,yi+1);return a+(b-a)*u+(c-a)*v+(a-b-c+d)*u*v;}
// ridged noise: sharp crests and creased valleys, the shape of real mountain ridges
function ridged(x,y,oct){let sum=0,amp=0.5,f=1,w=1,norm=0;for(let o=0;o<oct;o++){let n=1-Math.abs(vn(x*f,y*f)*2-1);n*=n;n*=w;w=clamp(n*1.6,0,1);sum+=n*amp;norm+=amp;amp*=0.5;f*=2.03;}return sum/norm;}
function nz(s,d){return Math.sin(s*0.011+d*0.017)*0.5+Math.sin(s*0.027-d*0.031+1.7)*0.3+Math.sin(s*0.061+d*0.05+4.1)*0.2;}
function relH(s,d){if(SKY)return -1e3;const ad=Math.abs(d),n=nz(s,d);let h=ad*0.05+n*2.4+Math.sin(s*0.09+d*0.13)*0.6;if(ad<26){const t=ad/26;h-=7*(1-t*t);}
  if(ad>WALL_D){const w=(ad-WALL_D)/150,side=d>0?1:-1;
    // buttresses and gullies running down the walls, crags on top; each wall has its own pattern
    const rg=ridged(s*0.0065+side*31.7,ad*0.006,4),cr=vn(s*0.045+side*7.3,ad*0.05);
    const cliff=Math.min(1,w*2.6);                                   // a steep first rise: the canyon wall itself
    let hw=(cliff*cliff*(3-2*cliff))*80*(0.7+0.6*rg)+(1-Math.exp(-w*w*1.1))*250*(0.78+0.44*rg)*(1+0.18*n)+rg*rg*150*smoothstep(0.7,1.4,w)+(cr-0.5)*9*w;   // canyon wall, shoulder, crags along the rim
    hw+=Math.sin(s*0.05+d*0.08)*6*w+Math.sin(s*0.21+d*0.17)*2.5*w;
    const st=17+6*rg,q=Math.floor(hw/st)*st,f=(hw-q)/st;hw=hw*0.5+(q+st*f*f*f*f)*0.5;   // ledges: rock strata breaking into steps
    h+=hw;}return h;}
function groundAt(s,d){if(SKY)return SKY_FLOOR;const h=relH(s,d);return floorY(s)+(Math.abs(d)<23?Math.max(h,-3.0):h);}
function worldAt(s,d,h,out){frame(s);out.copy(_c).addScaledVector(_r,d);out.y=floorY(s)+h;return out;}

/* ---- the wind current: the ideal line ---- */
const KS=300,keys=[];
if(SKY){for(let i=0;i*KS<=LEN+KS*3;i++)keys.push({d:0,h:60});}
else if(RACE){const kr=mulberry(5150);for(let i=0;i*KS<=LEN+KS*3;i++){if(i<2){keys.push({d:0,h:40});continue;}keys.push({d:(kr()*2-1)*30,h:kr()<0.3?12+kr()*6:20+kr()*30});}}
else for(let i=0;i*KS<=LEN+KS*3;i++){if(i<2){keys.push({d:0,h:42});continue;}keys.push({d:rr(-48,48),h:rnd()<0.18?rr(13,17):rr(28,58)});}
function cr(p0,p1,p2,p3,t){const t2=t*t,t3=t2*t;return 0.5*(2*p1+(-p0+p2)*t+(2*p0-5*p1+4*p2-p3)*t2+(-p0+3*p1-3*p2+p3)*t3);}
let SD=0,SH=0;
function streamAt(s){const f=clamp(s,0,LEN)/KS,i=Math.floor(f),t=f-i,k=j=>keys[clamp(j,0,keys.length-1)];
  SD=cr(k(i-1).d,k(i).d,k(i+1).d,k(i+2).d,t);SH=cr(k(i-1).h,k(i).h,k(i+1).h,k(i+2).h,t);if(TRACK==='coaster'){const f2=clamp(s,0,LEN)/KC,j=Math.floor(f2),t2=f2-j,kc=q=>keysC[clamp(q,0,keysC.length-1)];SH=cr(kc(j-1),kc(j),kc(j+1),kc(j+2),t2);}}
const _sp=new THREE.Vector3(),_sp2=new THREE.Vector3();
function streamPoint(s,out){streamAt(s);return worldAt(s,SD,SH,out);}
const ARCH_S=(SKY?[]:RACE?[0.13,0.27,0.41,0.55,0.69,0.83]:[0.27,0.52,0.77]).map(f=>Math.round(LEN*f)),ARCH_R=RACE?60:100;
if(RACE)for(const a of ARCH_S){const i=Math.round(a/KS);for(const j of [i-1,i,i+1])if(keys[j])keys[j].h=Math.min(keys[j].h,j===i?24:34);}   // the line dips under each arch
let TRACK=SKY?'sky':RACE?'race':store.get('track','gorge');if(TRACK!=='coaster'&&!RACE)TRACK='gorge';
const TRACK_NAME={gorge:'Saffron Gorge',coaster:'Skyline Coaster',race:'Razorback Canyon',sky:'Halcyon Skyway'};
// Skyline Coaster: the current alternates deep valleys and high crests; it dips under the stone arches.
const KC=230,keysC=[];{const kr=mulberry(7777);let up=false;for(let i=0;i*KC<=LEN+KC*3;i++){if(i<2){keysC.push(46);continue;}up=!up;keysC.push(up?95+kr()*45:12+kr()*10);}
  for(const a of ARCH_S){const i=Math.round(a/KC);for(const j of [i-1,i,i+1])if(keysC[j]!==undefined)keysC[j]=Math.min(keysC[j],j===i?40:60);}}

/* ================= sky & light ================= */
const SUN=new THREE.Vector3(-0.35,0.16,-1).normalize();const SUN_U=new THREE.Vector3().crossVectors(SUN,UP).normalize(),SUN_V=new THREE.Vector3().crossVectors(SUN_U,SUN).normalize();
const sky=new THREE.Mesh(new THREE.SphereGeometry(2400,32,16),new THREE.ShaderMaterial({side:THREE.BackSide,depthWrite:false,fog:false,
  uniforms:{top:{value:SKYTOP},hor:{value:HORIZON},low:{value:SKYLOW},sun:{value:SUN},sunU:{value:SUN_U},sunV:{value:SUN_V},uTime:timeU,sunCol:{value:new THREE.Color('#ffe2b0')}},
  vertexShader:'varying vec3 vW;void main(){vW=normalize(position);gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}',
  fragmentShader:'uniform vec3 top,hor,low,sun,sunU,sunV,sunCol;uniform float uTime;varying vec3 vW;\n'+GLSL_NOISE+`void main(){vec3 d=normalize(vW);float h=d.y;
vec3 c=mix(hor,top,pow(smoothstep(0.0,0.75,h),0.62));c=mix(c,vec3(0.98,0.6,0.52),smoothstep(0.24,0.0,h)*0.35);c=mix(c,low,smoothstep(0.0,-0.25,h));
float sd=max(dot(d,sun),0.0);c+=sunCol*(pow(sd,220.0)*0.85+pow(sd,24.0)*0.2+pow(sd,4.0)*0.1);
vec3 pr=d-sun*dot(d,sun);float ang=atan(dot(pr,sunV),dot(pr,sunU)+1e-5);float rays=(0.5+0.5*sin(ang*17.0+uTime*0.12))*(0.5+0.5*sin(ang*7.0-uTime*0.08+1.7));c+=sunCol*rays*pow(sd,4.0)*0.1*smoothstep(-0.05,0.08,h);
vec2 cp=d.xz/(abs(h)+0.18);float cl=fbm(cp*1.6+vec2(uTime*0.006,0.0));float cl2=fbm(cp*4.1-vec2(uTime*0.01,3.0));
float band=smoothstep(0.46,0.78,cl*0.72+cl2*0.38)*smoothstep(0.02,0.2,h)*(1.0-smoothstep(0.55,0.95,h));
vec3 cc=mix(vec3(1.0,0.7,0.58),vec3(0.97,0.8,0.66),pow(sd,2.0));cc=mix(cc,vec3(0.6,0.48,0.66),smoothstep(0.55,0.9,cl2)*0.55);c=mix(c,cc,band*0.72);
float st=step(0.9985,hash2(floor(d.xz/(h+0.3)*220.0)))*smoothstep(0.45,0.9,h)*(0.6+0.4*sin(uTime*2.0+d.x*90.0));c+=vec3(st)*0.65;
gl_FragColor=vec4(c,1.0);}`}));
sky.renderOrder=-1;scene.add(sky);
const hemiLight=new THREE.HemisphereLight(0xbfd6e6,0x6b4a3e,0.75);scene.add(hemiLight);
const sunLight=new THREE.DirectionalLight(0xffd2a1,0.95);scene.add(sunLight);scene.add(sunLight.target);
const SCENERY0=scene.children.length;   // everything added from here to the end of the scenery belongs to the canyons

/* swaying foliage: amplitude follows the gust field at each plant */
function swayMat(color,amp,basic){
  const m=basic?new THREE.MeshBasicMaterial({color,vertexColors:true,side:THREE.DoubleSide}):new THREE.MeshLambertMaterial({color,flatShading:true});
  m.onBeforeCompile=sh=>{sh.uniforms.uTime=timeU;
    sh.vertexShader='uniform float uTime;\n'+GLSL_GUST+sh.vertexShader.replace('#include <begin_vertex>',`#include <begin_vertex>
#ifdef USE_INSTANCING
vec3 ip=instanceMatrix[3].xyz;
#else
vec3 ip=(modelMatrix*vec4(0.0,0.0,0.0,1.0)).xyz;
#endif
float ph=ip.x*0.05+ip.z*0.07;float gu=gust(ip,uTime);
float sw=(sin(uTime*1.7+ph)*0.3+sin(uTime*3.3+ph*1.7)*0.12+gu*(1.1+0.35*sin(uTime*7.0+ph)))*max(position.y,0.0)*${amp.toFixed(3)};
transformed.x+=sw*0.3;transformed.z-=sw;
${basic?'vColor.rgb=mix(vColor.rgb,vec3(1.0,0.93,0.72),gu*0.45*clamp(position.y,0.0,1.0));':''}`);};
  return m;
}
const rockDetailMat=new THREE.MeshPhongMaterial({color:0xffffff,shininess:0,specular:0x000000,flatShading:true});
rockDetailMat.onBeforeCompile=sh=>{sh.vertexShader='varying vec3 vW;\n'+sh.vertexShader.replace('#include <begin_vertex>','#include <begin_vertex>\nvW=(modelMatrix*vec4(transformed,1.0)).xyz;');
  sh.fragmentShader='varying vec3 vW;\n'+GLSL_NOISE+sh.fragmentShader.replace('#include <color_fragment>',`float n1=fbm(vW.xz*0.06+vW.y*0.02);float n3=vnoise(vec2(vW.x+vW.z,vW.y)*0.35);float strata=0.5+0.5*sin(vW.y*0.2+n1*4.0);
vec3 col=mix(vec3(0.64,0.39,0.33),vec3(0.86,0.6,0.45),strata);col=mix(col,vec3(0.42,0.27,0.3),smoothstep(0.55,0.85,n1)*0.5);col*=0.82+0.3*n3;diffuseColor.rgb=col;`);};

/* ================= terrain (procedural detail per pixel) ================= */
(function(){
  const ROWSTEP=isTouch?3:2,rows=Math.floor((S-1)/ROWSTEP)+1,cols=isTouch?57:81,EXT=RACE?300:340;
  const pos=new Float32Array(rows*cols*3),aH=new Float32Array(rows*cols),aAd=new Float32Array(rows*cols);let p=0,q=0;
  for(let r=0;r<rows;r++){const i=Math.min(S-1,r*ROWSTEP),s=i*STEP,fy=C[i].y-FLOOR;
    for(let j=0;j<cols;j++){const t=j/(cols-1)*2-1,d=Math.sign(t)*Math.pow(Math.abs(t),1.35)*EXT,h=relH(s,d);
      pos[p]=C[i].x+R[i].x*d;pos[p+1]=fy+h;pos[p+2]=C[i].z+R[i].z*d;p+=3;aH[q]=h;aAd[q]=Math.abs(d);q++;}}
  const idx=[];for(let r=0;r<rows-1;r++)for(let j=0;j<cols-1;j++){const a=r*cols+j,b=a+1,c=a+cols,d=c+1;idx.push(a,b,c,b,d,c);}
  const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.BufferAttribute(pos,3));g.setAttribute('aH',new THREE.BufferAttribute(aH,1));g.setAttribute('aAd',new THREE.BufferAttribute(aAd,1));
  g.setIndex(idx);g.computeVertexNormals();
  const mat=new THREE.MeshPhongMaterial({color:0xffffff,shininess:0,specular:0x000000});
  mat.onBeforeCompile=sh=>{sh.uniforms.uTime=timeU;
    sh.vertexShader='attribute float aH;attribute float aAd;varying float vH;varying float vAd;varying vec3 vW;varying vec3 vWN;\n'+sh.vertexShader.replace('#include <begin_vertex>','#include <begin_vertex>\nvH=aH;vAd=aAd;vW=(modelMatrix*vec4(transformed,1.0)).xyz;vWN=normalize(objectNormal);');
    sh.fragmentShader='uniform float uTime;varying float vH;varying float vAd;varying vec3 vW;varying vec3 vWN;\n'+GLSL_NOISE+sh.fragmentShader.replace('#include <color_fragment>',`
float slope=1.0-clamp(vWN.y,0.0,1.0);
float n1=fbm(vW.xz*0.035);float n2=fbm(vW.xz*0.3+vec2(vW.y*0.05));float n3=vnoise(vW.xz*1.7);
vec3 gA=vec3(0.33,0.52,0.27),gB=vec3(0.55,0.66,0.33),gDry=vec3(0.76,0.67,0.42),gDark=vec3(0.22,0.38,0.24);
vec3 grass=mix(gA,gB,n1);grass=mix(grass,gDry,smoothstep(0.58,0.78,n2)*0.55);grass=mix(grass,gDark,smoothstep(0.55,0.75,1.0-n1)*0.4);grass*=0.88+0.24*n3;
vec3 rA=vec3(0.66,0.40,0.34),rB=vec3(0.87,0.61,0.45),rD=vec3(0.42,0.27,0.30);
float rg=vnoise(vec2(vW.x+vW.z,vW.y*1.6)*0.22);float strata=0.5+0.5*sin(vW.y*0.16+n1*4.0+rg*1.5);
vec3 rock=mix(rA,rB,strata);rock=mix(rock,rD,smoothstep(0.55,0.85,n2)*0.5);rock*=0.86+0.22*rg;
float streak=vnoise(vec2((vW.x-vW.z)*0.22,vW.y*0.012));rock*=1.0-0.28*smoothstep(0.55,0.85,streak)*slope;          // dark water streaks down the faces
 // cracks between the strata
rock=mix(rock,vec3(0.93,0.74,0.56),smoothstep(0.35,0.08,slope)*0.25);                                                     // sunlit ledges
grass=mix(grass,gDark*1.05,smoothstep(10.0,70.0,vH)*0.45);
float rockMix=clamp(smoothstep(0.5,0.8,slope+(n2-0.5)*0.3)+smoothstep(95.0,150.0,vH)*0.75,0.0,1.0);
vec3 col=mix(grass,rock,rockMix);
col=mix(col,mix(gA,gDark,0.5),smoothstep(0.22,0.05,slope)*smoothstep(18.0,40.0,vH)*0.6);
float snow=smoothstep(215.0,245.0,vH+n1*30.0)*(1.0-smoothstep(0.5,0.78,slope));col=mix(col,vec3(0.97,0.94,0.92),snow);
float sandM=(1.0-smoothstep(23.0,31.0,vAd+n2*5.0))*(1.0-smoothstep(1.0,4.0,vH));col=mix(col,vec3(0.86,0.77,0.58)*(0.9+0.2*n3),sandM);
float cs=smoothstep(0.5,0.72,fbm(vW.xz*0.0042+vec2(uTime*0.004,uTime*0.013)));col*=1.0-0.22*cs;
diffuseColor.rgb=col;`);};
  const m=new THREE.Mesh(g,mat);m.frustumCulled=false;scene.add(m);
  // the mountain ranges beyond the gorge rim: a heightfield laid out on the ground (so it never folds on the bends),
  // its height set by how far each point is from the gorge
  {const STEPF=isTouch?60:42,x0=-1900,x1=1900,z0=1600,z1=Math.min(...C.map(c=>c.z))-1600,nx=Math.ceil((x1-x0)/STEPF)+1,nzc=Math.ceil((z0-z1)/STEPF)+1;
   const fp=new Float32Array(nx*nzc*3),fh=new Float32Array(nx*nzc),fd=new Float32Array(nx*nzc);let k=0;
   for(let iz=0;iz<nzc;iz++)for(let ix=0;ix<nx;ix++){const x=x0+ix*STEPF,z=z0-iz*STEPF;
     let bi=0,bd=Infinity;for(let i=0;i<S;i+=10){const dx=x-C[i].x,dz=z-C[i].z,dd=dx*dx+dz*dz;if(dd<bd){bd=dd;bi=i;}}
     for(let i=Math.max(0,bi-10);i<=Math.min(S-1,bi+10);i++){const dx=x-C[i].x,dz=z-C[i].z,dd=dx*dx+dz*dz;if(dd<bd){bd=dd;bi=i;}}
     const dist=Math.sqrt(bd),fy=C[bi].y-FLOOR;
     const rg=ridged(x*0.0011+5.3,z*0.0011-2.1,6),big=vn(x*0.00042+9.1,z*0.00042+3.7);
     let hh=(320+560*smoothstep(340,1000,dist)-300*smoothstep(1500,2100,dist))*(0.5+0.8*rg)*(0.8+0.4*big);
     if(dist<360)hh=Math.min(hh,relH(bi*STEP,dist)-30-Math.max(0,340-dist)*0.3);   // tucked under the gorge walls
     fp[k*3]=x;fp[k*3+1]=fy+hh;fp[k*3+2]=z;fh[k]=hh*0.5;fd[k]=dist;k++;}   // half height for the colouring: snow only on the high peaks
   const fi=[];for(let iz=0;iz<nzc-1;iz++)for(let ix=0;ix<nx-1;ix++){const a=iz*nx+ix,b=a+1,c=a+nx,d=c+1;fi.push(a,b,c,b,d,c);}
   const fg=new THREE.BufferGeometry();fg.setAttribute('position',new THREE.BufferAttribute(fp,3));fg.setAttribute('aH',new THREE.BufferAttribute(fh,1));fg.setAttribute('aAd',new THREE.BufferAttribute(fd,1));
   fg.setIndex(fi);fg.computeVertexNormals();
   // painted once, per corner, so these distant slopes cost almost nothing to draw (they cover much of the screen)
   const nrm=fg.attributes.normal.array,fc=new Float32Array(fh.length*3),cc=new THREE.Color(),rockA=new THREE.Color(0.62,0.4,0.36),rockB=new THREE.Color(0.8,0.58,0.46),grassC=new THREE.Color(0.36,0.5,0.3),snowC=new THREE.Color(0.95,0.93,0.92);
   for(let i=0;i<fh.length;i++){const h=fh[i]*2,ny=nrm[i*3+1],sl=1-ny,x=fp[i*3],z=fp[i*3+2];
     cc.copy(rockA).lerp(rockB,0.5+0.5*Math.sin(h*0.035+vn(x*0.01,z*0.01)*3));
     cc.lerp(grassC,clamp((0.32-sl)/0.2,0,1)*clamp((520-h)/200,0,1));
     cc.lerp(snowC,clamp((h-430-vn(x*0.004,z*0.004)*120)/90,0,1)*clamp((0.5-sl)/0.25,0,1));
     fc[i*3]=cc.r;fc[i*3+1]=cc.g;fc[i*3+2]=cc.b;}
   fg.setAttribute('color',new THREE.BufferAttribute(fc,3));fg.deleteAttribute('aH');fg.deleteAttribute('aAd');
   const fm=new THREE.Mesh(fg,new THREE.MeshLambertMaterial({vertexColors:true}));fm.frustumCulled=false;scene.add(fm);}
  // river with moving light
  const wr=Math.floor((S-1)/2)+1,wp=new Float32Array(wr*2*3),wu=new Float32Array(wr*2*2);
  for(let r=0;r<wr;r++){const i=Math.min(S-1,r*2),fy=C[i].y-FLOOR-3.2;for(let k=0;k<2;k++){const d=k?22:-22,o=(r*2+k)*3;wp[o]=C[i].x+R[i].x*d;wp[o+1]=fy;wp[o+2]=C[i].z+R[i].z*d;wu[(r*2+k)*2]=k;wu[(r*2+k)*2+1]=i*STEP;}}
  const wi=[];for(let r=0;r<wr-1;r++){const a=r*2;wi.push(a,a+1,a+2,a+1,a+3,a+2);}
  const wg=new THREE.BufferGeometry();wg.setAttribute('position',new THREE.BufferAttribute(wp,3));wg.setAttribute('uv',new THREE.BufferAttribute(wu,2));wg.setIndex(wi);
  const water=new THREE.Mesh(wg,new THREE.ShaderMaterial({transparent:true,uniforms:{uTime:timeU,fogColor:{value:scene.fog.color},fogNear:{value:scene.fog.near},fogFar:{value:scene.fog.far}},
    vertexShader:'varying vec2 vUv;varying float vD;void main(){vUv=uv;vec4 mv=modelViewMatrix*vec4(position,1.0);vD=-mv.z;gl_Position=projectionMatrix*mv;}',
    fragmentShader:'uniform float uTime;uniform vec3 fogColor;uniform float fogNear,fogFar;varying vec2 vUv;varying float vD;void main(){float s=vUv.y;float w=sin(s*0.35+uTime*3.0+vUv.x*6.0)*0.5+0.5;float g=pow(sin(s*0.9-uTime*4.0+vUv.x*11.0)*0.5+0.5,12.0);vec3 c=mix(vec3(0.24,0.45,0.55),vec3(0.36,0.6,0.68),w)+g*0.18;float edge=smoothstep(0.0,0.15,vUv.x)*smoothstep(1.0,0.85,vUv.x);c=mix(c,fogColor,smoothstep(fogNear,fogFar,vD));gl_FragColor=vec4(c,0.85*edge+0.1);}'}));
  water.frustumCulled=false;scene.add(water);
})();

/* ================= distant mountains ================= */
(function(){
  const N=90,g=new THREE.ConeGeometry(1,1,7);g.translate(0,0.5,0);
  const body=new THREE.InstancedMesh(g,new THREE.MeshLambertMaterial({flatShading:true}),N);
  const cap=new THREE.InstancedMesh(g,new THREE.MeshLambertMaterial({color:0xf6eee8,flatShading:true}),N);
  const m=new THREE.Matrix4(),q=new THREE.Quaternion(),sc=new THREE.Vector3(),v=new THREE.Vector3(),c=new THREE.Color(),a=new THREE.Color('#9a7d98'),b=new THREE.Color('#6f84a3');
  for(let i=0;i<N;i++){const s=rr(-200,LEN+200),side=rnd()<0.5?-1:1,d=side*rr(430,950);frame(clamp(s,0,LEN));v.copy(_c).addScaledVector(_r,d);if(s<0)v.addScaledVector(_t,s);if(s>LEN)v.addScaledVector(_t,s-LEN);
    const base=floorY(clamp(s,0,LEN))-90,Rr=rr(120,260),H=rr(260,560);v.y=base;q.setFromAxisAngle(UP,rnd()*6.28);sc.set(Rr,H,Rr);m.compose(v,q,sc);body.setMatrixAt(i,m);body.setColorAt(i,c.copy(a).lerp(b,rnd()));
    v.y=base+H*0.74;sc.set(Rr*0.26,H*0.26,Rr*0.26);m.compose(v,q,sc);cap.setMatrixAt(i,m);}
  // replaced by the mountain-range heightfield; the loop above still runs so the random layout after it is unchanged
})();

/* ================= spires (kept off the current) ================= */
const pillars=[];
(function(){
  const rockMat=rockDetailMat,capMat=swayMat(0x5f8d63,0.02);const v=new THREE.Vector3();
  const pr=RACE?mulberry(616):rnd,prr=(a,b)=>a+(b-a)*pr();
  for(let s=RACE?330:560;s<LEN-420;s+=RACE?prr(120,175):rr(240,330)){if(ARCH_S.some(a=>Math.abs(a-s)<40))continue;streamAt(s);const side=pr()<0.5?-1:1;
    let d=SD+side*(RACE?prr(14,22):rr(30,52));if(Math.abs(d)>WALL_D-8)d=SD-side*(RACE?prr(14,22):rr(30,52));if(Math.abs(d)>WALL_D-8)continue;
    const r=RACE?prr(4,7):rr(5,8),h=RACE?prr(70,120):rr(60,115);worldAt(s,d,0,v);const gy=groundAt(s,d)-4;
    const m=new THREE.Mesh(new THREE.CylinderGeometry(r*0.75,r*1.15,h,7),rockMat);m.position.set(v.x,gy+h/2,v.z);scene.add(m);
    const c=new THREE.Mesh(new THREE.ConeGeometry(r*0.9,r*1.6,6),capMat);c.position.set(v.x,gy+h+r*0.7,v.z);scene.add(c);
    pillars.push({s,d,x:v.x,z:v.z,r:r*1.05,top:gy+h+r*1.2});}
})();

/* ================= vegetation: forests, meadows, flower fields (everything sways with the gusts) ================= */
function instChunks(geo,mat,items,chunk){chunk=chunk||450;const groups=new Map();
  for(const it of items){const k=Math.floor(it.s/chunk);let a=groups.get(k);if(!a){a=[];groups.set(k,a);}a.push(it);}
  const v=new THREE.Vector3();
  for(const arr of groups.values()){const g=geo.clone();const box=new THREE.Box3();for(const it of arr){v.setFromMatrixPosition(it.m);box.expandByPoint(v);}
    const sph=new THREE.Sphere();box.getBoundingSphere(sph);sph.radius+=30;g.boundingSphere=sph;
    const mesh=new THREE.InstancedMesh(g,mat,arr.length);arr.forEach((it,i)=>{mesh.setMatrixAt(i,it.m);if(it.c)mesh.setColorAt(i,it.c);});scene.add(mesh);}}
const nearPillar=(s,d,r)=>pillars.some(p=>Math.abs(p.s-s)<r&&Math.abs(p.d-d)<r);
function slopeAt(s,d){return Math.abs(relH(s,d+3)-relH(s,d-3))/6;}
const _vq=new THREE.Quaternion(),_vs=new THREE.Vector3(),_vp=new THREE.Vector3();
function place(s,d,h,ry,sx,sy,sz,col){worldAt(s,d,h,_vp);_vq.setFromAxisAngle(UP,ry);_vs.set(sx,sy,sz);return {s,m:new THREE.Matrix4().compose(_vp,_vq,_vs),c:col?new THREE.Color(col):null};}
const VQ=isTouch?0.42:1;
// giant ancient trees: solid trunks to weave past, canopies you can skim through
(function(){
  const bark=new THREE.MeshLambertMaterial({color:0x6e4a38,flatShading:true});const leafMs=[0x3f7a45,0x4f8a4a,0x6f9a3e].map(c=>swayMat(c,0.004));
  let made=0;for(let tries=0;tries<120&&made<9;tries++){const s=rr(500,LEN-500);if(ARCH_S.some(a=>Math.abs(a-s)<60)||pillars.some(p=>Math.abs(p.s-s)<60))continue;streamAt(s);
    const side=rnd()<0.5?-1:1;let d=SD+side*rr(30,44);if(Math.abs(d)>80)d=SD-side*rr(30,44);if(Math.abs(d)>80)continue;made++;
    const gy=groundAt(s,d)-2,H=rr(62,80),v=worldAt(s,d,0,new THREE.Vector3());
    const trunk=new THREE.Mesh(new THREE.CylinderGeometry(3.2,5.5,H,10),bark);trunk.position.set(v.x,gy+H/2,v.z);scene.add(trunk);
    for(let k=0;k<4;k++){const a=k*1.57+rnd();const root=new THREE.Mesh(new THREE.ConeGeometry(2.2,9,6),bark);root.position.set(v.x+Math.cos(a)*4,gy+3,v.z+Math.sin(a)*4);root.rotation.set(Math.sin(a)*0.5,0,-Math.cos(a)*0.5);scene.add(root);}
    for(let k=0;k<6;k++){const c=new THREE.Mesh(new THREE.IcosahedronGeometry(rr(12,19),1),leafMs[k%3]);c.position.set(v.x+rr(-12,12),gy+H+rr(-8,10),v.z+rr(-12,12));scene.add(c);}
    pillars.push({s,d,x:v.x,z:v.z,r:5.6,top:gy+H-4});}
})();
(function(){
  const pines=[],round=[],bushes=[],grass=[],stems=[],heads=[];let n,guard;
  const pineC=['#2f5a44','#3f6b4f','#4f7d55','#365f3e','#5a7f45'];
  const NP=Math.round(5200*VQ);n=0;guard=0;
  while(n<NP&&guard<NP*6){guard++;const s=rr(10,LEN-10),slopeSide=rnd()<0.62,d=(rnd()<0.5?-1:1)*(slopeSide?rr(95,250):rr(28,95)),h=relH(s,d);
    if(h>150||nearPillar(s,d,10))continue;if(slopeSide&&slopeAt(s,d)>1.3)continue;streamAt(s);if(Math.abs(d-SD)<10&&h<60)continue;
    const k=slopeSide?rr(1.3,2.4):rr(0.8,1.7);pines.push(place(s,d,h-0.5,rnd()*6.28,k,k*rr(0.9,1.5),k,pineC[n%5]));n++;}
  const greens=['#5f8f4a','#79a052','#4d7a42','#8aa84f','#6f9a3c'],bloss=['#f2a7c3','#f6b48a','#e9c46a','#d0604e','#f7c9d9','#e78f5a'];
  const NR=Math.round(1100*VQ);n=0;guard=0;
  while(n<NR&&guard<NR*8){guard++;const s=rr(20,LEN-20),d=(rnd()<0.5?-1:1)*rr(28,140),h=relH(s,d);if(h>70||slopeAt(s,d)>1.0||nearPillar(s,d,12))continue;streamAt(s);if(Math.abs(d-SD)<14&&h<40)continue;
    const k=rr(0.8,1.5);round.push(place(s,d,h-0.3,rnd()*6.28,k,k*rr(0.9,1.2),k,rnd()<0.6?greens[n%5]:bloss[n%6]));n++;}
  const bc=['#5c8a4e','#7aa05a','#8f9a4a','#6b8f62','#4f7d48','#e7a1b7','#f1d06a'];
  const NB=Math.round(2400*VQ);n=0;guard=0;
  while(n<NB&&guard<NB*6){guard++;const s=rr(10,LEN-10),d=(rnd()<0.5?-1:1)*rr(24,130),h=relH(s,d);if(h>60||slopeAt(s,d)>1.2||nearPillar(s,d,10))continue;
    const k=rr(1,2.6);bushes.push(place(s,d,h-0.3,rnd()*6.28,k*rr(1,1.5),k*rr(0.7,1),k,bc[n%7]));n++;}
  const gc=['#7aa352','#93b65c','#c9b55f','#a9bd5c','#6c9a4c','#5f8f45'];
  const NG=Math.round(62000*VQ);n=0;guard=0;
  while(n<NG&&guard<NG){guard++;const s=rr(20,LEN-40),d=(rnd()<0.5?-1:1)*rr(26,120);if(relH(s,d)>20)continue;const base=new THREE.Color(gc[Math.floor(rnd()*6)]);
    for(let k=0;k<30&&n<NG;k++){const s2=s+rr(-9,9),d2=d+rr(-9,9);if(Math.abs(d2)<24)continue;const h=relH(s2,d2);if(h>22||slopeAt(s2,d2)>0.9)continue;
      const it=place(s2,d2,h-0.15,0,rr(0.8,1.5),rr(1.6,3.6),rr(0.8,1.5),null);it.c=base.clone().offsetHSL(rr(-0.02,0.02),0,rr(-0.05,0.05));grass.push(it);n++;}}
  const fcol=['#e0453a','#9b7fd1','#f4cf3f','#f6f1ea','#f29ac0','#f19a3e','#6f9be0','#c43c6a'];
  const NF=Math.round(24000*VQ);n=0;guard=0;
  while(n<NF&&guard<NF){guard++;const s=rr(20,LEN-40),d=(rnd()<0.5?-1:1)*rr(26,110);if(relH(s,d)>18)continue;const fc=fcol[Math.floor(rnd()*fcol.length)],R0=rr(6,14),cnt=Math.floor(rr(30,70));
    for(let k=0;k<cnt&&n<NF;k++){const a=rnd()*6.28,r=Math.sqrt(rnd())*R0,s2=s+Math.cos(a)*r,d2=d+Math.sin(a)*r;if(Math.abs(d2)<24)continue;const h=relH(s2,d2);if(h>20||slopeAt(s2,d2)>0.9)continue;
      const hg=rr(0.9,1.6);stems.push(place(s2,d2,h-0.1,0,0.55,hg,0.55,'#5f8f45'));heads.push(place(s2,d2,h-0.1,0,1,hg,1,fc));n++;}}
  const pineG=new THREE.ConeGeometry(2.4,9,6);pineG.translate(0,4.2,0);instChunks(pineG,swayMat(0xffffff,0.05),pines);
  const trunkG=new THREE.CylinderGeometry(0.35,0.55,6,6);trunkG.translate(0,3,0);instChunks(trunkG,new THREE.MeshLambertMaterial({color:0x6b4a3a,flatShading:true}),round.map(it=>({s:it.s,m:it.m,c:null})));
  const crownG=new THREE.IcosahedronGeometry(3.2,1);crownG.translate(0,7.2,0);instChunks(crownG,swayMat(0xffffff,0.03),round);
  const bushG=new THREE.IcosahedronGeometry(1,0);bushG.translate(0,0.6,0);instChunks(bushG,swayMat(0xffffff,0.12),bushes);
  const grassG=new THREE.BufferGeometry();
  grassG.setAttribute('position',new THREE.BufferAttribute(new Float32Array([-0.16,0,0, 0.16,0,0, 0.03,1,0, 0,0,-0.16, 0,0,0.16, 0,1,0.03]),3));
  grassG.setAttribute('color',new THREE.BufferAttribute(new Float32Array([0.5,0.5,0.5, 0.5,0.5,0.5, 1,1,1, 0.5,0.5,0.5, 0.5,0.5,0.5, 1,1,1]),3));
  const bladeMat=swayMat(0xffffff,0.75,true);instChunks(grassG,bladeMat,grass,300);instChunks(grassG,bladeMat,stems,300);
  const headG=new THREE.OctahedronGeometry(0.3,0);headG.scale(1,0.6,1);headG.translate(0,1,0);headG.setAttribute('color',new THREE.BufferAttribute(new Float32Array(headG.attributes.position.count*3).fill(1),3));
  instChunks(headG,swayMat(0xffffff,0.75,true),heads,300);
})();

/* ================= clouds, valley mist, sun glare ================= */
const SOFT=radialTex(),CLOUD=cloudTex(),cloudSprites=[];
(function(){
  const cm=[0.88,0.92,0.96].map(l=>new THREE.SpriteMaterial({map:CLOUD,color:new THREE.Color().setHSL(0.06,0.55,l),transparent:true,opacity:0.8,depthWrite:false}));
  const N=isTouch?70:120;for(let i=0;i<N;i++){const sp=new THREE.Sprite(cm[i%3]);cloudSprites.push(sp);worldAt(rr(-100,LEN+100),rr(-460,460),rr(165,330),sp.position);const k=rr(90,230);sp.scale.set(k,k*0.5,1);scene.add(sp);}
  const mm=new THREE.SpriteMaterial({map:SOFT,color:0xffe6d8,transparent:true,opacity:0.16,depthWrite:false});
  const M=isTouch?45:80;for(let i=0;i<M;i++){const sp=new THREE.Sprite(mm);worldAt(rr(0,LEN),rr(-75,75),rr(3,15),sp.position);sp.scale.set(rr(60,140),rr(16,28),1);scene.add(sp);}
})();
const glare=new THREE.Sprite(new THREE.SpriteMaterial({map:SOFT,color:0xffd9a0,transparent:true,opacity:0.2,depthWrite:false,fog:false,blending:THREE.AdditiveBlending}));glare.scale.set(400,400,1);   // owner: sun too brightscene.add(glare);

/* ================= thermals: columns of rising warm air ================= */
const thermals=[];
for(let s=700;s<LEN-500;s+=rr(560,780)){streamAt(s);const side=rnd()<0.5?-1:1;const d=clamp(SD+side*rr(26,40),-80,80);
  if(pillars.some(p=>Math.abs(p.s-s)<25&&Math.abs(p.d-d)<25)||ARCH_S.some(a=>Math.abs(a-s)<30))continue;
  thermals.push({s,d,c:worldAt(s,d,relH(s,d),new THREE.Vector3()),r:13,hit:false});}
(function(){
  const per=isTouch?70:110,N=thermals.length*per,aC=new Float32Array(N*3),aP=new Float32Array(N*3);
  thermals.forEach((t,i)=>{for(let k=0;k<per;k++){const o=i*per+k;aC.set([t.c.x,t.c.y,t.c.z],o*3);aP.set([rnd()*6.283,Math.sqrt(rnd()),rnd()],o*3);}});
  const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.BufferAttribute(aC.slice(),3));g.setAttribute('aC',new THREE.BufferAttribute(aC,3));g.setAttribute('aP',new THREE.BufferAttribute(aP,3));
  const mat=new THREE.ShaderMaterial({transparent:true,depthWrite:false,blending:THREE.AdditiveBlending,uniforms:{uTime:timeU,uPR:{value:pixelRatio}},
    vertexShader:`attribute vec3 aC;attribute vec3 aP;uniform float uTime,uPR;varying float vA;void main(){float H=150.0;float y=mod(aP.z*H+uTime*13.0,H);float a=aP.x+uTime*(0.8+aP.y*0.7)+y*0.05;float r=aP.y*13.0*(0.55+0.45*y/H);
vec3 p=aC+vec3(cos(a)*r,y,sin(a)*r);vec4 mv=modelViewMatrix*vec4(p,1.0);gl_PointSize=clamp(160.0/-mv.z,1.0,7.0)*uPR;gl_Position=projectionMatrix*mv;vA=smoothstep(0.0,12.0,y)*(1.0-smoothstep(H*0.65,H,y))*(1.0-smoothstep(300.0,700.0,-mv.z));}`,
    fragmentShader:`varying float vA;void main(){vec2 c=gl_PointCoord-0.5;float d=length(c);if(d>0.5)discard;float a=vA*(1.0-d*2.0)*0.9;gl_FragColor=vec4(vec3(1.0,0.9,0.7)*a,a);}`});
  const pts=new THREE.Points(g,mat);pts.frustumCulled=false;scene.add(pts);
  const colMat=new THREE.ShaderMaterial({transparent:true,depthWrite:false,side:THREE.DoubleSide,blending:THREE.AdditiveBlending,uniforms:{uTime:timeU},
    vertexShader:'varying vec2 vUv;varying float vD;void main(){vUv=uv;vec4 mv=modelViewMatrix*vec4(position,1.0);vD=-mv.z;gl_Position=projectionMatrix*mv;}',
    fragmentShader:'uniform float uTime;varying vec2 vUv;varying float vD;void main(){float f=fract(vUv.y*5.0-uTime*0.5+vUv.x*4.0);float st=smoothstep(0.0,0.15,f)*(1.0-smoothstep(0.15,0.45,f));float a=st*0.07*smoothstep(0.0,0.12,vUv.y)*(1.0-smoothstep(0.55,1.0,vUv.y))*(1.0-smoothstep(300.0,700.0,vD));gl_FragColor=vec4(vec3(1.0,0.88,0.66)*a,a);}'});
  const cg=new THREE.CylinderGeometry(13,9,150,20,1,true);cg.translate(0,75,0);
  thermals.forEach(t=>{const m=new THREE.Mesh(cg,colMat);m.position.copy(t.c);scene.add(m);});
})();

/* ================= waterfalls cascading down the walls ================= */
(function(){
  const fallMat=new THREE.ShaderMaterial({transparent:true,depthWrite:false,side:THREE.DoubleSide,
    uniforms:{uTime:timeU,fogColor:{value:scene.fog.color},fogNear:{value:scene.fog.near},fogFar:{value:scene.fog.far}},
    vertexShader:'varying vec2 vUv;varying float vD;void main(){vUv=uv;vec4 mv=modelViewMatrix*vec4(position,1.0);vD=-mv.z;gl_Position=projectionMatrix*mv;}',
    fragmentShader:'uniform float uTime;uniform vec3 fogColor;uniform float fogNear,fogFar;varying vec2 vUv;varying float vD;\n'+GLSL_NOISE+`void main(){float x=vUv.x,y=vUv.y;float n=vnoise(vec2(x*9.0,y*0.35-uTime*2.6));float n2=vnoise(vec2(x*23.0,y*0.9-uTime*4.2));float st=smoothstep(0.35,0.95,n*0.6+n2*0.5);
vec3 c=mix(vec3(0.5,0.72,0.82),vec3(0.97,0.99,1.0),st);float edge=smoothstep(0.0,0.22,x)*smoothstep(1.0,0.78,x);float a=(0.5+0.45*st)*edge;c=mix(c,fogColor,smoothstep(fogNear,fogFar,vD));gl_FragColor=vec4(c,a);}`});
  const mistMat=new THREE.SpriteMaterial({map:SOFT,color:0xffffff,transparent:true,opacity:0.32,depthWrite:false});
  for(let f=0;f<8;f++){const s=rr(380,LEN-500),side=rnd()<0.5?-1:1;if(ARCH_S.some(a=>Math.abs(a-s)<40))continue;const K=28;
    const pos=[],uv=[],idx=[];let acc=0;const v=new THREE.Vector3(),prev=new THREE.Vector3(),pp=new THREE.Vector3();
    for(let k=0;k<=K;k++){const d=side*(200-k*(96/K));worldAt(s,d,0,v);v.y=groundAt(s,d)+0.9;if(k>0)acc+=v.distanceTo(prev);prev.copy(v);const w=3+k*0.14;
      for(let j=0;j<2;j++){const ss=s+(j?w:-w);worldAt(ss,d,0,pp);pp.y=groundAt(ss,d)+0.9;pos.push(pp.x,pp.y,pp.z);uv.push(j,acc);}}
    for(let k=0;k<K;k++){const a=k*2;idx.push(a,a+1,a+2,a+1,a+3,a+2);}
    const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(pos,3));g.setAttribute('uv',new THREE.Float32BufferAttribute(uv,2));g.setIndex(idx);
    const m=new THREE.Mesh(g,fallMat);m.frustumCulled=false;scene.add(m);
    for(let k=0;k<3;k++){const sp=new THREE.Sprite(mistMat);const d=side*(118-k*6);worldAt(s+rr(-3,3),d,relH(s,d)+3+k*2,sp.position);sp.scale.set(16+k*6,10+k*4,1);scene.add(sp);}}
})();

/* ================= stone arches spanning the gorge ================= */
const arches=[];
(function(){
  const archGeo=new THREE.TorusGeometry(ARCH_R,9,12,64,Math.PI),AK=ARCH_R/100;const vineMat=swayMat(0x4f7d55,0.04);
  for(const s of ARCH_S){const c=worldAt(s,0,-4,new THREE.Vector3());frame(s);const m=new THREE.Mesh(archGeo,rockDetailMat);m.position.copy(c);m.lookAt(c.clone().add(_t));scene.add(m);
    arches.push({s,hc:-4,r:ARCH_R});
    for(let k=0;k<9;k++){const a=Math.PI/2+rr(-0.5,0.5),ht=rr(6,10);const tg=new THREE.ConeGeometry(rr(1.6,2.6),ht,6);tg.translate(0,ht/2,0);const t=new THREE.Mesh(tg,vineMat);
      t.position.set(Math.cos(a)*(ARCH_R+8),Math.sin(a)*(ARCH_R+8),rr(-5,5));t.rotation.z=a-Math.PI/2;m.add(t);}
    for(let k=0;k<16;k++){const a=Math.PI/2+rr(-0.75,0.75),len=rr(4,13);const vg=new THREE.ConeGeometry(0.45,len,4);vg.translate(0,-len/2,0);const v=new THREE.Mesh(vg,vineMat);
      v.position.set(Math.cos(a)*(ARCH_R-9),Math.sin(a)*(ARCH_R-9),rr(-6,6));m.add(v);}}
})();

/* ================= prayer flags strung across the gorge ================= */
const flags=[];const FN=34;
const flagMesh=(function(){
  const sList=[0.13,0.34,0.44,0.62,0.88].map(f=>LEN*f).filter(s=>!ARCH_S.some(a=>Math.abs(a-s)<70));
  const geo=new THREE.PlaneGeometry(1.8,2.4);geo.translate(0,-1.25,0);
  const mesh=new THREE.InstancedMesh(geo,new THREE.MeshLambertMaterial({side:THREE.DoubleSide,emissive:0x2a1a14}),sList.length*FN);
  const cols=['#3f7fd0','#f4efe8','#d6453d','#4c9a5a','#f2c14e'],c=new THREE.Color();let n=0;const lineMat=new THREE.LineBasicMaterial({color:0x3a2a2a});
  for(const s of sList){const a=worldAt(s,-212,relH(s,-212)+3,new THREE.Vector3()),b=worldAt(s,212,relH(s,212)+3,new THREE.Vector3());
    const X=new THREE.Vector3().subVectors(b,a).normalize(),Y=new THREE.Vector3(0,1,0),Z=new THREE.Vector3().crossVectors(X,Y).normalize();Y.crossVectors(Z,X).normalize();
    const qb=new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(X,Y,Z));
    const at=t=>{const p=new THREE.Vector3().lerpVectors(a,b,t);p.y-=32*4*t*(1-t);return p;};
    const lp=[];for(let k=0;k<=40;k++)lp.push(at(k/40));scene.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(lp),lineMat));
    for(let i=0;i<FN;i++){flags.push({p:at((i+0.5)/FN),qb,ph:rnd()*6.28});mesh.setColorAt(n,c.set(cols[i%5]));n++;}}
  mesh.frustumCulled=false;scene.add(mesh);return mesh;})();
const _fq=new THREE.Quaternion(),_fx=new THREE.Vector3(1,0,0),_fm=new THREE.Matrix4(),_one=new THREE.Vector3(1,1,1);
function updateFlags(now){for(let i=0;i<flags.length;i++){const f=flags[i];const gu=gustAt(f.p.x,f.p.z,now);
  _fq.setFromAxisAngle(_fx,-(0.25+gu*0.9)+Math.sin(now*5+f.ph)*(0.12+gu*0.3)).premultiply(f.qb);_fm.compose(f.p,_fq,_one);flagMesh.setMatrixAt(i,_fm);}
  flagMesh.instanceMatrix.needsUpdate=true;}

/* ================= birds circling over the gorge ================= */
const birdFlocks=[];
const birdMesh=(function(){const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.BufferAttribute(new Float32Array([-1.2,0,0.3, 0,0,-0.45, 0,0,0.35, 1.2,0,0.3, 0,0,0.35, 0,0,-0.45]),3));
  const mat=new THREE.MeshBasicMaterial({color:0x2a2230,side:THREE.DoubleSide});
  mat.onBeforeCompile=sh=>{sh.uniforms.uTime=timeU;sh.vertexShader='uniform float uTime;\n'+sh.vertexShader.replace('#include <begin_vertex>','#include <begin_vertex>\n#ifdef USE_INSTANCING\nfloat ph=instanceMatrix[3].x*0.3;\n#else\nfloat ph=0.0;\n#endif\ntransformed.y+=sin(uTime*11.0+ph)*abs(position.x)*0.7;');};
  for(let f=0;f<6;f++)birdFlocks.push({s:rr(300,LEN-400),d:rr(-60,60),h:rr(75,135),ph:rnd()*6.28});
  const m=new THREE.InstancedMesh(g,mat,birdFlocks.length*8);m.frustumCulled=false;scene.add(m);return m;})();
const _bc=new THREE.Vector3(),_bp=new THREE.Vector3(),_bq=new THREE.Quaternion(),_bs=new THREE.Vector3(1.5,1.5,1.5),_bm=new THREE.Matrix4();
function updateBirds(now){let n=0;for(const f of birdFlocks){worldAt(f.s+Math.sin(now*0.05+f.ph)*60,f.d,f.h,_bc);
  for(let i=0;i<8;i++){const r=10+i*2.2,w=0.5+(i%3)*0.08,a=now*w+i*0.79+f.ph;_bp.set(_bc.x+Math.cos(a)*r,_bc.y+Math.sin(now*0.9+i)*3,_bc.z+Math.sin(a)*r);
    _bq.setFromAxisAngle(UP,Math.atan2(Math.sin(a),-Math.cos(a)));_bm.compose(_bp,_bq,_bs);birdMesh.setMatrixAt(n++,_bm);}}
  birdMesh.instanceMatrix.needsUpdate=true;}

/* ================= boulders on the banks ================= */
(function(){
  const N=isTouch?180:320;const mesh=new THREE.InstancedMesh(new THREE.DodecahedronGeometry(1,0),new THREE.MeshLambertMaterial({flatShading:true}),N);
  const cols=['#8d7a72','#a08a7a','#7a6a66','#b39b86'],c=new THREE.Color(),m=new THREE.Matrix4(),q=new THREE.Quaternion(),sc=new THREE.Vector3(),v=new THREE.Vector3(),e=new THREE.Euler();let n=0;
  for(let i=0;i<N;i++){const s=rr(10,LEN-10),river=rnd()<0.6,d=(rnd()<0.5?-1:1)*(river?rr(18,32):rr(34,110)),h=relH(s,d);if(h>25)continue;
    worldAt(s,d,Math.max(h,-3.2)-0.3,v);const k=river?rr(0.8,2.6):rr(1,3.5);sc.set(k*rr(1,1.6),k*rr(0.6,1),k);q.setFromEuler(e.set(rnd(),rnd()*6,rnd()));m.compose(v,q,sc);mesh.setMatrixAt(n,m);mesh.setColorAt(n,c.set(cols[n%4]));n++;}
  mesh.count=n;mesh.frustumCulled=false;scene.add(mesh);
})();

/* ================= hamlets with chimney smoke ================= */
const chimneys=[];
(function(){
  const wallMat=new THREE.MeshLambertMaterial({color:0xe8d5b5,flatShading:true}),roofMat=new THREE.MeshLambertMaterial({color:0xa8473a,flatShading:true}),
        winMat=new THREE.MeshBasicMaterial({color:0xffc76b}),woodMat=new THREE.MeshLambertMaterial({color:0x6b4a3a,flatShading:true});
  const box=new THREE.BoxGeometry(1,1,1),roof=new THREE.ConeGeometry(0.78,1,4);roof.rotateY(Math.PI/4);const win=new THREE.PlaneGeometry(1,1);
  const v=new THREE.Vector3();let made=0;
  for(let tries=0;tries<300&&made<6;tries++){const s=rr(350,LEN-500);streamAt(s);const side=rnd()<0.5?-1:1;const d0=clamp(SD+side*rr(34,55),-88,88);if(relH(s,d0)>8)continue;
    if(pillars.some(p=>Math.abs(p.s-s)<40)||ARCH_S.some(a=>Math.abs(a-s)<50))continue;made++;
    frame(s);const yaw=Math.atan2(-_t.x,-_t.z);const huts=3+Math.floor(rnd()*3);
    for(let k=0;k<huts;k++){const s2=s+rr(-22,22),d2=d0+rr(-12,12);const h=relH(s2,d2);if(h>10)continue;worldAt(s2,d2,h-0.2,v);
      const w=rr(5,7.5),dp=rr(4.5,6.5),ht=rr(3.6,4.6),rh=ht*0.65;const g=new THREE.Group();g.position.copy(v);g.rotation.y=yaw+rr(-0.5,0.5)+(d2<0?-Math.PI/2:Math.PI/2);
      const walls=new THREE.Mesh(box,wallMat);walls.scale.set(w,ht,dp);walls.position.y=ht/2;g.add(walls);
      const rf=new THREE.Mesh(roof,roofMat);rf.scale.set(w*1.05,rh,dp*1.05);rf.position.y=ht+rh/2;g.add(rf);
      for(const x of [-w*0.25,w*0.25]){const wi=new THREE.Mesh(win,winMat);wi.scale.set(0.9,0.9,1);wi.position.set(x,ht*0.55,dp/2+0.02);g.add(wi);}
      const door=new THREE.Mesh(box,woodMat);door.scale.set(1.1,2,0.1);door.position.set(0,1,dp/2+0.03);g.add(door);
      const ch=new THREE.Mesh(box,woodMat);ch.scale.set(0.7,2.2,0.7);ch.position.set(w*0.28,ht+1.1,0);g.add(ch);
      scene.add(g);g.updateMatrixWorld(true);chimneys.push({p:new THREE.Vector3(w*0.28,ht+2.3,0).applyMatrix4(g.matrixWorld),parts:[]});}}
  const SP=isTouch?7:11,sm=new THREE.SpriteMaterial({map:SOFT,color:0xddd2ca,transparent:true,opacity:0.4,depthWrite:false});
  chimneys.forEach(c=>{for(let i=0;i<SP;i++){const sp=new THREE.Sprite(sm.clone());sp.userData.t=i/SP;sp.userData.ph=rnd()*6.28;scene.add(sp);c.parts.push(sp);}});
})();
const _smw=new THREE.Vector3();
function updateSmoke(dt,now,sNow){frame(sNow);_smw.copy(_t);
  for(const c of chimneys){const far=c.p.distanceToSquared(camera.position)>1100*1100;const gu=gustAt(c.p.x,c.p.z,now);
    for(const sp of c.parts){sp.visible=!far;if(far)continue;const u=sp.userData;u.t+=dt/6;if(u.t>1)u.t-=1;const a=u.t;
      sp.position.copy(c.p).addScaledVector(_smw,a*a*(10+gu*28));sp.position.y+=a*15;sp.position.x+=Math.sin(now*0.8+u.ph+a*5)*a*2;
      const k=1.6+a*9;sp.scale.set(k,k,1);sp.material.opacity=0.42*(1-a)*smooth(0,0.08,a);}}}

/* ================= rainbow over the gorge ================= */
(function(){const s=LEN*0.41;const g=new THREE.RingGeometry(62,76,96,1,0,Math.PI);
  const mat=new THREE.ShaderMaterial({transparent:true,depthWrite:false,blending:THREE.AdditiveBlending,side:THREE.DoubleSide,
    vertexShader:'varying vec2 vP;void main(){vP=position.xy;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}',
    fragmentShader:'varying vec2 vP;void main(){float t=(length(vP)-62.0)/14.0;vec3 c=clamp(abs(mod(t*0.85*6.0+vec3(0.0,4.0,2.0),6.0)-3.0)-1.0,0.0,1.0);float a=smoothstep(0.0,0.15,t)*smoothstep(1.0,0.85,t)*0.2*smoothstep(0.0,25.0,vP.y);gl_FragColor=vec4(c*a,a);}'});
  const m=new THREE.Mesh(g,mat);const c=worldAt(s,30,-2,new THREE.Vector3());frame(s);m.position.copy(c);m.lookAt(c.clone().add(_t));scene.add(m);})();

/* ================= fireflies over the meadow ================= */
const FF=isTouch?110:200,ffPos=new Float32Array(FF*3),ffPh=new Float32Array(FF),ffs=[];
for(let i=0;i<FF;i++){ffPh[i]=rnd()*6.28;ffs.push({p:new THREE.Vector3(1e6,0,0)});}
const ffGeo=new THREE.BufferGeometry();ffGeo.setAttribute('position',new THREE.BufferAttribute(ffPos,3));ffGeo.setAttribute('aPh',new THREE.BufferAttribute(ffPh,1));
const ffMesh=new THREE.Points(ffGeo,new THREE.ShaderMaterial({transparent:true,depthWrite:false,blending:THREE.AdditiveBlending,uniforms:{uTime:timeU,uPR:{value:pixelRatio}},
  vertexShader:'attribute float aPh;uniform float uTime,uPR;varying float vA;void main(){vec4 mv=modelViewMatrix*vec4(position,1.0);float tw=0.5+0.5*sin(uTime*2.6+aPh);vA=tw*tw;gl_PointSize=(2.0+3.0*tw)*uPR*clamp(90.0/-mv.z,0.6,3.0);gl_Position=projectionMatrix*mv;}',
  fragmentShader:'varying float vA;void main(){vec2 c=gl_PointCoord-0.5;float d=length(c);if(d>0.5)discard;float a=vA*(1.0-d*2.0);gl_FragColor=vec4(vec3(1.0,0.92,0.5)*a,a);}'}));
ffMesh.frustumCulled=false;scene.add(ffMesh);
const _fv=new THREE.Vector3();
function updateFireflies(now,sNow){camera.getWorldDirection(_fv);
  for(let i=0;i<FF;i++){const f=ffs[i];_rel.subVectors(f.p,camera.position);
    if(_rel.lengthSq()>120*120||_rel.dot(_fv)<-5){const s=clamp(sNow+rr(5,110),0,LEN),d=(rnd()<0.5?-1:1)*rr(24,95);worldAt(s,d,relH(s,d)+rr(1,8),f.p);}
    const ph=ffPh[i];ffPos[i*3]=f.p.x+Math.sin(now*0.7+ph)*2;ffPos[i*3+1]=f.p.y+Math.sin(now*1.3+ph*2)*0.8;ffPos[i*3+2]=f.p.z+Math.cos(now*0.6+ph)*2;}
  ffGeo.attributes.position.needsUpdate=true;}

/* ================= butterflies ================= */
const BF=isTouch?40:90,bfs=[];
const bfMat=new THREE.MeshBasicMaterial({color:0xffffff,side:THREE.DoubleSide});
bfMat.onBeforeCompile=sh=>{sh.uniforms.uTime=timeU;sh.vertexShader='uniform float uTime;\n'+sh.vertexShader.replace('#include <begin_vertex>','#include <begin_vertex>\n#ifdef USE_INSTANCING\nfloat ph=instanceMatrix[3].x*1.7+instanceMatrix[3].z;\n#else\nfloat ph=0.0;\n#endif\ntransformed.y+=sin(uTime*22.0+ph)*abs(position.x)*1.1;');};
const bfMesh=new THREE.InstancedMesh(birdMesh.geometry,bfMat,BF);bfMesh.frustumCulled=false;scene.add(bfMesh);
{const bc=['#ffd23f','#ffffff','#ff8c42','#9ad1ff','#f7a1c4'],c=new THREE.Color();for(let i=0;i<BF;i++){bfs.push({p:new THREE.Vector3(1e6,0,0),ph:rnd()*6.28});bfMesh.setColorAt(i,c.set(bc[i%5]));}}
const _bfq=new THREE.Quaternion(),_bfs=new THREE.Vector3(0.4,0.4,0.4),_bfm=new THREE.Matrix4(),_bfp=new THREE.Vector3(),_bfd=new THREE.Vector3();
function updateButterflies(now,sNow){camera.getWorldDirection(_bfd);
  for(let i=0;i<BF;i++){const b=bfs[i];_rel.subVectors(b.p,camera.position);
    if(_rel.lengthSq()>90*90||_rel.dot(_bfd)<-4){const s=clamp(sNow+rr(8,80),0,LEN),d=(rnd()<0.5?-1:1)*rr(26,90);worldAt(s,d,relH(s,d)+rr(1,4),b.p);}
    const t=now*0.6+b.ph;_bfp.set(b.p.x+Math.sin(t)*3,b.p.y+Math.sin(now*2.1+b.ph)*0.6,b.p.z+Math.cos(t*0.8)*3);
    _bfq.setFromAxisAngle(UP,Math.atan2(-Math.cos(t),Math.sin(t*0.8)*0.8));_bfm.compose(_bfp,_bfq,_bfs);bfMesh.setMatrixAt(i,_bfm);}
  bfMesh.instanceMatrix.needsUpdate=true;}

/* ================= Halcyon Skyway: no canyon, a sky world instead ================= */
let skyWorld=null;
if(SKY){
  // the canyon scenery was built above (its code is shared by every track); take all of it out of the picture, and
  // out of the flying: no pillars, arches or thermals to meet
  for(const o of scene.children.slice(SCENERY0))scene.remove(o);scene.remove(sky);
  pillars.length=0;arches.length=0;thermals.length=0;
  if(post.brightWorld)post.brightWorld();document.body.classList.add('sky');
  scene.fog.near=500;scene.fog.far=3400;hemiLight.intensity=0.95;sunLight.intensity=0.55;
  skyWorld=buildSkyWorld({scene,timeU,worldAt,frame:s=>{frame(s);return {c:_c,r:_r,t:_t};},floorY,LEN,isTouch,rnd:mulberry(2718)});
}

/* ================= wind current tube ================= */
const streamMat=new THREE.ShaderMaterial({transparent:true,depthWrite:false,side:THREE.DoubleSide,blending:THREE.AdditiveBlending,
  uniforms:{uTime:timeU,uLen:{value:LEN},uPlayer:{value:new THREE.Vector3()},uOp:{value:1}},
  vertexShader:'varying vec2 vUv;varying vec3 vW;varying vec3 vN;void main(){vUv=uv;vec4 w=modelMatrix*vec4(position,1.0);vW=w.xyz;vN=normalize(mat3(modelMatrix)*normal);gl_Position=projectionMatrix*viewMatrix*w;}',
  fragmentShader:`uniform float uTime,uLen,uOp;uniform vec3 uPlayer;varying vec2 vUv;varying vec3 vW;varying vec3 vN;
void main(){float a=vUv.x*uLen;float f=fract(a/16.0-uTime*1.4);float dash=smoothstep(0.0,0.25,f)*(1.0-smoothstep(0.35,0.7,f));
float spiral=pow(0.5+0.5*sin(vUv.y*6.2832*2.0+a*0.25-uTime*5.0),6.0);
vec3 v=normalize(cameraPosition-vW);float fres=pow(1.0-abs(dot(normalize(vN),v)),1.6);
float dp=distance(vW,uPlayer);float near=smoothstep(3.0,16.0,dp);float far=1.0-smoothstep(260.0,560.0,dp);
float al=(0.05+0.30*dash+0.18*spiral)*(0.35+0.65*fres)*near*far*uOp;
vec3 col=mix(vec3(1.0,0.9,0.72),vec3(0.8,0.97,1.0),dash);gl_FragColor=vec4(col*al,al);}`});

/* ================= the guided line ================= */
// The route through the course: the line of the old wind current, and in the race canyon the line through every gate.
// The glider rides it by itself as long as the player's tilt roughly matches what the next bend or dip needs.
// Your tilt always drives the glider 1:1 (bank, pitch, turn rate): the line never replaces it. The help acts only on
// where you are: a gentle heading nudge and a sideways/up-down pull back onto the line, like lane-keeping in a car.
// win = how far off (in full-tilt units) your tilt can be and still count as right enough; lean = when a bend or dip
// clearly needs a tilt, the share of it you must give, the right way round; yawK/pull = strength of the heading nudge and sideways drift; pitchT = seconds the height nudge takes to close a gap;
// flare = how much a too-fast arrival is rounded off (up to flareMax radians); close = help strength while flying back.
const GUIDE={easy:{win:0.5,lean:0.3,yawK:2.2,pitchT:0.16,flare:1,flareMax:0.45,close:0.8,pull:2.6,pullMax:8,name:'Easy'},normal:{win:0.3,lean:0.45,yawK:1.2,pitchT:0.3,flare:0.7,flareMax:0.3,close:0.7,pull:1.4,pullMax:5,name:'Normal'},pro:{win:0.1,lean:0.7,yawK:0.15,pitchT:3,flare:0.15,flareMax:0.08,close:0.5,pull:0.25,pullMax:1,name:'Pro'},
  off:{win:1e-4,lean:1,yawK:0,pitchT:1e6,flare:0,flareMax:0,close:0,pull:0,pullMax:0,name:'Off'}};   // 'off' is only for tests (test/guide-response.cjs)
const LINE_SPEED=0.15;                            // on the line you fly 15% faster
let gateDh=[];                                    // race: how far each gate sits above the current's line, so the route threads it
function routePoint(s,out){streamAt(s);let h=SH;
  if(gateDh.length){let i=0;while(i<gateDh.length&&gateDh[i].s<s)i++;const a=gateDh[i-1],b=gateDh[i];
    if(a&&b){const t=smoothstep(a.s,b.s,s);h+=a.dh+(b.dh-a.dh)*t;}else if(a)h+=a.dh*(1-smoothstep(a.s,a.s+80,s));else if(b)h+=b.dh*smoothstep(b.s-80,b.s,s);}
  return worldAt(s,SD,h,out);}
// The energy stream (owner's choice of a "modern high-tech path"): a flowing plasma core with light pulses racing ahead,
// a soft wide haze around it, two thin strands spiralling around it, and sparks streaming along it. Bright and gold-white while you are on the line,
// dimmer and cool blue while you drift. One mesh: aK = 0 core band, 1 and 2 the strands, 3 the haze. Every band turns its face to
// the camera (like a light trail), so it reads the same from any angle.
// the stream runs this far below the flight line: the camera looks along the line from just above it, so a stream on the
// line itself squeezes into a sliver hidden behind the glider; below it, it fans out under you toward the horizon
const STREAM_DROP=4.5;
const ribbonMat=new THREE.ShaderMaterial({transparent:true,depthWrite:false,side:THREE.DoubleSide,blending:THREE.CustomBlending,blendSrc:THREE.OneFactor,blendDst:THREE.OneMinusSrcAlphaFactor,
  uniforms:{uTime:timeU,uS:{value:0},uLock:{value:0}},
  vertexShader:'attribute float aS;attribute float aU;attribute float aK;attribute vec3 aTan;uniform float uLock;varying float vS;varying float vU;varying float vK;'+
    'void main(){vS=aS;vU=aU;vK=aK;float w=aK<0.5?1.6+0.7*uLock:aK>2.5?4.5:0.28;vec3 side=normalize(cross(aTan,cameraPosition-position));gl_Position=projectionMatrix*viewMatrix*vec4(position+side*aU*w,1.0);}',
  fragmentShader:`uniform float uTime,uS,uLock;varying float vS;varying float vU;varying float vK;
vec3 pal(float h){return 0.55+0.45*cos(6.2832*(h+vec3(0.0,0.33,0.67)));}
void main(){float ahead=vS-uS;float fade=smoothstep(-12.0,2.0,ahead)*(1.0-smoothstep(170.0,340.0,ahead));if(fade<=0.0)discard;
float t=uTime,u=vU,h=fract(vS*0.0012-t*0.045);vec3 hue=pal(h);vec3 col;float al;
if(vK<0.5){
  float core=exp(-u*u*14.0),glow=exp(-u*u*1.8);
  float plasma=0.55+0.25*sin(vS*0.23-t*11.0+sin(vS*0.041+t*1.7)*3.0)+0.2*sin(vS*0.11+u*4.0-t*7.0);   // churning flow
  float pulse=pow(fract((vS-t*95.0)/55.0),10.0)+0.6*pow(fract((vS-t*140.0)/130.0),18.0);           // pulses racing ahead
  vec3 cool=mix(vec3(0.1,0.45,1.0),hue,0.5),hot=mix(vec3(1.0,0.45,0.1),hue,0.6);   // saturated: white only in the thin centre
  vec3 c=mix(cool,hot,uLock)*1.25;
  col=c*glow*plasma*1.1+vec3(1.0,0.95,0.85)*core*(0.3+0.4*uLock)+c*pulse*glow*1.5;
  al=min(0.85,(glow*0.75+core*0.3+pulse*glow*0.5)*(0.45+0.55*uLock));   // fairly solid: a glow alone vanishes on a sunlit valley   // fairly solid: a glow alone vanishes on a sunlit valley
}else if(vK>2.5){
  float haze=exp(-u*u*2.5)*(0.6+0.4*sin(vS*0.07-t*4.0+u*2.0));                                     // soft outer volume
  col=mix(vec3(0.2,0.5,1.0),hue,0.7)*haze*0.25*(0.35+0.65*uLock);al=haze*0.05*(0.4+0.6*uLock);
}else{
  float dash=smoothstep(0.35,0.5,fract(vS*0.085-t*(vK<1.5?2.6:3.1)))*smoothstep(1.0,0.75,fract(vS*0.085-t*(vK<1.5?2.6:3.1)));
  float line=exp(-u*u*4.0);col=mix(vec3(0.5,0.9,1.0),pal(h+0.3),0.75)*line*(0.6+dash*1.4);al=line*(0.3+dash*0.6)*(0.3+0.7*uLock);
}
gl_FragColor=vec4(col*fade,al*fade*0.85);}`});
function buildRibbon(add){
  // the route sampled every 2 m, then three strips: the core just under the line and two strands spiralling round it
  const step=2,n=Math.floor(LEN/step)+1,P=[],Tn=[],Sd=[];const p=new THREE.Vector3(),q=new THREE.Vector3();
  for(let i=0;i<n;i++){const s=Math.min(LEN,i*step);routePoint(s,p);routePoint(Math.min(LEN,s+2),q);if(s+2>LEN){routePoint(s-2,q);q.subVectors(p,q);}else q.sub(p);q.normalize();
    frame(s);P.push(p.clone());Tn.push(q.clone());Sd.push(_r.clone());}
  const V=n*2*4,pos=new Float32Array(V*3),tan=new Float32Array(V*3),aS=new Float32Array(V),aU=new Float32Array(V),aK=new Float32Array(V),idx=[];const up=new THREE.Vector3(),c=new THREE.Vector3();
  for(let k=0;k<4;k++)for(let i=0;i<n;i++){const s=Math.min(LEN,i*step);c.copy(P[i]);c.y-=STREAM_DROP;
    if(k===1||k===2){up.crossVectors(Sd[i],Tn[i]).normalize();const a=s*(2*Math.PI/18)+(k===2?Math.PI:0),R=2.8;c.addScaledVector(Sd[i],Math.cos(a)*R).addScaledVector(up,Math.sin(a)*R);}
    for(let e=0;e<2;e++){const j=(k*n+i)*2+e;pos.set([c.x,c.y,c.z],j*3);tan.set([Tn[i].x,Tn[i].y,Tn[i].z],j*3);aS[j]=s;aU[j]=e?1:-1;aK[j]=k;}
    if(i<n-1){const a=(k*n+i)*2;idx.push(a,a+1,a+2,a+1,a+3,a+2);}}
  const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.BufferAttribute(pos,3));g.setAttribute('aTan',new THREE.BufferAttribute(tan,3));
  g.setAttribute('aS',new THREE.BufferAttribute(aS,1));g.setAttribute('aU',new THREE.BufferAttribute(aU,1));g.setAttribute('aK',new THREE.BufferAttribute(aK,1));g.setIndex(idx);
  const m=add(new THREE.Mesh(g,ribbonMat));m.frustumCulled=false;m.renderOrder=2;}
// sparks streaming along the stream ahead of you
const SPARKS=isTouch?140:260,sparkPos=new Float32Array(SPARKS*3),sparkCol=new Float32Array(SPARKS*3),sparks=[];
const sparkGeo=new THREE.BufferGeometry();sparkGeo.setAttribute('position',new THREE.BufferAttribute(sparkPos,3));sparkGeo.setAttribute('color',new THREE.BufferAttribute(sparkCol,3));
const sparkMesh=new THREE.Points(sparkGeo,new THREE.PointsMaterial({size:0.55,map:radialTex(),vertexColors:true,transparent:true,depthWrite:false,blending:THREE.AdditiveBlending,fog:false}));
sparkMesh.frustumCulled=false;scene.add(sparkMesh);
for(let i=0;i<SPARKS;i++)sparks.push({s:-1e9,a:0,r:0,v:0,w:0,h:0});
const _spk=new THREE.Vector3(),_spu=new THREE.Vector3();
function updateSparks(dt,now,sBase,lock){
  for(let i=0;i<SPARKS;i++){const k=sparks[i];k.s+=k.v*dt;k.a+=k.w*dt;
    if(k.s<sBase-5||k.s>sBase+240){k.s=sBase+5+Math.random()*230;k.a=Math.random()*6.283;k.r=0.4+Math.random()*2.6;k.v=45+Math.random()*70;k.w=(Math.random()-0.5)*5;k.h=Math.random();}
    routePoint(clamp(k.s,0,LEN),_spk);frame(clamp(k.s,0,LEN));_spk.y-=STREAM_DROP;_spu.crossVectors(_r,_t).normalize();
    _spk.addScaledVector(_r,Math.cos(k.a)*k.r).addScaledVector(_spu,Math.sin(k.a)*k.r);sparkPos.set([_spk.x,_spk.y,_spk.z],i*3);
    const ahead=k.s-sBase,f=clamp(ahead/15,0,1)*clamp((240-ahead)/80,0,1)*(0.25+0.75*lock)*(0.6+0.4*Math.sin(now*23+i));
    const hh=(k.h*0.35+now*0.05)%1;sparkCol[i*3]=f*(0.75+0.25*Math.cos(6.283*hh));sparkCol[i*3+1]=f*(0.75+0.25*Math.cos(6.283*(hh+0.33)));sparkCol[i*3+2]=f*(0.85+0.15*Math.cos(6.283*(hh+0.67)));}
  sparkGeo.attributes.position.needsUpdate=true;sparkGeo.attributes.color.needsUpdate=true;}

/* ================= per-track objects: coaster rails, gems, rings ================= */
function makeGem(s,d,h,ph){const base=worldAt(s,d,h,new THREE.Vector3());return {s,base,cur:base.clone(),got:false,pull:0,phase:ph};}
const gemGeo=new THREE.OctahedronGeometry(1.6,0),gemMat=new THREE.MeshLambertMaterial({color:0x86f0ff,emissive:0x2aa6c4,flatShading:true});
const ringGeo=new THREE.TorusGeometry(7,0.75,8,28);
function makeRingMesh(){const m=new THREE.Mesh(ringGeo,new THREE.MeshLambertMaterial({color:0xffc35a,emissive:0x8a4a10,flatShading:true}));m.userData.ownMat=true;scene.add(m);return m;}
function setRing(r,s){r.s=s;streamPoint(s,r.pos);frame(s);r.mesh.position.copy(r.pos);r.mesh.lookAt(r.pos.clone().add(_t));r.got=false;r.mesh.visible=true;
  r.mesh.material.color.set(0xffc35a);r.mesh.material.emissive.set(0x8a4a10);}
let gems=[],rings=[],gemMesh=null;const trackObjs=[];
const railMat=new THREE.MeshBasicMaterial({color:0xffc35a,transparent:true,opacity:0.75}),tieMat=new THREE.MeshBasicMaterial({color:0xfff1d6,transparent:true,opacity:0.55});
function buildTrack(){
  for(const o of trackObjs){scene.remove(o);if(o.geometry&&o.geometry!==gemGeo&&o.geometry!==ringGeo)o.geometry.dispose();if(o.userData.ownMat)o.material.dispose();}
  trackObjs.length=0;const add=o=>{scene.add(o);trackObjs.push(o);return o;};
  const tr=mulberry(TRACK==='coaster'?4242:1313),r2=(a,b)=>a+(b-a)*tr();
  if(RACE){buildGates(add);buildRibbon(add);gems=[];rings=[];gemMesh=add(new THREE.InstancedMesh(gemGeo,gemMat,1));gemMesh.count=0;return;}
  buildRibbon(add);   // the route ribbon replaces the old glowing current tube (owner's choice)
  if(TRACK==='coaster'){
    for(const side of [-1,1]){const rp=[];for(let s=0;s<=LEN;s+=8){const p=streamPoint(s,new THREE.Vector3());p.addScaledVector(_r,side*2.8);p.y-=1.9;rp.push(p);}
      const rail=add(new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(rp),Math.floor(LEN/4),0.13,6,false),railMat));rail.frustumCulled=false;}
    const ties=[],a=new THREE.Vector3(),b=new THREE.Vector3(),o=new THREE.Object3D();
    for(let s=0;s<LEN;s+=7){streamPoint(s+1,b);streamPoint(s,a);a.y-=1.9;b.y-=1.9;o.position.copy(a);o.lookAt(b);o.scale.set(6.2,0.16,0.45);o.updateMatrix();ties.push(o.matrix.clone());}
    const tm=add(new THREE.InstancedMesh(new THREE.BoxGeometry(1,1,1),tieMat,ties.length));ties.forEach((m,i)=>tm.setMatrixAt(i,m));tm.frustumCulled=false;}
  gems=[];const tooClose=(s,d)=>pillars.some(p=>Math.abs(p.s-s)<16&&Math.abs(p.d-d)<16);let s=220;
  if(TRACK==='coaster'){
    while(s<LEN-260){const count=12+Math.floor(tr()*10),sp2=10,wob=tr()<0.4;
      for(let k=0;k<count;k++){const ss=s+k*sp2;streamAt(ss);let d=SD,h=SH;if(wob){d+=4*Math.sin(k*0.7);h+=3*Math.cos(k*0.7);}if(tooClose(ss,d))continue;h=Math.max(h,relH(ss,d)+5);gems.push(makeGem(ss,d,h,tr()*6.28));}
      s+=count*sp2+r2(40,90);}
  }else{
    while(s<LEN-260){const type=Math.floor(tr()*5),count=7+Math.floor(tr()*5),sp2=13,od=r2(-12,12),oh=r2(-5,8);
      for(let k=0;k<count;k++){const ss=s+k*sp2;streamAt(ss);let d=SD,h=SH;
        if(type===1)d+=9*Math.sin(k*0.8);if(type===2){d+=6*Math.cos(k*0.9);h+=6*Math.sin(k*0.9);}if(type===3){d+=od;h+=oh;}if(type===4)h+=(k-count/2)*2.2;
        if(tooClose(ss,d))continue;h=Math.max(h,relH(ss,d)+5);gems.push(makeGem(ss,d,h,tr()*6.28));}
      s+=count*sp2+r2(60,130);}
  }
  gemMesh=add(new THREE.InstancedMesh(gemGeo,gemMat,gems.length));gemMesh.frustumCulled=false;
  rings=[];const ringS=[];
  if(TRACK==='coaster'){for(let i=2;i*KC<LEN-300;i++)ringS.push(i*KC);}else{for(let x=430;x<LEN-300;x+=r2(380,470))ringS.push(x);}
  for(const rs of ringS){if(pillars.some(p=>Math.abs(p.s-rs)<22))continue;const r={s:rs,pos:new THREE.Vector3(),mesh:makeRingMesh(),got:false};trackObjs.push(r.mesh);setRing(r,rs);rings.push(r);}
}
/* race gates: fly through each one; a missed gate adds 3 seconds */
const GATE_R=RACE?8.5:0,GATE_PEN=3;let gates=[];
const gateGeo=new THREE.TorusGeometry(8.5,0.55,8,36),gatePostGeo=new THREE.CylinderGeometry(0.35,0.35,1,6);
function buildGates(add){
  gates=[];const gr=mulberry(909);
  for(let s=260;s<LEN-260;s+=150+gr()*55){
    let gs=s;if(pillars.some(p=>Math.abs(p.s-gs)<28))gs+=36;if(pillars.some(p=>Math.abs(p.s-gs)<28))continue;
    streamAt(gs);let d=SD,h=SH;h=Math.max(h,relH(gs,d)+GATE_R+2);
    const arch=arches.find(a=>Math.abs(a.s-gs)<14);if(arch)h=Math.min(h,a_inner(arch,d)-GATE_R-3);
    const pos=worldAt(gs,d,h,new THREE.Vector3());frame(gs);
    const m=add(new THREE.Mesh(gateGeo,new THREE.MeshLambertMaterial({color:0xeafcff,emissive:0x2a7f94,flatShading:true})));m.userData.ownMat=true;
    m.position.copy(pos);m.lookAt(pos.clone().add(_t));m.frustumCulled=true;
    const post=add(new THREE.Mesh(gatePostGeo,m.material));const gy=groundAt(gs,d);post.scale.y=Math.max(0.1,pos.y-GATE_R-gy);post.position.set(pos.x,gy+post.scale.y/2,pos.z);if(SKY)post.visible=false;
    // Skyway, second phase: these gates breathe (6 to 11 m in radius, each on its own beat), so a wide pass has to be timed
    gates.push({s:gs,d,pos,mesh:m,post,state:0,pulse:SKY&&gs>SKY_PH.pulse[0]&&gs<SKY_PH.pulse[1]?1+gates.length*1.7:0});}
  streamAt(0);gateDh=gates.map(g=>{streamAt(g.s);return {s:g.s,dh:(g.pos.y-floorY(g.s))-SH};});
}
function gateR(g){return g.pulse?GATE_R*(1.02+0.3*Math.sin(G.time*3.6+g.pulse)):GATE_R;}
function a_inner(a,d){return Math.sqrt(Math.max(0,(a.r-9)*(a.r-9)-d*d))+a.hc;}
function resetGates(){for(const g of gates){g.state=0;paintGate(g);}G.gi=0;G.gatesHit=0;if(skyWorld)skyWorld.setPalette(0);if(gates[0])paintGate(gates[0],true);}
// on the pale Skyway the waiting gates are violet and the next one hot pink (white and gold vanish against that sky)
function paintGate(g,next){const c=g.state===1?0x9be08a:g.state===2?0xff6a5a:next?(SKY?0xff5fa8:0xffd25e):(SKY?0x8f7bff:0xeafcff),e=g.state===1?0x2d6a22:g.state===2?0x7a1c12:next?(SKY?0xb02a70:0x9a6a10):(SKY?0x4a3ac0:0x2a7f94);
  g.mesh.material.color.set(c);g.mesh.material.emissive.set(e);g.mesh.scale.setScalar(g.pulse&&g.state===0?gateR(g)/GATE_R:next?1.06:1);}
function checkGates(){
  while(G.gi<gates.length&&G.s>=gates[G.gi].s){const g=gates[G.gi];
    if(g.pos.distanceTo(G.pos)<gateR(g)+0.6){g.state=1;recEvent('gate',G.gi);if(skyWorld&&++G.gatesHit%3===0)skyWorld.setPalette(G.gatesHit/3);   // Skyway: every third gate you fly through flips the colours of the world
      G.boost=Math.min(1,G.boost+0.12);tone(880,0.12,'sine',0.06);setTimeout(()=>tone(1320,0.15,'sine',0.05),70);buzz(10);}
    else{g.state=2;G.pen+=GATE_PEN;recEvent('gate missed',G.gi+' by '+g.pos.distanceTo(G.pos).toFixed(1)+' m');toast('Missed gate +'+GATE_PEN+' s','bad');tone(150,0.3,'square',0.05);buzz(60);}
    paintGate(g);G.gi++;if(gates[G.gi])paintGate(gates[G.gi],true);}
}
buildTrack();
const FINISH_S=LEN-170;
(function(){const pos=worldAt(FINISH_S,0,60,new THREE.Vector3());frame(FINISH_S);
  const g=new THREE.Mesh(new THREE.TorusGeometry(95,3.2,10,48),new THREE.MeshLambertMaterial({color:0xffb04a,emissive:0x9a4a10}));g.position.copy(pos);g.lookAt(pos.clone().add(_t));scene.add(g);})();
// tutorial objects
const tutGems=[];for(let i=0;i<14;i++)tutGems.push({s:-999,base:new THREE.Vector3(),cur:new THREE.Vector3(),got:true,pull:0,phase:rnd()*6.28});
const tutGemMesh=new THREE.InstancedMesh(gemGeo,gemMat,tutGems.length);tutGemMesh.frustumCulled=false;tutGemMesh.visible=false;scene.add(tutGemMesh);
const tutRings=[0,1,2].map(()=>{const r={s:-999,pos:new THREE.Vector3(),mesh:makeRingMesh(),got:true};r.mesh.visible=false;return r;});

/* ================= navigator arrow ================= */
const arrow=(function(){const sh=new THREE.Shape();sh.moveTo(0,1.6);sh.lineTo(1.25,0.1);sh.lineTo(0.45,0.1);sh.lineTo(0.45,-1.3);sh.lineTo(-0.45,-1.3);sh.lineTo(-0.45,0.1);sh.lineTo(-1.25,0.1);sh.closePath();
  const g=new THREE.ShapeGeometry(sh);g.rotateX(Math.PI/2);g.rotateY(Math.PI);g.scale(1,1,-1);
  const m=new THREE.Mesh(g,new THREE.MeshBasicMaterial({color:0xffc35a,transparent:true,opacity:0,depthTest:false,depthWrite:false,side:THREE.DoubleSide}));
  m.renderOrder=10;m.frustumCulled=false;scene.add(m);return m;})();
// sanity: arrow tip should point toward +Z so lookAt aims it
(function(){const p=arrow.geometry.attributes.position;let maxZ=-1e9;for(let i=0;i<p.count;i++)maxZ=Math.max(maxZ,p.getZ(i));if(maxZ<1)logIssue('Setup','Navigator arrow orientation check failed.');})();

/* ================= the pilot (wingsuit + glide pack) ================= */
const player=new THREE.Group();scene.add(player);
const rig=new THREE.Group();player.add(rig);player.scale.setScalar(1.485);
const L=c=>new THREE.MeshLambertMaterial({color:c,flatShading:true});
const suitMat=L(0x2e3554),accentMat=L(0xef6a3c),helmetMat=L(0xf4efe8),packMat=L(0x3b3f4e);
const visorMat=new THREE.MeshLambertMaterial({color:0x22374a,emissive:0x1d4a5a,flatShading:true});
const torso=new THREE.Mesh(new THREE.CylinderGeometry(0.27,0.22,1.1,8),suitMat);torso.rotation.x=Math.PI/2;torso.position.z=-0.05;rig.add(torso);
const stripe=new THREE.Mesh(new THREE.CylinderGeometry(0.275,0.255,0.18,8),accentMat);stripe.rotation.x=Math.PI/2;stripe.position.z=-0.35;rig.add(stripe);
const helmet=new THREE.Mesh(new THREE.SphereGeometry(0.23,10,8),helmetMat);helmet.position.set(0,0.06,-0.8);rig.add(helmet);
const visor=new THREE.Mesh(new THREE.BoxGeometry(0.3,0.12,0.1),visorMat);visor.position.set(0,0.06,-1.0);rig.add(visor);
const pack=new THREE.Mesh(new THREE.BoxGeometry(0.42,0.16,0.62),packMat);pack.position.set(0,0.24,0.0);rig.add(pack);
const nozzles=[-0.12,0.12].map(x=>{const n=new THREE.Mesh(new THREE.CylinderGeometry(0.06,0.08,0.14,8),L(0x8a8f9c));n.rotation.x=Math.PI/2;n.position.set(x,0.24,0.36);rig.add(n);
  const f=new THREE.Mesh(new THREE.ConeGeometry(0.07,1,8),new THREE.MeshBasicMaterial({color:0xffb04a,transparent:true,opacity:0.85,blending:THREE.AdditiveBlending,depthWrite:false}));
  f.geometry.translate(0,-0.5,0);f.rotation.x=-Math.PI/2;f.position.set(x,0.24,0.43);f.scale.set(1,0.01,1);rig.add(f);return f;});
function limb(r){const g=new THREE.CylinderGeometry(r,r*0.85,1,6);g.translate(0,0.5,0);const m=new THREE.Mesh(g,suitMat);rig.add(m);return m;}
function placeLimb(m,a,b){const d=new THREE.Vector3().subVectors(b,a);const len=d.length();m.position.copy(a);m.quaternion.setFromUnitVectors(UP,d.normalize());m.scale.set(1,len,1);}
const armL=limb(0.075),armR=limb(0.075),legL=limb(0.1),legR=limb(0.1);
const handL=new THREE.Mesh(new THREE.SphereGeometry(0.075,6,5),L(0x222633)),handR=handL.clone();rig.add(handL,handR);
const bootL=new THREE.Mesh(new THREE.BoxGeometry(0.14,0.12,0.24),L(0x222633)),bootR=bootL.clone();rig.add(bootL,bootR);
const J={shL:new THREE.Vector3(-0.26,0.04,-0.45),shR:new THREE.Vector3(0.26,0.04,-0.45),hipL:new THREE.Vector3(-0.13,0,0.45),hipR:new THREE.Vector3(0.13,0,0.45),
  ftL:new THREE.Vector3(-0.34,-0.02,1.55),ftR:new THREE.Vector3(0.34,-0.02,1.55),wL:new THREE.Vector3(),wR:new THREE.Vector3(),sideL:new THREE.Vector3(-0.3,0,0.62),sideR:new THREE.Vector3(0.3,0,0.62)};
placeLimb(legL,J.hipL,J.ftL);placeLimb(legR,J.hipR,J.ftR);bootL.position.copy(J.ftL);bootR.position.copy(J.ftR);
// wing membranes (dynamic)
const memPos=new Float32Array(10*3*3);const memGeo=new THREE.BufferGeometry();memGeo.setAttribute('position',new THREE.BufferAttribute(memPos,3));
const memMat=new THREE.MeshLambertMaterial({color:0xef6a3c,emissive:0x3a1206,side:THREE.DoubleSide,flatShading:true});
const membrane=new THREE.Mesh(memGeo,memMat);membrane.frustumCulled=false;rig.add(membrane);
const tipL=new THREE.Object3D(),tipR=new THREE.Object3D();rig.add(tipL,tipR);
const WB=new THREE.Vector3(1.25,0,0.02),WF=new THREE.Vector3(1.0,0.22,-0.42),WT=new THREE.Vector3(0.8,-0.06,0.5);
function wristFor(a,side,out){if(a>=0)out.copy(WB).lerp(WF,a);else out.copy(WB).lerp(WT,-a);out.x*=side;return out;}
const _mid=new THREE.Vector3();
function updatePilot(aL,aR){
  wristFor(aL,-1,J.wL);wristFor(aR,1,J.wR);
  placeLimb(armL,J.shL,J.wL);placeLimb(armR,J.shR,J.wR);handL.position.copy(J.wL);handR.position.copy(J.wR);tipL.position.copy(J.wL);tipR.position.copy(J.wR);
  let o=0;const tri=(a,b,c)=>{memPos.set([a.x,a.y,a.z,b.x,b.y,b.z,c.x,c.y,c.z],o);o+=9;};
  for(const [sh,w,sd,hip,ft] of [[J.shL,J.wL,J.sideL,J.hipL,J.ftL],[J.shR,J.wR,J.sideR,J.hipR,J.ftR]]){
    _mid.copy(w).lerp(sd,0.5);_mid.y-=0.06;_mid.z+=0.12; // billow
    tri(sh,w,_mid);tri(sh,_mid,sd);tri(sh,sd,hip);tri(sd,ft,hip);}
  tri(J.hipL,J.ftL,J.ftR);tri(J.hipL,J.ftR,J.hipR);
  memGeo.attributes.position.needsUpdate=true;memGeo.computeVertexNormals();
}
updatePilot(0,0);

/* ================= alpha-ribbon shader (trails, air wisps) ================= */
function alphaMat(color,additive){return new THREE.ShaderMaterial({transparent:true,depthWrite:false,side:THREE.DoubleSide,blending:additive?THREE.AdditiveBlending:THREE.NormalBlending,
  uniforms:{col:{value:new THREE.Color(color)}},vertexShader:'attribute float alpha;varying float vA;void main(){vA=alpha;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}',
  fragmentShader:'uniform vec3 col;varying float vA;void main(){gl_FragColor=vec4(col,vA);}'});}
function stripIndex(nStrips,nPts){const idx=[];for(let w=0;w<nStrips;w++){const b=w*nPts*2;for(let i=0;i<nPts-1;i++){const a=b+i*2;idx.push(a,a+2,a+1,a+1,a+2,a+3);}}return idx;}
// wrist vortex trails
function makeTrail(){const N=22,pos=new Float32Array(N*6),al=new Float32Array(N*2);const g=new THREE.BufferGeometry();
  g.setAttribute('position',new THREE.BufferAttribute(pos,3));g.setAttribute('alpha',new THREE.BufferAttribute(al,1));g.setIndex(stripIndex(1,N));
  const m=new THREE.Mesh(g,alphaMat('#fff3dc'));m.frustumCulled=false;scene.add(m);return {N,hist:[],g,pos,al};}
const trailL=makeTrail(),trailR=makeTrail();const _w=new THREE.Vector3(),_pu=new THREE.Vector3(),_q=new THREE.Quaternion();
function updateTrail(tr,tip,strength){tip.getWorldPosition(_w);tr.hist.unshift(_w.clone());if(tr.hist.length>tr.N)tr.hist.pop();
  _pu.set(0,1,0).applyQuaternion(rig.getWorldQuaternion(_q));
  for(let i=0;i<tr.N;i++){const p=tr.hist[Math.min(i,tr.hist.length-1)],o=i*6;tr.pos[o]=p.x;tr.pos[o+1]=p.y;tr.pos[o+2]=p.z;tr.pos[o+3]=p.x+_pu.x*0.2;tr.pos[o+4]=p.y+_pu.y*0.2;tr.pos[o+5]=p.z+_pu.z*0.2;
    const a=(1-i/tr.N)*(1-i/tr.N)*strength*0.8;tr.al[i*2]=a;tr.al[i*2+1]=a;}
  tr.g.attributes.position.needsUpdate=true;tr.g.attributes.alpha.needsUpdate=true;}
// air wisps flowing around the pilot
const WISPS=isTouch?28:40,WP=12;
const wisps=[];for(let i=0;i<WISPS;i++)wisps.push({t:rnd(),x:0,y:0,len:0,spd:0});
function resetWisp(w){const side=rnd()<0.5?-1:1;w.x=side*rr(0.2,3.4);w.y=rr(-1.3,1.6);w.len=rr(4.5,9);w.spd=rr(0.8,1.25);}
wisps.forEach(resetWisp);
const wispPos=new Float32Array(WISPS*WP*6),wispAl=new Float32Array(WISPS*WP*2);
const wispGeo=new THREE.BufferGeometry();wispGeo.setAttribute('position',new THREE.BufferAttribute(wispPos,3));wispGeo.setAttribute('alpha',new THREE.BufferAttribute(wispAl,1));wispGeo.setIndex(stripIndex(WISPS,WP));
const wispMesh=new THREE.Mesh(wispGeo,alphaMat('#ffffff'));wispMesh.frustumCulled=false;scene.add(wispMesh);
const wpts=[];for(let i=0;i<WP;i++)wpts.push(new THREE.Vector3());
const _seg=new THREE.Vector3(),_toC=new THREE.Vector3(),_side=new THREE.Vector3();
function updateWisps(dt,vis,now){
  rig.updateMatrixWorld(true);const M=rig.matrixWorld;const yr=G.yawRate,pr=G.pitchRate;
  for(let wi=0;wi<WISPS;wi++){const w=wisps[wi];w.t+=dt*(Math.max(G.speed,30)/26)*w.spd/26*1.0;if(w.t>1){w.t-=1;resetWisp(w);}
    const zHead=-14+w.t*26,fade=smooth(0,0.15,w.t)*(1-smooth(0.7,1,w.t));
    for(let k=0;k<WP;k++){const z=zHead-k*(w.len/(WP-1)),u=Math.max(0,z+14);
      let x=w.x+yr*0.0042*u*u,y=w.y-pr*0.006*u*u;const gq=G.gust||0;x+=Math.sin(z*0.7+now*7+wi)*gq*0.45;y+=Math.cos(z*0.6+now*6+wi*1.3)*gq*0.32;
      if(Math.abs(x)<2.9)y+=0.45*Math.exp(-z*z/5)*(w.y>0?1:-0.6); // air lifts over the wing, slips under it
      const r2=x*x+y*y;if(r2<4){const k2=Math.exp(-z*z/3)*(1.1/(0.45+r2));x+=x*k2*0.5;y+=y*k2*0.5;} // parts around the body
      wpts[k].set(x,y,z).applyMatrix4(M);
      const a=vis*fade*Math.sin(Math.PI*k/(WP-1))*(1-smooth(6,12,z));wispAl[(wi*WP+k)*2]=a;wispAl[(wi*WP+k)*2+1]=a;}
    for(let k=0;k<WP;k++){const p=wpts[k];_seg.subVectors(wpts[Math.min(WP-1,k+1)],wpts[Math.max(0,k-1)]);_toC.subVectors(camera.position,p);
      _side.crossVectors(_seg,_toC).normalize().multiplyScalar(0.045);const o=(wi*WP+k)*6;
      wispPos[o]=p.x-_side.x;wispPos[o+1]=p.y-_side.y;wispPos[o+2]=p.z-_side.z;wispPos[o+3]=p.x+_side.x;wispPos[o+4]=p.y+_side.y;wispPos[o+5]=p.z+_side.z;}}
  wispGeo.attributes.position.needsUpdate=true;wispGeo.attributes.alpha.needsUpdate=true;
}

/* ================= motes drifting inside the current ================= */
const MN=isTouch?160:280,motes=[],motePos=new Float32Array(MN*3);
for(let i=0;i<MN;i++)motes.push({s:-1e9,a:rnd()*6.28,r:rr(0.3,1.9),spd:rr(32,48)});
const moteGeo=new THREE.BufferGeometry();moteGeo.setAttribute('position',new THREE.BufferAttribute(motePos,3));
const moteMesh=new THREE.Points(moteGeo,new THREE.PointsMaterial({color:0xfff1d6,size:0.55,map:SOFT,transparent:true,opacity:0.9,blending:THREE.AdditiveBlending,depthWrite:false}));moteMesh.frustumCulled=false;scene.add(moteMesh);
const _mp=new THREE.Vector3();
function updateMotes(dt){const sb=G.state==='menu'?G.menuS:G.s;for(let i=0;i<MN;i++){const m=motes[i];m.s+=m.spd*dt;if(m.s<sb-15||m.s>sb+420)m.s=sb+rr(10,420);m.a+=dt*1.6;
  streamPoint(Math.min(m.s,LEN),_mp);_mp.addScaledVector(_r,Math.cos(m.a)*m.r);_mp.y+=Math.sin(m.a)*m.r;motePos[i*3]=_mp.x;motePos[i*3+1]=_mp.y;motePos[i*3+2]=_mp.z;}
  moteGeo.attributes.position.needsUpdate=true;}

/* ================= gust lines: visible wind sweeping down the gorge ================= */
const GS=isTouch?22:36,GP=16;
const strands=[];for(let i=0;i<GS;i++)strands.push({alive:false,t:0,life:1,o:new THREE.Vector3(),dir:new THREE.Vector3(),side:new THREE.Vector3(),ph1:0,ph2:0,a1:0,a2:0,len:0,spd:0,str:0});
const stPos=new Float32Array(GS*GP*6),stAl=new Float32Array(GS*GP*2);
const stGeo=new THREE.BufferGeometry();stGeo.setAttribute('position',new THREE.BufferAttribute(stPos,3));stGeo.setAttribute('alpha',new THREE.BufferAttribute(stAl,1));stGeo.setIndex(stripIndex(GS,GP));
const stMesh=new THREE.Mesh(stGeo,alphaMat('#ffffff'));stMesh.frustumCulled=false;scene.add(stMesh);
const stPts=[];for(let i=0;i<GP;i++)stPts.push(new THREE.Vector3());const _wd=new THREE.Vector3(),_sf=new THREE.Vector3(),_sr=new THREE.Vector3();
function updateStrands(dt,now){
  camera.getWorldDirection(_sf);_sr.crossVectors(_sf,UP).normalize();frame(G.state==='menu'?G.menuS:G.s);
  _wd.copy(_t).addScaledVector(_r,Math.sin(now*0.2)*0.25).normalize();
  const gu=gustAt(camera.position.x,camera.position.z,now);
  for(let si=0;si<GS;si++){const st=strands[si];
    if(!st.alive&&Math.random()<dt*(1.2+gu*9)){st.alive=true;st.t=0;st.life=rr(1.8,3.2);
      st.o.copy(camera.position).addScaledVector(_sf,rr(15,120)).addScaledVector(_sr,rr(-50,50)).addScaledVector(_wd,-rr(10,40));st.o.y+=rr(-10,26);
      st.dir.copy(_wd);st.dir.y+=rr(-0.08,0.08);st.dir.normalize();st.side.copy(_sr);st.ph1=rnd()*6.28;st.ph2=rnd()*6.28;st.a1=rr(1,5);st.a2=rr(0.5,3);st.len=rr(18,42);st.spd=26+gu*30;st.str=Math.min(1,0.45+gu*0.8);}
    if(st.alive){st.t+=dt;if(st.t>st.life)st.alive=false;}
    const base=si*GP;
    if(!st.alive){for(let k=0;k<GP;k++){stAl[(base+k)*2]=0;stAl[(base+k)*2+1]=0;}continue;}
    const head=st.t*st.spd,lf=smooth(0,0.2,st.t/st.life)*(1-smooth(0.7,1,st.t/st.life));
    for(let k=0;k<GP;k++){const u=Math.max(0,head-(GP-1-k)*(st.len/(GP-1)));const p=stPts[k];
      p.copy(st.o).addScaledVector(st.dir,u).addScaledVector(st.side,Math.sin(u*0.05+st.ph1)*st.a1);p.y+=Math.sin(u*0.04+st.ph2)*st.a2;
      const a=st.str*Math.sin(Math.PI*k/(GP-1))*lf*0.32;stAl[(base+k)*2]=a;stAl[(base+k)*2+1]=a;}
    for(let k=0;k<GP;k++){const p=stPts[k];_seg.subVectors(stPts[Math.min(GP-1,k+1)],stPts[Math.max(0,k-1)]);_toC.subVectors(camera.position,p);
      _side.crossVectors(_seg,_toC);const L=_side.length();if(L>1e-6)_side.multiplyScalar(0.11/L);const o=(base+k)*6;
      stPos[o]=p.x-_side.x;stPos[o+1]=p.y-_side.y;stPos[o+2]=p.z-_side.z;stPos[o+3]=p.x+_side.x;stPos[o+4]=p.y+_side.y;stPos[o+5]=p.z+_side.z;}}
  stGeo.attributes.position.needsUpdate=true;stGeo.attributes.alpha.needsUpdate=true;}

/* ================= drifting leaves ================= */
const LN=isTouch?150:240;
const leafGeo=new THREE.PlaneGeometry(0.42,0.24);
const leafMesh=new THREE.InstancedMesh(leafGeo,new THREE.MeshLambertMaterial({side:THREE.DoubleSide,emissive:0x3a2414}),LN);leafMesh.frustumCulled=false;scene.add(leafMesh);if(SKY)leafMesh.visible=false;
const leaves=[];{const lc=['#f0a33a','#e3672f','#f6cf5a','#8fb35a','#c9543a','#f6b8cf','#fbd3e0'],c=new THREE.Color();
  for(let i=0;i<LN;i++){leaves.push({p:new THREE.Vector3(1e6,0,0),rot:new THREE.Euler(rnd()*6,rnd()*6,rnd()*6),spin:new THREE.Vector3(rr(-4,4),rr(-4,4),rr(-4,4)),ph:rnd()*6.28,scale:rr(0.7,1.4)});leafMesh.setColorAt(i,c.set(lc[i%lc.length]));}}
const _lm=new THREE.Matrix4(),_lq=new THREE.Quaternion(),_ls=new THREE.Vector3(),_cf=new THREE.Vector3(),_cr=new THREE.Vector3(),_wind=new THREE.Vector3(),_rel=new THREE.Vector3();
function updateLeaves(dt,now,sNow){
  camera.getWorldDirection(_cf);_cr.crossVectors(_cf,UP).normalize();frame(sNow);
  const lg=gustAt(camera.position.x,camera.position.z,now);_wind.copy(_t).multiplyScalar(8+lg*16).addScaledVector(_r,Math.sin(now*0.45)*(4.5+lg*5));_wind.y+=Math.sin(now*0.8)*1.2-1.3;
  const nearT=thermals.filter(t=>Math.abs(t.s-sNow)<160);
  for(let i=0;i<LN;i++){const l=leaves[i];_rel.subVectors(l.p,camera.position);
    if(_rel.lengthSq()>115*115||_rel.dot(_cf)<-5){l.p.copy(camera.position).addScaledVector(_cf,rr(12,105)).addScaledVector(_cr,rr(-42,42));l.p.y+=rr(-14,18);if(nearT.length&&Math.random()<0.15){const t=nearT[Math.floor(Math.random()*nearT.length)];l.p.set(t.c.x+rr(-9,9),t.c.y+rr(0,60),t.c.z+rr(-9,9));}}
    l.p.addScaledVector(_wind,dt);for(const t of nearT){const dx=l.p.x-t.c.x,dz=l.p.z-t.c.z;if(dx*dx+dz*dz<t.r*t.r*2.2&&l.p.y<t.c.y+150){l.p.y+=(14-_wind.y)*dt;l.p.x-=dz*0.9*dt;l.p.z+=dx*0.9*dt;}}l.p.x+=Math.sin(now*3+l.ph)*1.6*dt;l.p.y+=Math.cos(now*2.3+l.ph)*1.1*dt;
    l.rot.x+=l.spin.x*dt;l.rot.y+=l.spin.y*dt;l.rot.z+=l.spin.z*dt;_lq.setFromEuler(l.rot);_ls.setScalar(l.scale*Math.min(1,_rel.length()/8));_lm.compose(l.p,_lq,_ls);leafMesh.setMatrixAt(i,_lm);}
  leafMesh.instanceMatrix.needsUpdate=true;
}

/* ================= audio ================= */
let actx=null,windGain=null,windFilter=null,muted=store.get('muted',false);
function initAudio(){if(actx)return;try{actx=new(window.AudioContext||window.webkitAudioContext)();const len=actx.sampleRate*2,buf=actx.createBuffer(1,len,actx.sampleRate),ch=buf.getChannelData(0);let last=0;
  for(let i=0;i<len;i++){const w=Math.random()*2-1;last=(last+0.02*w)/1.02;ch[i]=last*3.5;}
  const src=actx.createBufferSource();src.buffer=buf;src.loop=true;windFilter=actx.createBiquadFilter();windFilter.type='lowpass';windFilter.frequency.value=400;
  windGain=actx.createGain();windGain.gain.value=0;src.connect(windFilter).connect(windGain).connect(actx.destination);src.start();}
  catch(e){logIssue('Audio','Sound could not start: '+e.message);actx=null;}}
function tone(freq,dur,type,vol,slide){if(!actx||muted)return;try{const o=actx.createOscillator(),g=actx.createGain(),t=actx.currentTime;o.type=type||'sine';o.frequency.setValueAtTime(freq,t);
  if(slide)o.frequency.exponentialRampToValueAtTime(freq*slide,t+dur);g.gain.setValueAtTime(0.0001,t);g.gain.exponentialRampToValueAtTime(vol||0.08,t+0.012);g.gain.exponentialRampToValueAtTime(0.0001,t+dur);
  o.connect(g).connect(actx.destination);o.start(t);o.stop(t+dur+0.02);}catch(e){}}
function buzz(ms){if(navigator.vibrate)try{navigator.vibrate(ms);}catch(e){}if(phone.status==='connected')phoneBuzz(ms);}
function setMuteUI(){$('muteBtn').textContent=muted?'×':'♪';$('muteBtn').setAttribute('aria-label',muted?'Unmute sound':'Mute sound');}
setMuteUI();$('muteBtn').onclick=()=>{muted=!muted;store.set('muted',muted);setMuteUI();};

/* ================= input ================= */
const input={tL:0,tR:0,kL:0,kR:0,mL:0,mR:0,rL:0,rR:0};const touches=new Map();let lastTap=0;const keysDown=new Set();
function noteInput(src){if(lastInput===src)return;lastInput=src;if(G.mode==='tut'&&(G.state==='play'||G.state==='paused'))tutRefresh();}
const thumbEl={L:$('thumbL'),R:$('thumbR')};
const tv=(o)=>clamp((o.y-o.y0)/(window.innerHeight*0.16),-1,1);
const th=(o)=>clamp(-(o.x-o.x0)/(window.innerWidth*0.14),-1,1);
canvas.addEventListener('touchstart',e=>{e.preventDefault();initAudio();noteInput('touch');
  for(const t of e.changedTouches){const side=settings.mode==='one'?'O':(t.clientX<window.innerWidth/2?'L':'R');
    if(side==='O'&&[...touches.values()].some(o=>o.side==='O')){touches.set(t.identifier,{side:'X',x0:t.clientX,y0:t.clientY,x:t.clientX,y:t.clientY,t0:performance.now()});continue;}
    for(const [id,o] of touches)if(o.side===side)touches.delete(id);
    touches.set(t.identifier,{side,x0:t.clientX,y0:t.clientY,x:t.clientX,y:t.clientY,t0:performance.now()});}},{passive:false});
canvas.addEventListener('touchmove',e=>{e.preventDefault();for(const t of e.changedTouches){const o=touches.get(t.identifier);if(o){o.x=t.clientX;o.y=t.clientY;}}},{passive:false});
function endTouch(e){e.preventDefault();const now=performance.now();
  for(const t of e.changedTouches){const o=touches.get(t.identifier);if(!o)continue;const moved=Math.hypot(t.clientX-o.x0,t.clientY-o.y0);
    if(now-o.t0<230&&moved<16){if(now-lastTap<340){tryBoost();lastTap=0;}else lastTap=now;}touches.delete(t.identifier);}}
canvas.addEventListener('touchend',endTouch,{passive:false});canvas.addEventListener('touchcancel',endTouch,{passive:false});
let mouse=null;
canvas.addEventListener('pointerdown',e=>{if(e.pointerType!=='mouse')return;initAudio();noteInput('mouse');mouse={x0:e.clientX,y0:e.clientY,x:e.clientX,y:e.clientY};canvas.focus();try{canvas.setPointerCapture(e.pointerId);}catch(_){}});
canvas.addEventListener('pointermove',e=>{if(e.pointerType==='mouse'&&mouse){mouse.x=e.clientX;mouse.y=e.clientY;}});
const mouseUp=e=>{if(e.pointerType==='mouse')mouse=null;};canvas.addEventListener('pointerup',mouseUp);canvas.addEventListener('pointercancel',mouseUp);
canvas.addEventListener('dblclick',()=>tryBoost());
window.addEventListener('keydown',e=>{const k=e.key.length===1?e.key.toLowerCase():e.key;
  if(['ArrowUp','ArrowDown','ArrowLeft','ArrowRight',' '].includes(k))e.preventDefault();if(e.repeat)return;keysDown.add(k);initAudio();if(!['Escape','m','p','v','Enter'].includes(k))noteInput('keys');
  if(k===' ')tryBoost();
  if(k==='p'||k==='Escape'){if(G.state==='play')pause();else if(G.state==='paused')resume();}
  if(k==='m')$('muteBtn').click();});
window.addEventListener('keyup',e=>{const k=e.key.length===1?e.key.toLowerCase():e.key;keysDown.delete(k);});
window.addEventListener('blur',()=>{keysDown.clear();touches.clear();mouse=null;if(G.state==='play')pause();});
document.addEventListener('visibilitychange',()=>{if(document.hidden&&G.state==='play')pause();if(document.hidden&&G._rec)endRecording('left the page');});   // sent now, in case the tab is closed
function readInput(dt){
  let L=0,R=0,hasL=false,hasR=false;
  for(const o of touches.values()){if(o.side==='L'){L=tv(o);hasL=true;}else if(o.side==='R'){R=tv(o);hasR=true;}
    else if(o.side==='O'){const p=tv(o),t=th(o);L=clamp(p+t,-1,1);R=clamp(p-t,-1,1);hasL=hasR=true;}}
  const ease=(c,g,r)=>c+(g-c)*Math.min(1,dt*r);
  input.tL=hasL?L:ease(input.tL,0,5);input.tR=hasR?R:ease(input.tR,0,5);
  let kl=0,kr=0;const kd=k=>keysDown.has(k);
  if(settings.control==='arms'){if(kd('w'))kl-=1;if(kd('s'))kl+=1;if(kd('ArrowUp'))kr-=1;if(kd('ArrowDown'))kr+=1;
    if(kd('a')||kd('ArrowLeft')){kl+=0.85;kr-=0.85;}if(kd('d')||kd('ArrowRight')){kl-=0.85;kr+=0.85;}}
  else{let p=0,t=0;if(kd('w')||kd('ArrowUp'))p+=1;if(kd('s')||kd('ArrowDown'))p-=1;if(kd('a')||kd('ArrowLeft'))t+=0.85;if(kd('d')||kd('ArrowRight'))t-=0.85;kl=p+t;kr=p-t;}
  input.kL=ease(input.kL,clamp(kl,-1,1),5);input.kR=ease(input.kR,clamp(kr,-1,1),5);
  if(mouse){const p=clamp((mouse.y-mouse.y0)/(window.innerHeight*0.2),-1,1),t=clamp(-(mouse.x-mouse.x0)/(window.innerWidth*0.15),-1,1);input.mL=clamp(p+t,-1,1);input.mR=clamp(p-t,-1,1);}
  else{input.mL=ease(input.mL,0,5);input.mR=ease(input.mR,0,5);}
  if(settings.control==='phone'&&phone.status!=='off'){remote.active=phone.live||phone.hold;remote.L=phone.L;remote.R=phone.R;remote.tl=remote.tr=remote.active;if(remote.active&&keysDown.size===0&&!mouse&&touches.size===0)noteInput('remote');}
  else if(hand.enabled){remote.active=hand.tracking&&hand.calibrated;remote.L=hand.L;remote.R=hand.R;remote.tl=remote.tr=remote.active;if(remote.active&&settings.control==='camera'&&keysDown.size===0&&!mouse&&touches.size===0)noteInput('remote');}else remote.active=false;
  const rRate=settings.control==='phone'?70:settings.control==='camera'?40:20;input.rL=ease(input.rL,remote.active?remote.L:0,rRate);input.rR=ease(input.rR,remote.active?remote.R:0,rRate);
  const s=settings.sens;return {L:clamp((input.tL+input.kL+input.mL+input.rL)*s,-1,1),R:clamp((input.tR+input.kR+input.mR+input.rR)*s,-1,1)};
}
function drawThumbs(){
  const active=G.state==='play';const one=settings.mode==='one';
  for(const side of ['L','R']){const el=thumbEl[side];let o=null;
    for(const t of touches.values())if(t.side===side||(one&&side==='L'&&t.side==='O'))o=t;
    if(!o||!active){el.style.display='none';continue;}
    el.style.display='block';el.classList.toggle('one',one);el.style.left=o.x0+'px';el.style.top=o.y0+'px';
    el.querySelector('.tag').textContent=one?'DRAG TO STEER':(side==='L'?'LEFT ARM':'RIGHT ARM');
    el.querySelector('.knob').style.transform=one?`translate(${-th(o)*34}px,${tv(o)*34}px)`:`translateY(${tv(o)*34}px)`;}
}

/* ================= game state ================= */
const G={state:'menu',mode:'main',pos:new THREE.Vector3(),yaw:0,pitch:0,roll:0,speed:70,s:0,d:0,idx:0,yawRate:0,pitchRate:0,
  score:0,combo:0,comboT:0,gems:0,rings:0,crashes:0,boost:0.34,boostT:0,crashT:0,invuln:0,time:0,skim:false,inStream:false,lock:0,onLine:0,flow:1,lineOff:0,helpYaw:0,helpPitch:0,help:0,ign:0,offV:0,eV:0,offP:NaN,eP:0,pullV:new THREE.Vector3(),raceLvl:'',menuS:0,
  armL:0,armR:0,pitchIn:0,turnIn:0,bumpT:0,gust:0,oobT:0,rescueT:0,inThermal:false,progS:0,progT:0};
const dir=new THREE.Vector3();
const trackYaw=()=>Math.atan2(-_t.x,-_t.z);
function angDiff(a,b){let d=a-b;while(d>Math.PI)d-=Math.PI*2;while(d<-Math.PI)d+=Math.PI*2;return d;}
function placeAt(s,h){streamAt(s);worldAt(s,SD,Math.max(h,SH),G.pos);frame(s);G.yaw=trackYaw();G.pitch=-0.08;G.roll=0;G.s=s;G.d=SD;G.idx=Math.round(s/STEP);trailL.hist.length=0;trailR.hist.length=0;}
function locate(){let bi=G.idx,bd=Infinity;
  for(let i=Math.max(0,G.idx-14);i<=Math.min(S-1,G.idx+14);i++){const dx=G.pos.x-C[i].x,dz=G.pos.z-C[i].z,dd=dx*dx+dz*dz;if(dd<bd){bd=dd;bi=i;}}
  G.idx=bi;const dx=G.pos.x-C[bi].x,dz=G.pos.z-C[bi].z;G.s=clamp(bi*STEP+dx*T[bi].x+dz*T[bi].z,0,LEN);G.d=dx*R[bi].x+dz*R[bi].z;}
const multiplier=()=>1+Math.min(3,Math.floor(G.combo/5)*0.5);
let toastTimer=0;
function toast(text,cls){const t=$('toast');t.textContent=text;t.className='toast show '+(cls||'');clearTimeout(toastTimer);toastTimer=setTimeout(()=>t.className='toast '+(cls||''),850);}
function tryBoost(){if(G.state!=='play'||G.boostT>0)return;
  if(G.boost>=0.33){G.boost-=0.33;G.boostT=1.5;recEvent('boost');toast('Boost','gem');tone(220,0.5,'sawtooth',0.05,3);buzz(25);}
  else toast(G.mode==='tut'?'No charge yet':'Thread rings to charge boost','bad');}
function updraft(dt){G.inThermal=false;for(const th of thermals){if(Math.abs(th.s-G.s)>25)continue;const dx=G.pos.x-th.c.x,dz=G.pos.z-th.c.z,dd=Math.sqrt(dx*dx+dz*dz);
  if(dd<th.r&&G.pos.y<th.c.y+150){G.inThermal=true;const k=1-dd/th.r;G.pos.y+=20*k*dt;G.speed=Math.min(160,G.speed+4*k*dt);if(!th.hit){th.hit=true;toast('Updraft!','gem');tone(440,0.5,'sine',0.05,1.6);}}}}
function startRescue(){recEvent('rescue','off course at '+Math.round(G.s)+' m');G.rescueT=0.45;$('fadeB').classList.add('on');}
function finishRescue(){placeAt(clamp(G.s,30,LEN-400),0);G.progS=G.s;G.progT=0;G.speed=70;G.invuln=1.5;G.combo=0;G.oobT=0;$('fadeB').classList.remove('on');updateCamera(0,true);toast('Back on the line','good');}
function crash(){recEvent('crash',Math.round(G.s)+' m, '+Math.round(G.lineOff)+' m off the line');G.crashes++;G.crashT=1.1;G.combo=0;G.comboT=0;G.speed=0;toast('Bonk! Combo lost','bad');tone(110,0.4,'triangle',0.15,0.5);
  const f=$('flash');f.style.opacity=1;setTimeout(()=>f.style.opacity=0,350);buzz(120);}
function softBump(){G.bumpT=0.6;G.pitch=Math.max(G.pitch,0.25);G.speed=Math.max(G.speed*0.85,45);if(!G._bumpMsg||G.time-G._bumpMsg>3){toast('Careful, pull up','bad');G._bumpMsg=G.time;}}

const _tmp=new THREE.Vector3();
function collectGems(list,dt){
  const radius=9+G.speed*0.03;
  for(const g of list){if(g.got)continue;if(Math.abs(g.s-G.s)>26){g.pull=Math.max(0,g.pull-dt*2);continue;}
    _tmp.subVectors(g.base,G.pos);const dist=_tmp.length();
    if(dist<radius&&_tmp.dot(dir)>-dist*0.35)g.pull=Math.min(1,g.pull+dt*7);else g.pull=Math.max(0,g.pull-dt*2.5);
    const e=g.pull*g.pull;g.cur.copy(g.base).lerp(G.pos,e);
    if(g.cur.distanceTo(G.pos)<3.4||g.pull>=0.97){g.got=true;g.pull=0;G.gems++;G.combo++;G.comboT=2.6;
      G.score+=Math.round(10*multiplier());G.boost=Math.min(1,G.boost+0.02);if(G.mode==='tut')tut.gems++;
      tone(740*Math.pow(2,(G.combo%10)/12),0.18,'sine',0.07);buzz(6);}}
}
function collectRings(list){
  for(const r of list){if(r.got||Math.abs(r.s-G.s)>12)continue;
    if(r.pos.distanceToSquared(G.pos)<8.8*8.8){r.got=true;G.rings++;recEvent('ring',Math.round(r.s));G.combo+=3;G.comboT=2.6;const pts=Math.round(50*multiplier());G.score+=pts;
      G.boost=Math.min(1,G.boost+0.34);r.mesh.material.color.set(0xfff3dc);r.mesh.material.emissive.set(0x555555);if(G.mode==='tut')tut.rings++;
      toast(G.mode==='tut'?'Ring!':'Ring +'+pts,'ring');tone(523,0.25,'triangle',0.08);setTimeout(()=>tone(784,0.3,'triangle',0.08),90);buzz(20);}}
}

/* ---- guided line: does the player's tilt roughly match what the line needs? ---- */
const _gq=new THREE.Vector3(),_gr=new THREE.Vector3();
function guideLevel(){return RACE&&!G.solo&&room.status==='in'&&GUIDE[G.raceLvl]?G.raceLvl:settings.guide;}
function guide(dt){
  const GL=GUIDE[guideLevel()];routePoint(G.s,_gq);G.lineOff=_gq.distanceTo(G.pos);const dyNow=_gq.y-G.pos.y;
  // how fast you are closing on the line (m/s, + = getting nearer), overall and up/down. A jump (crash reset, start)
  // is not movement, so it restarts the measurement.
  {const e=Math.max(dt,1e-3),jump=!(Math.abs(G.lineOff-G.offP)<250*e),k=1-Math.exp(-dt*12);
   if(jump){G.offV=0;G.eV=0;}else{G.offV+=((G.offP-G.lineOff)/e-G.offV)*k;G.eV+=((dyNow-G.eP)/e-G.eV)*k;}
   G.offP=G.lineOff;G.eP=dyNow;}
  // what the line needs: aim at a point on it ~1.1 s ahead (pure pursuit). Further ahead = bends ask for your tilt earlier
  // and more gently (owner's recording: a coaster bend went from 'nothing' to 'full tilt' in ~1 s and threw them 100 m off)
  const look=clamp(G.speed*1.1,40,140);routePoint(Math.min(LEN,G.s+look),_gr);
  const dx=_gr.x-G.pos.x,dz=_gr.z-G.pos.z,dy=_gr.y-G.pos.y,hd=Math.hypot(dx,dz)||1;
  const wantYaw=Math.atan2(-dx,-dz),wantPitch=Math.atan2(dy,hd);
  // inputs here are already in game terms (after invert)
  const needP=clamp((wantPitch+0.1)/0.78,-1,1);
  const needT=clamp(angDiff(wantYaw,G.yaw)*2*Math.max(G.speed,30)/look/1.6,-1,1);
  // not leaning into a real bend or dip
  const under=(inp,need)=>Math.abs(need)>0.15&&inp*Math.sign(need)<Math.abs(need)*GL.lean;
  const miss=Math.max(Math.hypot(G.pitchIn-needP,G.turnIn-needT),under(G.pitchIn,needP)||under(G.turnIn,needT)?GL.win*2:0);
  const near=1-smoothstep(70,140,G.lineOff);
  // Ways to count as "right enough": (1) your tilt matches what the line needs; (2) you are already on it and
  // pointing along it (being on route is the proof, owner: "if the player is doing right enough control, the glide is
  // smooth and on route") unless you keep ignoring a real bend or dip (a moment's lapse does not count: the recordings
  // showed the help blinking off and on twice a second on the coaster); (3) far off, you are steering back toward it
  // the right way round with a real tilt; (4) you are flying back toward the line, whatever your tilt says. In the
  // recordings the owner dived straight at the line; the old rule read that as "wrong tilt" (the line ahead needed a
  // climb by then) and dropped all help just as they arrived, so they shot through it and had to start again.
  const tilt=(1-smoothstep(GL.win,GL.win*2,miss));
  const ignoring=under(G.pitchIn,needP)||under(G.turnIn,needT);G.ign+=((ignoring?1:0)-G.ign)*(1-Math.exp(-dt*(ignoring?3:8)));
  const onRoute=(1-smoothstep(0.3,0.75,G.ign))*(1-smoothstep(5,12,G.lineOff))*(1-smoothstep(0.15,0.35,Math.abs(angDiff(wantYaw,G.yaw))));
  const nm=Math.hypot(needP,needT),im=Math.hypot(G.pitchIn,G.turnIn),cosv=nm>0.01&&im>0.01?(G.pitchIn*needP+G.turnIn*needT)/(nm*im):0;
  const back=nm>0.45?0.6*smoothstep(0.5,0.85,cosv)*smoothstep(0.15,0.4,im):0;
  const closing=GL.close*smoothstep(0.06,0.2,G.offV/Math.max(G.speed,40))*smoothstep(2,8,G.lineOff);
  const want=Math.max(tilt,onRoute,back,closing)*near*(G.crashT>0?0:1);
  G.lock+=(want-G.lock)*(1-Math.exp(-dt*(want>G.lock?10-6*smoothstep(4,15,G.lineOff):4)));
  G.onLine=G.lock*(1-smoothstep(6,25,G.lineOff));G.miss=miss;G.needP=needP;G.needT=needT;
  // The help itself never switches: its strength follows the lock over ~0.25 s, and each nudge is eased, so nothing
  // the line does to the glider can arrive as a kick (recordings: 14 degrees of extra pitch appeared within 0.1 s).
  // Tilt controls (phone, camera) show every change of the help at once, so they get the full easing. Keys and mouse
  // already move the glider with ~0.3 s of weight, which smooths the help by itself; more delay on top made a
  // keyboard pilot weave in the race canyon (test/full-check.cjs), so they keep the quick response.
  const soft=G.direct;
  G.help+=(G.lock-G.help)*(1-Math.exp(-dt*(soft?4.5:14)));
  // the nudges: added on top of your tilt, based on where you are, so every change of tilt still shows in full.
  // From further off they aim at a point on the line further ahead (4 m along per metre off: never steeper than ~14
  // degrees), so you merge in on a natural curve rather than being yanked straight at it.
  const L=clamp(Math.max(look,G.lineOff*4),30,400);routePoint(Math.min(LEN,G.s+L),_gr);
  const mYaw=Math.atan2(-(_gr.x-G.pos.x),-(_gr.z-G.pos.z)),ke=1-Math.exp(-dt*(soft?9:40));
  // eased, and never changing faster than a calm hand would tilt
  const ease=(cur,to,maxRate)=>soft?cur+clamp((to-cur)*ke,-maxRate*dt,maxRate*dt):cur+(to-cur)*ke;
  G.helpYaw=ease(G.helpYaw,G.help*GL.yawK*clamp(angDiff(mYaw,G.yaw),-0.5,0.5),1.6);
  // Up and down: the extra pitch is what closes the height gap in about pitchT seconds at your speed, and it fades
  // out when you are already closing that fast yourself (it used to pile a full extra dive on top of your own). When
  // you come in faster than the gap allows, it rounds your arrival off instead (the flare), so you level out onto the
  // line rather than through it.
  {const v=Math.max(G.speed,40),ae=Math.abs(dyNow),sg=Math.sign(dyNow)||1,cV=-sg*G.eV;
   const gentle=Math.max(Math.min(ae/GL.pitchT,0.25*v),3);
   const pos=sg*Math.min(ae/(GL.pitchT*v),0.25)*clamp(1-cV/gentle,0,1);
   const flare=-sg*Math.min(GL.flare*Math.max(0,cV-ae/0.7-3)/v,GL.flareMax);
   G.helpPitch=ease(G.helpPitch,G.help*(pos+flare),0.9);}
}
// and draws you onto it sideways and up/down, never along it
const _pv=new THREE.Vector3();
function linePull(dt){
  // never faster than pullMax metres a second, so from further off it is a gentle drift in, never a yank; and the
  // drift itself builds up and dies away over ~0.1 s (it used to flip direction in one frame as you crossed the line)
  const GL=GUIDE[guideLevel()];
  locate();routePoint(G.s,_gq);frame(G.s);_gq.sub(G.pos);const along=_gq.dot(_t);_gq.addScaledVector(_t,-along);
  // softer up/down, so a climb or dive you make still shows
  _gq.y*=0.5;_gq.multiplyScalar(GL.pull*G.help);const m=_gq.length(),mx=GL.pullMax*G.help;if(m>mx)_gq.multiplyScalar(mx/m);
  _pv.copy(G.pullV).lerp(_gq,1-Math.exp(-dt*(G.direct?10:30)));G.pullV.copy(_pv);G.pos.addScaledVector(G.pullV,dt);}

function update(dt){
  const isTut=G.mode==='tut';G.time+=dt;
  if(G.rescueT>0){G.rescueT-=dt;if(G.rescueT<=0)finishRescue();return;}
  if(G.crashT>0){G.crashT-=dt;if(G.crashT<=0){placeAt(Math.max(30,G.s-50),46);G.speed=62;G.invuln=1.6;updateCamera(0,true);}return;}   // camera jumps with you, no swing across the canyon
  // Tilt controls (phone, camera) are position controls: the glider should match your hand at once, so they skip the
  // "heavy plane" easing that gives keys and mouse their weight. Phone: ~30 ms (the screen already predicts past the delay
  // and filters tremor, link.js; faster let hand shake through); camera: ~70 ms (hand tracking is noisier); keys ~300 ms.
  const direct=settings.control==='phone'||settings.control==='camera',ph=settings.control==='phone',kA=direct?30:10,kP=ph?35:direct?14:3.2,kR=ph?35:direct?14:4.2;G.direct=direct;
  const inp=readInput(dt);G.armL+=(inp.L-G.armL)*(1-Math.exp(-dt*kA));G.armR+=(inp.R-G.armR)*(1-Math.exp(-dt*kA));
  let pitchIn=(inp.L+inp.R)/2;if(settings.invert)pitchIn=-pitchIn;let turnIn=(inp.L-inp.R)/2;
  if(G.bot){if(G.bot==='follow'){pitchIn=G.needP||0;turnIn=G.needT||0;}else{pitchIn=G.bot.p;turnIn=G.bot.t;}}   // test hook (?debug): a scripted pilot
  G.pitchIn=pitchIn;G.turnIn=turnIn;
  // where is the line?
  streamPoint(G.s,_sp);const streamD=SD;routePoint(G.s,_sp);const streamOff=_sp.distanceTo(G.pos);
  const fy=floorY(G.s),hRel=G.pos.y-fy;
  guide(dt);
  G.inStream=G.onLine>0.5;frame(G.s);
  let tgt=pitchIn*0.78-0.1+G.helpPitch;
  if(G.speed<34)tgt-=(34-G.speed)*0.025;
  if(hRel>200)tgt-=(hRel-200)*0.012;
  tgt-=Math.abs(Math.sin(G.roll))*0.1;tgt=clamp(tgt,-1.1,0.85);const prevPitch=G.pitch;G.pitch+=(tgt-G.pitch)*(direct?1-Math.exp(-dt*kP):Math.min(1,dt*kP));
  G.pitchRate+=((G.pitch-prevPitch)/Math.max(dt,1e-3)-G.pitchRate)*Math.min(1,dt*6);
  const tyaw=trackYaw();let yawRate=turnIn*1.6+G.helpYaw;
  const assist=Math.abs(turnIn)<0.08?0.35:0.08;yawRate+=angDiff(tyaw-(G.d-streamD)*0.006,G.yaw)*assist;
  if(Math.abs(G.d)>125)yawRate+=angDiff(tyaw-Math.sign(G.d)*0.6,G.yaw)*1.2;
  // Coordinated turn: you bank first, and the bank is what curves your path (tighter at low speed, wider at high speed).
  {const v=Math.max(G.speed,25);const tgtRoll=clamp(Math.atan(yawRate*v/95),-1.15,1.15);G.roll+=(tgtRoll-G.roll)*(direct?1-Math.exp(-dt*kR):Math.min(1,dt*kR));
   const yr=clamp(95*Math.tan(G.roll)/v,-2.6,2.6);G.yaw+=yr*dt;G.yawRate+=(yr-G.yawRate)*Math.min(1,dt*6);}
  let acc=-30*Math.sin(G.pitch)-0.00058*G.speed*G.speed+1.2-Math.abs(Math.sin(G.roll))*2;
  const clear=G.pos.y-groundAt(G.s,G.d);G.skim=clear>0&&clear<7.5;
  if(G.skim){acc+=6;G.score+=28*dt*multiplier();}
  if(G.inStream){acc+=5;G.score+=6*dt;}
  acc-=4*(1-G.lock)*smoothstep(12,40,G.lineOff);   // drifting off the line costs speed
  if(G.boostT>0){G.boostT-=dt;acc+=42;}
  if(SKY)acc+=4;   // a steady tailwind: the Skyway is nearly level, the canyons get their speed from the descent
  const gu=gustAt(G.pos.x,G.pos.z,timeU.value);G.gust=gu;acc+=gu*3;G.roll+=Math.sin(timeU.value*9)*gu*0.03;
  G.speed=clamp(G.speed+acc*dt,isTut?40:20,G.boostT>0?178:160);
  if(TRACK==='coaster'&&G.inStream)G.speed=Math.max(G.speed,64);
  if(G.speed<34&&G.time-(G._stall||-9)>4){G._stall=G.time;toast('Too slow, dive to pick up speed','bad');buzz(40);}
  dir.set(-Math.sin(G.yaw)*Math.cos(G.pitch),Math.sin(G.pitch),-Math.cos(G.yaw)*Math.cos(G.pitch));
  G.flow+=(1+LINE_SPEED*G.onLine-G.flow)*(1-Math.exp(-dt*2));
  G.pos.addScaledVector(dir,G.speed*G.flow*dt);linePull(dt);frame(G.s);G.pos.addScaledVector(_r,Math.sin(timeU.value*0.4)*gu*2.5*dt);updraft(dt);locate();
  // collisions
  if(G.invuln>0)G.invuln-=dt;if(G.bumpT>0)G.bumpT-=dt;
  const gy=groundAt(G.s,G.d);
  if(G.pos.y<gy+1.1){if(isTut||G.invuln>0){G.pos.y=gy+1.3;if(isTut)softBump();}else{crash();return;}}
  for(const p of pillars){if(Math.abs(p.s-G.s)>25)continue;const dx=G.pos.x-p.x,dz=G.pos.z-p.z,rr2=(p.r+1)*(p.r+1);
    if(dx*dx+dz*dz<rr2&&G.pos.y<p.top){if(isTut||G.invuln>0){const l=Math.sqrt(dx*dx+dz*dz)||1;G.pos.x=p.x+dx/l*(p.r+1.2);G.pos.z=p.z+dz/l*(p.r+1.2);if(isTut)softBump();}else{crash();return;}}}
  for(const a of arches){if(Math.abs(a.s-G.s)>9.5)continue;const ah=G.pos.y-(floorY(a.s)+a.hc),dist=Math.hypot(G.d,ah);
    if(Math.abs(dist-a.r)<10.5){if(isTut||G.invuln>0){G.pos.y+=dist<a.r?-1.5:1.5;if(isTut)softBump();}else{crash();return;}}}
  {if(G.s>G.progS+35){G.progS=G.s;G.progT=0;}else G.progT+=dt;const hd=Math.abs(angDiff(G.yaw,tyaw));const oob=streamOff>42||hRel>175||hd>1.4||G.progT>4;G.oobT=oob?G.oobT+dt:Math.max(0,G.oobT-dt*0.5);if(G.oobT>=12){G.oobT=0;startRescue();return;}}
  collectGems(isTut?tutGems:gems,dt);collectRings(isTut?tutRings:rings);
  if(G.comboT>0){G.comboT-=dt;if(G.comboT<=0)G.combo=0;}
  if(RACE)checkGates();
  if(isTut)tutUpdate(dt);else if(G.s>=FINISH_S)(RACE?raceFinish():finish());
}

/* ================= navigator ================= */
let arrowOp=0;const _at=new THREE.Vector3(),_ad=new THREE.Vector3();
function updateNavigator(dt,now){
  let want=0;const playing=G.state==='play'&&G.crashT<=0;
  if(playing){const list=G.mode==='tut'?tutRings:rings;let ring=null;
    if(RACE){const g=gates[G.gi];if(g&&g.s<G.s+170)ring=g;}else for(const r of list){if(r.got||!r.mesh.visible)continue;if(r.s>G.s+3&&r.s<G.s+170){if(!ring||r.s<ring.s)ring=r;}}
    if(ring){_at.copy(ring.pos);_ad.subVectors(_at,G.pos).normalize();const ang=Math.acos(clamp(_ad.dot(dir),-1,1));want=ang>0.1?0.85:0.35;}
    else{streamPoint(G.s,_sp);const off=_sp.distanceTo(G.pos);if(off>14){streamPoint(G.s+60,_at);want=clamp((off-14)/20,0.3,0.85);}}}
  arrowOp+=(want-arrowOp)*Math.min(1,dt*6);
  arrow.material.opacity=arrowOp*(0.75+0.25*Math.sin(now*6));arrow.visible=arrowOp>0.02;
  if(arrow.visible&&want>0){arrow.position.copy(G.pos).addScaledVector(dir,8.5);arrow.position.y+=1.8;arrow.lookAt(_at);}
}

/* ================= tutorial ================= */
const tut={i:0,hold:0,acc:0,rings:0,gems:0,delay:0,active:false,boosted:false};
const touchSides=()=>{const s=new Set();for(const o of touches.values())s.add(o.side);return s;};
function hold(cond,need,dt){if(cond)tut.hold+=dt;else tut.hold=Math.max(0,tut.hold-dt*1.5);return tut.hold/need;}
function spawnTutRings(){tutRings.forEach((r,k)=>setRing(r,Math.min(G.s+150+k*120,LEN-300)));}
function spawnTutGems(from){let k=0;for(const g of tutGems){if(g.got===false&&g.s>G.s)continue;const s=Math.min(from+k*13,LEN-300);streamAt(s);
  const d=SD+6*Math.sin(k*0.7),h=Math.max(SH+3*Math.cos(k*0.5),relH(s,d)+5);g.s=s;worldAt(s,d,h,g.base);g.cur.copy(g.base);g.got=false;g.pull=0;k++;}}
const DEV={keys:'Keyboard',simple:'Keyboard',mouse:'Mouse',two:'Phone',one:'Phone',hand:'Camera',phone:'Phone glider'};
const STEPS=[
  {title:'Get a grip',zone:['c','c'],ghost:['c','c'],
    text:{two:'Rest one thumb on each half of the screen and keep them there. Each thumb is one of your arms.',one:'Rest your thumb anywhere on the screen. You steer by dragging it.',
      keys:'Your left arm is W / S and your right arm is ↑ / ↓. Rest your fingers on them.',mouse:'Press and hold the mouse button anywhere on the view. You steer by dragging.'},
    alt:{two:'a thumb on each half',one:'one thumb anywhere',keys:'fingers on W/S and ↑/↓',mouse:'press and hold, then drag'},
    check:dt=>{const m=ctlMode();if(m==='hand'||m==='phone')return hold(remote.active,0.7,dt);if(m==='two'){const s=touchSides();return hold((s.has('L')&&s.has('R'))||(remote.active&&remote.tl&&remote.tr),0.7,dt);}if(m==='one')return hold(touchSides().has('O')||(remote.active&&(remote.tl||remote.tr)),0.7,dt);if(m==='mouse')return hold(!!mouse,0.7,dt);return hold(true,2.4,dt);}},
  {title:'Dive',zone:['u','u'],ghost:['u','u'],
    text:{two:'Slide both thumbs up. Your arms tuck back and you pick up speed.',one:'Drag your thumb up. You tip forward and speed up.',keys:'Hold W and ↑ together. Your arms tuck back and you speed up.',mouse:'Drag the mouse up. You tip forward and speed up.'},
    alt:{two:'both thumbs up',one:'drag thumb up',keys:'W + ↑',mouse:'drag up'},check:dt=>hold(G.pitchIn<-0.4,1.0,dt)},
  {title:'Climb',zone:['d','d'],ghost:['d','d'],
    text:{two:'Slide both thumbs down. Your arms sweep forward and you rise, trading speed for height.',one:'Drag your thumb down. You rise, trading speed for height.',keys:'Hold S and ↓ together. You rise, trading speed for height.',mouse:'Drag the mouse down. You rise, trading speed for height.'},
    alt:{two:'both thumbs down',one:'drag thumb down',keys:'S + ↓',mouse:'drag down'},check:dt=>hold(G.pitchIn>0.4,1.0,dt)},
  {title:'Settle into a glide',zone:['c','c'],ghost:['c','c'],
    text:{two:'Bring both thumbs back to where they started. The suit levels out by itself.',one:'Bring your thumb back to where it started. The suit levels out by itself.',keys:'Let go of the keys. The suit levels out by itself.',mouse:'Bring the mouse back to where you pressed, or let go. The suit levels out by itself.'},
    alt:{two:'thumbs back to start',one:'thumb back to start',keys:'let go of the keys',mouse:'recentre or let go'},check:dt=>hold(Math.abs(G.pitchIn)<0.15&&Math.abs(G.turnIn)<0.15,1.4,dt)},
  {title:'Turn left',zone:['d','u'],ghost:['d','u'],
    text:{two:'Left thumb down, right thumb up. You lean and curve left.',one:'Drag your thumb to the left. You lean and curve left.',keys:'Hold S and ↑ together, or just A. You lean and curve left.',mouse:'Drag the mouse to the left. You lean and curve left.'},
    alt:{two:'left thumb down, right up',one:'drag thumb left',keys:'S + ↑, or A',mouse:'drag left'},check:dt=>hold(G.turnIn>0.38,0.9,dt)},
  {title:'Turn right',zone:['u','d'],ghost:['u','d'],
    text:{two:'Right thumb down, left thumb up. You lean and curve right.',one:'Drag your thumb to the right.',keys:'Hold W and ↓ together, or just D.',mouse:'Drag the mouse to the right.'},
    alt:{two:'right thumb down, left up',one:'drag thumb right',keys:'W + ↓, or D',mouse:'drag right'},check:dt=>hold(G.turnIn<-0.38,0.9,dt)},
  {title:'Ride the line',zone:['n','n'],ghost:['c','c'],
    text:{all:'The glowing ribbon is the line through the gorge. Get onto it and roughly match its bends and dips: it turns gold, carries you along and you fly faster. Stay on it for 3 seconds.'},
    check:dt=>{if(G.inStream)tut.acc+=dt;return tut.acc/3;}},
  {title:'Thread the rings',zone:['n','n'],ghost:['c','c'],enter:()=>{tut.rings=0;spawnTutRings();},
    text:{all:'Three gold rings ahead. If you drift off line, the arrow shows where to go.'},
    check:dt=>{tutRings.forEach((r,k)=>{if(!r.got&&G.s>r.s+12&&tut.rings<3){setRing(r,Math.min(G.s+160+k*40,LEN-300));toast('Missed one, another is coming','bad');}});return tut.rings/3;}},
  {title:'Gather gems',zone:['n','n'],ghost:['c','c'],enter:()=>{tut.gems=0;tutGems.forEach(g=>g.got=true);spawnTutGems(G.s+110);},
    text:{all:'Gems drift toward you when you fly close. Collect 8 of them.'},
    check:dt=>{if(tut.gems<8&&tutGems.every(g=>g.got||g.s<G.s-15)){tutGems.forEach(g=>{if(!g.got)g.got=true;});spawnTutGems(G.s+110);}return tut.gems/8;}},
  {title:'Boost',zone:['n','n'],ghost:['c','c'],enter:()=>{G.boost=Math.max(G.boost,0.4);tut.boosted=false;},
    text:{two:'Double-tap anywhere to fire your pack. Gold rings refill the boost meter.',one:'Double-tap anywhere to fire your pack. Gold rings refill the boost meter.',keys:'Press Space to fire your pack. Gold rings refill the boost meter.',mouse:'Double-click anywhere on the view to fire your pack. Gold rings refill the boost meter.'},
    alt:{two:'double-tap',one:'double-tap',keys:'Space',mouse:'double-click'},check:dt=>{if(G.boostT>0)tut.boosted=true;return tut.boosted?1:0;}},
];
// the same lessons, worded for the simple keys and for camera control
[['Arrow keys steer the whole suit. Rest your fingers on them.','fingers on the arrow keys','Hold one hand out toward the screen, flat, palm down, fingertips pointing at the camera. Your hand is the glider.','a flat hand in view'],
 ['Hold ↓. You tip forward and pick up speed.','hold ↓','Tip your fingertips down. You tip forward and pick up speed.','fingertips down'],
 ['Hold ↑. You rise, trading speed for height.','hold ↑','Raise your fingertips. You rise, trading speed for height.','fingertips up'],
 ['Let go of the keys. The suit levels out by itself.','let go of the keys','Bring your hand back to flat. The suit levels out by itself.','hand flat'],
 ['Hold ←. You lean and curve left.','hold ←','Tilt your hand to the left, like a plane banking. You lean and curve left.','tilt hand left'],
 ['Hold →. You lean and curve right.','hold →','Tilt your hand to the right. You lean and curve right.','tilt hand right'],
 null,null,null,
 ['Press Space to fire your pack. Gold rings refill the boost meter.','Space','Close your hand into a fist, then open it again, to fire your pack. Gold rings refill the boost meter.','close a fist']
].forEach((x,i)=>{if(!x)return;const st=STEPS[i];st.text.simple=x[0];st.alt.simple=x[1];st.text.hand=x[2];st.alt.hand=x[3];});
[['Hold your phone flat on your palm, screen up, top edge pointing at this screen. The phone is the glider.','phone held flat'],
 ['Tip the nose of the phone down. You tip forward and pick up speed.','nose down'],['Lift the nose of the phone. You rise, trading speed for height.','nose up'],
 ['Bring the phone back to flat. The suit levels out by itself.','phone flat'],['Roll the phone to the left, like a plane banking. You lean and curve left.','roll left'],
 ['Roll the phone to the right. You lean and curve right.','roll right'],null,null,null,['Tap the phone screen to fire your pack. Gold rings refill the boost meter.','tap the phone']
].forEach((x,i)=>{if(!x)return;STEPS[i].text.phone=x[0];STEPS[i].alt.phone=x[1];});
[['Hold one hand up facing the camera, open palm, like a wave hello. Your hand is the control stick.','open palm up','Hold your object up in front of the camera, the way you set it up.','object in view'],
 ['Lower your hand a little. You tip forward and pick up speed.','hand lower','Lower your object. You tip forward and pick up speed.','object lower'],
 ['Raise your hand. You rise, trading speed for height.','hand higher','Raise your object. You rise, trading speed for height.','object higher'],
 ['Bring your hand back to where it started, upright. The suit levels out by itself.','hand back to level','Bring your object back to where it started. The suit levels out by itself.','object back to level'],
 ['Tilt your hand to the left, like turning a steering wheel. You lean and curve left.','tilt hand left','Tilt your object to the left. You lean and curve left.','tilt left'],
 ['Tilt your hand to the right. You lean and curve right.','tilt hand right','Tilt your object to the right. You lean and curve right.','tilt right'],
 null,null,null,
 ['Close your hand into a fist, then open it again, to fire your pack. Gold rings refill the boost meter.','close a fist','Push your object quickly toward the camera to fire your pack. Gold rings refill the boost meter.','push toward camera']
].forEach((x,i)=>{if(!x)return;const st=STEPS[i];st.text.palm=x[0];st.alt.palm=x[1];st.text.object=x[2];st.alt.object=x[3];});
const tutKey=()=>{const m=ctlMode();return m==='hand'&&hand.mode!=='hand'?hand.mode:m;};
function tutText(st){const m=tutKey();return st.text.all||st.text[m]||st.text.two;}
function tutAlt(st){if(!st.alt)return '';const m=ctlMode();const isPhone=m==='two'||m==='one';
  const others=(isTouch?[settings.mode]:[settings.control==='arms'?'keys':'simple','mouse']).concat(hand.enabled?['hand']:[]).concat(phone.status==='connected'?['phone']:[]).filter(k=>k!==m&&!(isPhone&&(k==='two'||k==='one')));if(!others.length)return '';
  return 'Also: '+others.map(k=>DEV[k]+' · '+st.alt[k==='hand'&&hand.mode!=='hand'?hand.mode:k]).join('   |   ');}
function setPad(pad,zone,ghost){const z=pad.querySelector('.zone'),g=pad.querySelector('.ghost');
  const flip=c=>settings.invert&&(c==='u'||c==='d')?(c==='u'?'d':'u'):c;z.className='zone '+flip(zone);g.className='ghost '+flip(ghost);}
function padKeys(){const m=ctlMode(),arm=m==='mouse'||m==='simple'||m==='hand'||m==='phone';$('padLk').textContent=m==='keys'?'W / S':arm?'LEFT ARM':'LEFT';$('padRk').textContent=m==='keys'?'↑ / ↓':arm?'RIGHT ARM':'RIGHT';}
function tutRefresh(){const st=STEPS[tut.i];$('cBody').textContent=tutText(st);const a=tutAlt(st);$('cAlt').textContent=a;$('cAlt').hidden=!a;padKeys();}
function tutEnter(i){tut.i=i;tut.hold=0;tut.acc=0;tut.delay=0;const st=STEPS[i];if(st.enter)st.enter();
  $('cStep').textContent='Lesson '+(i+1)+' of '+STEPS.length;$('cTitle').textContent=st.title;$('cFill').style.width='0%';
  setPad($('padL'),st.zone[0],st.ghost[0]);setPad($('padR'),st.zone[1],st.ghost[1]);tutRefresh();}
function tutUpdate(dt){
  if(G.s>LEN-700){placeAt(30,48);const st=STEPS[tut.i];if(st.enter)st.enter();}
  if(tut.delay>0){tut.delay-=dt;if(tut.delay<=0){if(tut.i+1<STEPS.length)tutEnter(tut.i+1);else tutFinish();}return;}
  const p=clamp(STEPS[tut.i].check(dt),0,1);$('cFill').style.width=(p*100).toFixed(0)+'%';
  if(p>=1){tut.delay=0.8;toast(['Nice','Got it','Smooth','Lovely'][tut.i%4],'good');tone(660,0.15,'sine',0.07);setTimeout(()=>tone(990,0.25,'sine',0.07),110);buzz(15);}
}
function tutPads(){const L=$('padL').querySelector('.live'),R=$('padR').querySelector('.live');const px=$('padL').clientHeight*0.33;
  L.style.transform='translateY('+(G.armL*px).toFixed(1)+'px)';R.style.transform='translateY('+(G.armR*px).toFixed(1)+'px)';}
function tutFinish(){store.set('tutDone',true);G.state='tutdone';$('coach').hidden=true;$('hud').hidden=true;showOnly('tutDone');updateTutBadge();
  tone(523,0.2,'triangle',0.08);setTimeout(()=>tone(659,0.2,'triangle',0.08),120);setTimeout(()=>tone(784,0.4,'triangle',0.08),240);}
$('cSkip').onclick=()=>{if(G.mode!=='tut')return;if(tut.i+1<STEPS.length)tutEnter(tut.i+1);else tutFinish();};

/* ================= camera ================= */
const SKYVIEW=new URLSearchParams(location.search).get('view')==='sky';   // ?view=sky: menu camera high above the gorge, for checking scenery
if(SKYVIEW){scene.fog.near=1500;scene.fog.far=7000;}
const camPos=new THREE.Vector3(),camLook=new THREE.Vector3(),back=new THREE.Vector3(),CUP=new THREE.Vector3(0,4.2,0);
function updateCamera(dt,snap){
  if(G.state==='menu'){G.menuS=(G.menuS+24*dt)%(LEN-400);streamPoint(G.menuS,camPos);camPos.y+=SKYVIEW?900:22;streamPoint(G.menuS+(SKYVIEW?900:80),camLook);
    camera.position.lerp(camPos,snap?1:Math.min(1,dt*2));camera.lookAt(camLook);camera.fov=62;camera.updateProjectionMatrix();return;}
  if(settings.view==='fp'){camPos.copy(G.pos).addScaledVector(dir,0.8);camPos.y+=0.65;const gy0=groundAt(G.s,G.d)+1.2;if(camPos.y<gy0)camPos.y=gy0;
    camera.position.lerp(camPos,snap?1:1-Math.exp(-dt*22));camLook.copy(G.pos).addScaledVector(dir,30);camera.lookAt(camLook);camera.rotateZ(G.roll*0.85);
    let sk=0;if(G.boostT>0)sk=0.05;if(G.crashT>0)sk=G.crashT*0.3;if(G.bumpT>0)sk=Math.max(sk,G.bumpT*0.2);sk=Math.max(sk,(G.gust||0)*0.04);
    if(sk){camera.position.x+=(Math.random()-0.5)*sk;camera.position.y+=(Math.random()-0.5)*sk;}
    const ff=clamp(CAM.fov+12+(G.speed-60)*0.15,CAM.fov+10,CAM.fov+34);camera.fov+=(ff-camera.fov)*Math.min(1,dt*3);camera.updateProjectionMatrix();return;}
  back.set(-Math.sin(G.yaw),Math.sin(G.pitch)*0.45,-Math.cos(G.yaw)).normalize();
  CUP.y=CAM.up;camPos.copy(G.pos).addScaledVector(back,-CAM.dist).add(CUP);const gy=groundAt(G.s,G.d)+3;if(camPos.y<gy)camPos.y=gy;
  camera.position.lerp(camPos,snap?1:1-Math.exp(-dt*(G.direct?11:6.5)));camLook.copy(G.pos).addScaledVector(dir,CAM.look);camera.lookAt(camLook);camera.rotateZ(G.roll*0.3);
  let shake=0;if(G.boostT>0)shake=0.08;if(G.crashT>0)shake=G.crashT*0.4;if(G.bumpT>0)shake=Math.max(shake,G.bumpT*0.25);shake=Math.max(shake,(G.gust||0)*0.06);
  if(shake){camera.position.x+=(Math.random()-0.5)*shake;camera.position.y+=(Math.random()-0.5)*shake;}
  const fov=clamp(CAM.fov+(G.speed-60)*0.13,CAM.fov-2,CAM.fov+20);camera.fov+=(fov-camera.fov)*Math.min(1,dt*3);camera.updateProjectionMatrix();
}

/* ================= per-frame visuals ================= */
const gm=new THREE.Matrix4(),gq=new THREE.Quaternion(),gs=new THREE.Vector3(),gp=new THREE.Vector3(),eul=new THREE.Euler();
function drawGems(list,mesh,now){for(let i=0;i<list.length;i++){const g=list[i];gs.setScalar(g.got?0:1+g.pull*0.3);
  if(g.pull>0)gp.copy(g.cur);else{gp.copy(g.base);gp.y+=Math.sin(now*2+g.phase)*0.5;}gq.setFromAxisAngle(UP,now*1.6+g.phase);gm.compose(gp,gq,gs);mesh.setMatrixAt(i,gm);}
  mesh.instanceMatrix.needsUpdate=true;}
function updateVisuals(dt,now){
  const isTut=G.mode==='tut'&&G.state!=='menu';
  gemMesh.visible=!isTut;tutGemMesh.visible=isTut;rings.forEach(r=>r.mesh.visible=!isTut);tutRings.forEach(r=>{r.mesh.visible=isTut&&r.s>0;});
  if(isTut)drawGems(tutGems,tutGemMesh,now);else drawGems(gems,gemMesh,now);
  const flying=G.state!=='menu';
  ribbonMat.uniforms.uS.value=flying?G.s:(G.menuS||0);{const u=ribbonMat.uniforms.uLock;u.value+=((flying?G.onLine:0.6)-u.value)*Math.min(1,dt*5);}
  updateSparks(dt,now,flying?G.s:(G.menuS||0),ribbonMat.uniforms.uLock.value);
  player.visible=flying&&settings.view!=='fp'&&!(G.crashT>0&&Math.floor(now*14)%2===0)&&!(G.invuln>0&&Math.floor(now*10)%2===0);
  player.position.copy(G.pos);eul.set(G.pitch,G.yaw,G.roll,'YXZ');rig.setRotationFromEuler(eul);
  {const fl=G.state==='play'&&G.speed<38?Math.sin(now*31)*0.18:0;updatePilot(G.armL+fl,G.armR-fl);}
  const flame=G.boostT>0?0.9+Math.random()*0.5:0.01;nozzles.forEach(f=>f.scale.set(1,flame,1));
  const strength=G.state==='play'&&G.crashT<=0?clamp((G.speed-40)/90,0.1,0.7):0;
  if(flying){updateTrail(trailL,tipL,strength);updateTrail(trailR,tipR,strength);}
  wispMesh.visible=flying;if(flying)updateWisps(dt,(G.state==='play'?clamp((G.speed-20)/80,0.18,0.55):0)*(settings.view==='fp'?0.45:1),now);
  updateLeaves(dt,now,G.state==='menu'?G.menuS:G.s);updateStrands(dt,now);updateMotes(dt);updateFlags(now);updateBirds(now);{const sN=G.state==='menu'?G.menuS:G.s;updateSmoke(dt,now,sN);updateFireflies(now,sN);updateButterflies(now,sN);}for(const c of cloudSprites){c.position.z-=2.2*dt;c.position.x+=Math.sin(now*0.05)*0.6*dt;}glare.position.copy(camera.position).addScaledVector(SUN,1800);
  updateNavigator(dt,now);
  streamMat.uniforms.uPlayer.value.copy(flying?G.pos:camera.position);
  if(skyWorld)skyWorld.update(dt,camera,flying?G.s:(G.menuS||0),{hemi:hemiLight,sun:sunLight});
  for(const g of gates)if(g.pulse&&g.state===0)g.mesh.scale.setScalar(gateR(g)/GATE_R);
  sky.position.copy(camera.position);sunLight.position.copy(camera.position).addScaledVector(SUN,400);sunLight.target.position.copy(camera.position);
  if(windGain&&actx){const v=(G.state==='play'&&!muted)?0.025+G.speed*0.00055:0;windGain.gain.setTargetAtTime(v,actx.currentTime,0.15);windFilter.frequency.setTargetAtTime(250+G.speed*9,actx.currentTime,0.2);}
}

/* ================= HUD ================= */
const fmtTime=t=>Math.floor(t/60)+':'+String(Math.floor(t%60)).padStart(2,'0');
const fmtRace=t=>Math.floor(t/60)+':'+(t%60).toFixed(1).padStart(4,'0');
function raceTime(){return G.raceT0?(performance.now()-G.raceT0)/1000:0;}
function myPlace(){if(G.solo||room.status!=='in')return null;let n=1,total=1;const mine=G.state==='end'?G.final:null;
  for(const p of room.players.values()){if(p.id===room.me.id)continue;if(!p.st&&!p.fin)continue;total++;
    if(p.fin){if(mine==null||p.fin.time<mine)n++;}else if(mine==null&&p.st&&p.st.s>G.s)n++;}
  return total>1?{n,total}:null;}
const ord=n=>n+(n%100>=11&&n%100<=13?'th':['th','st','nd','rd'][n%10]||'th');
function updateHUD(){
  if(RACE){$('score').textContent=fmtRace(raceTime()+G.pen);const pl=myPlace();$('mult').hidden=!pl;if(pl)$('mult').textContent=ord(pl.n)+' / '+pl.total;
    $('gemcount').textContent='Gate '+Math.min(G.gi+1,gates.length)+' / '+gates.length+(G.pen?' · +'+G.pen+' s':'');$('skim').hidden=!G.skim;$('curChip').hidden=!G.inStream;$('thermChip').hidden=!G.inThermal;
    {const ob=$('oob');if(G.oobT>3){ob.hidden=false;ob.innerHTML='Off course · back on course in <b>'+Math.ceil(12-G.oobT)+'s</b> · follow the arrow';}else ob.hidden=true;}
    $('prog').style.width=(G.s/FINISH_S*100).toFixed(1)+'%';$('dist').textContent=Math.max(0,Math.round(FINISH_S-G.s))+' m to finish';
    $('speed').textContent=Math.round(G.speed*G.flow*1.5);$('boostFill').style.width=(G.boost*100)+'%';const ready=G.boost>=0.33,bl=$('boostLbl');bl.classList.toggle('ready',ready);
    bl.textContent=G.boostT>0?'Boosting':ready?(isTouch?'Boost ready · double-tap':'Boost ready · Space'):'Boost';return;}
  $('score').textContent=Math.floor(G.score).toLocaleString();const m=multiplier();$('mult').textContent='x'+(m%1?m.toFixed(1):m);
  $('gemcount').textContent=G.gems+' / '+gems.length+' gems';$('skim').hidden=!G.skim;$('curChip').hidden=!G.inStream;$('thermChip').hidden=!G.inThermal;
  {const ob=$('oob');if(G.oobT>3){ob.hidden=false;ob.innerHTML='Off course · back on the line in <b>'+Math.ceil(12-G.oobT)+'s</b> · follow the arrow';}else ob.hidden=true;}
  $('prog').style.width=(G.s/FINISH_S*100).toFixed(1)+'%';$('dist').textContent=Math.max(0,Math.round(FINISH_S-G.s))+' m to gate';
  $('speed').textContent=Math.round(G.speed*G.flow*1.5);$('boostFill').style.width=(G.boost*100)+'%';
  const ready=G.boost>=0.33,bl=$('boostLbl');bl.classList.toggle('ready',ready);
  bl.textContent=G.boostT>0?'Boosting':ready?(isTouch?'Boost ready · double-tap':'Boost ready · Space'):'Boost';
}

document.documentElement.classList.toggle('touch',isTouch);
const remote={active:false,L:0,R:0,tl:false,tr:false,mode:'two'};

/* ================= flow ================= */
function showOnly(id){for(const o of ['startScreen','pauseScreen','endScreen','tutDone','raceLobby','raceEnd'])$(o).hidden=o!==id;}
function syncSettingsUI(){$('fppBox').checked=settings.view==='fp';$('viewBtn').textContent=settings.view==='fp'?'3RD':'FPP';$('viewBtn').setAttribute('aria-label',settings.view==='fp'?'Switch to third-person view':'Switch to first-person view');
  for(const b of document.querySelectorAll('.trackcard'))b.setAttribute('aria-pressed',String(b.dataset.track===TRACK));$('trackEyebrow').textContent=TRACK_NAME[TRACK];$('trackName').textContent=TRACK_NAME[TRACK];$('curChip').textContent=TRACK==='coaster'?'ON THE RAIL':'ON THE LINE';$('invertPitch').checked=$('invertPitch2').checked=settings.invert;$('sens').value=$('sens2').value=settings.sens;
  for(const b of $('modeSeg').querySelectorAll('button'))b.setAttribute('aria-pressed',String(b.dataset.mode===settings.mode));
  for(const id of ['guideSeg','guideSeg2'])for(const b of $(id).querySelectorAll('button'))b.setAttribute('aria-pressed',String(b.dataset.guide===settings.guide));
  
  $('ctlNote').textContent=settings.mode==='two'?'Phone: two thumbs, each one moves an arm. Most control.':'Phone: one thumb, drag up, down and sideways. Easiest to pick up.';}
for(const id of ['invertPitch','invertPitch2'])$(id).addEventListener('change',e=>{settings.invert=e.target.checked;store.set('invert',settings.invert);syncSettingsUI();});
for(const id of ['sens','sens2'])$(id).addEventListener('input',e=>{settings.sens=parseFloat(e.target.value);store.set('sens',settings.sens);syncSettingsUI();});
$('recBox').checked=recorder.on;$('recBox').onchange=e=>setRecording(e.target.checked);
for(const id of ['guideSeg','guideSeg2'])for(const b of $(id).querySelectorAll('button'))b.onclick=()=>{settings.guide=b.dataset.guide;store.set('guide',settings.guide);syncSettingsUI();shareLevel();};
for(const b of $('modeSeg').querySelectorAll('button'))b.onclick=()=>{settings.mode=b.dataset.mode;store.set('mode',settings.mode);touches.clear();syncSettingsUI();};
function updateTutBadge(){const done=store.get('tutDone',false);$('tutBadge').hidden=done;$('tutBtn').classList.toggle('primary',!done);$('startBtn').classList.toggle('primary',done);}
function setView(v){settings.view=v;store.set('view',v);syncSettingsUI();toast(v==='fp'?'First-person view':'Third-person view','good');}
$('viewBtn').onclick=()=>setView(settings.view==='fp'?'3p':'fp');
$('fppBox').addEventListener('change',e=>{settings.view=e.target.checked?'fp':'3p';store.set('view',settings.view);syncSettingsUI();});
for(const b of document.querySelectorAll('.trackcard'))b.onclick=()=>{if(G.state!=='menu'||TRACK===b.dataset.track)return;
  if(b.dataset.track==='race'||b.dataset.track==='sky'||RACE){store.set('track',b.dataset.track);const u=new URL(location.href);u.searchParams.delete('room');location.href=u.toString();return;}   // the race canyon is a different world: reload into it
  TRACK=b.dataset.track;store.set('track',TRACK);buildTrack();best=store.get(bestKey(),0);syncSettingsUI();};
window.addEventListener('keydown',e=>{if(e.repeat)return;if(e.key==='v'||e.key==='V'){setView(settings.view==='fp'?'3p':'fp');}});
syncSettingsUI();updateTutBadge();

function resetRun(){Object.assign(G,{state:'play',score:0,combo:0,comboT:0,gems:0,rings:0,crashes:0,boost:0.34,boostT:0,crashT:0,invuln:1,time:0,speed:72,bumpT:0,armL:0,armR:0,yawRate:0,pitchRate:0,gust:0,oobT:0,rescueT:0,inThermal:false,progS:30,progT:0,lock:0,onLine:0,flow:1,lineOff:0,helpYaw:0,helpPitch:0,help:0,ign:0,offV:0,eV:0,offP:NaN});G.pullV.set(0,0,0);thermals.forEach(t=>t.hit=false);$('fadeB').classList.remove('on');
  placeAt(30,48);updateCamera(0,true);startRecording();}
function goFull(){if(!isTouch)return;try{const el=document.documentElement;if(el.requestFullscreen&&!document.fullscreenElement)el.requestFullscreen().then(()=>{try{screen.orientation.lock('landscape').catch(()=>{});}catch(e){}}).catch(()=>{});}catch(e){}}
// flight recorder: what the flight was, for the review (recorder.js)
function flightMeta(){return {track:TRACK,mode:G.mode,control:settings.control,guide:guideLevel(),invert:settings.invert,sens:settings.sens,view:settings.view,
  fx:post?post.level:-1,phone:settings.control==='phone'?phoneCheck():'',race:RACE?{solo:!!G.solo,players:room.players.size}:null};}
function startRecording(){if(G._rec)endRecording('restarted');recStart(flightMeta());G._rec=true;}
function endRecording(result){if(!G._rec)return;G._rec=false;const extra={score:Math.floor(G.score),gems:G.gems,rings:G.rings,crashes:G.crashes,distance:Math.round(G.s),finalTime:G.final||0,pen:G.pen||0,phoneEnd:settings.control==='phone'?phoneCheck():''};
  recEnd(result,extra).then(st=>{if(st==='sent')toast('Flight sent for review','good');else if(st)logIssue('Flight recorder','Could not send this flight for review: '+st+'.');});}
function start(){if(RACE){openLobby();return;}if(needCam())return;initAudio();if(actx&&actx.state==='suspended')actx.resume().catch(()=>{});G.mode='main';resetRun();
  for(const g of gems){g.got=false;g.pull=0;}for(const r of rings)setRing(r,r.s);
  showOnly(null);$('coach').hidden=true;$('hud').hidden=false;$('hud').classList.remove('tut');canvas.focus();goFull();}
function startTutorial(){if(needCam())return;initAudio();if(actx&&actx.state==='suspended')actx.resume().catch(()=>{});G.mode='tut';resetRun();
  tutGems.forEach(g=>{g.got=true;g.s=-999;});tutRings.forEach(r=>{r.got=true;r.s=-999;});
  showOnly(null);$('hud').hidden=false;$('hud').classList.add('tut');$('coach').hidden=false;tutEnter(0);canvas.focus();goFull();}
function toMenu(){endRecording('quit');G.state='menu';G.mode='main';$('count').hidden=true;$('hud').hidden=true;$('coach').hidden=true;showOnly('startScreen');updateTutBadge();}
function pause(){if(G.state!=='play')return;G.state='paused';showOnly('pauseScreen');}
function resume(){if(G.state!=='paused')return;if(!G._rec){recStart({...flightMeta(),continued:true});G._rec=true;}   // the page was hidden: carry on recording as a new part
  $('pauseNote').textContent='';lostSince=0;padLostSince=0;G.state='play';showOnly(null);canvas.focus();}
function finish(){G.state='end';endRecording('finished');G.score=Math.floor(G.score);best=store.get(bestKey(),0);const isBest=G.score>best;if(isBest){best=G.score;store.set(bestKey(),best);}
  $('eScore').textContent=G.score.toLocaleString();$('eGems').textContent=G.gems+'/'+gems.length;$('eRings').textContent=G.rings+'/'+rings.length;
  $('eTime').textContent=fmtTime(G.time);$('eCrash').textContent=G.crashes;$('eBest').textContent=best.toLocaleString();$('newBest').hidden=!isBest;
  const ratio=G.gems/gems.length;$('endTitle').textContent=G.crashes===0&&ratio>0.7?'Flawless glide':ratio>0.5?'Smooth flying':'You made it down';
  $('hud').hidden=true;showOnly('endScreen');tone(392,0.3,'triangle',0.08);setTimeout(()=>tone(523,0.3,'triangle',0.08),120);setTimeout(()=>tone(784,0.5,'triangle',0.08),240);}
$('startBtn').onclick=start;$('tutBtn').onclick=startTutorial;$('againBtn').onclick=start;$('endMenuBtn').onclick=toMenu;
$('pauseBtn').onclick=pause;$('resumeBtn').onclick=resume;$('restartBtn').onclick=()=>{if(G.mode==='race'){G.solo?beginRace(true):openLobby();return;}G.mode==='tut'?startTutorial():start();};$('menuBtn').onclick=toMenu;
$('tdGo').onclick=start;$('tdAgain').onclick=startTutorial;
window.addEventListener('keydown',e=>{if(e.key==='Enter'){if(!$('camSetup').hidden||!$('phoneSetup').hidden)return;if(G.state==='menu'||G.state==='end'||G.state==='tutdone')start();}});
try{hot&&hot.snapshot&&hot.snapshot(()=>({best}));}catch(e){}

/* ================= race ================= */
G.pen=0;G.gi=0;G.raceT0=0;G.solo=true;G.final=0;
const myName=()=>{let n=store.get('name','');if(!n){n='Flyer '+(10+Math.floor(Math.random()*89));store.set('name',n);}return n;};
function openLobby(){if(needCam())return;G.state='menu';$('hud').hidden=true;$('count').hidden=true;$('rName').value=myName();showOnly('raceLobby');syncLobby();}
let qrRoom='';
function roomLink(){const u=new URL(location.href);u.search='';u.hash='';u.searchParams.set('room',room.code);if(SKY)u.searchParams.set('trk','sky');return u.toString();}
function syncLobby(){
  const inRoom=room.status==='in';$('rOut').hidden=inRoom||room.status==='joining';$('rIn').hidden=!inRoom;
  $('rMsg').textContent=room.status==='joining'?'Joining room…':room.status==='error'?room.error:'';
  if(inRoom){$('rRoom').textContent=room.code;const link=roomLink();$('rLink').textContent=link;
    if(qrRoom!==link){qrRoom=link;QRCode.toCanvas($('rQR'),link,{width:300,margin:1,color:{dark:'#191d2e',light:'#fff6ea'}},err=>{if(err)logIssue('Race','Could not draw the room QR code: '+err.message);});}
    const ul=$('rPlayers');ul.innerHTML='';const list=[...room.players.values()].sort((a,b)=>a.t-b.t);
    for(const p of list){const li=document.createElement('li');const l=document.createElement('b');const dot=document.createElement('i');dot.style.background=p.color;l.append(dot,p.name+(p.id===room.me.id?' (you)':''));
      const r=document.createElement('span');r.textContent=p.host?'host':'';li.append(l,r);ul.append(li);}
    {const h=[...room.players.values()].find(p=>p.host),lv=room.isHost?settings.guide:h&&h.lvl;$('rGuide').textContent='Guide level for this race: '+(GUIDE[lv]?GUIDE[lv].name:'the host’s')+(room.isHost?' (yours; everyone in the room flies with it. Change it on the start screen.)':' (the host’s choice)');}
    $('rStart').hidden=!room.isHost;$('rStart').textContent=list.length>1?'Start race for everyone':'Start race';
    if(!room.isHost)$('rMsg').textContent='Waiting for the host to start the race.';}
}
function syncRaceEnd(){
  if($('raceEnd').hidden)return;const multi=!G.solo&&room.status==='in';const ol=$('reList');ol.innerHTML='';
  const rows=multi?room.results:[{id:'me',name:myName(),time:G.final,pen:G.pen}];
  rows.forEach((r,i)=>{const li=document.createElement('li');if(r.id===room.me.id||r.id==='me')li.className='me';const p=room.players.get(r.id);
    const l=document.createElement('b');const dot=document.createElement('i');dot.style.background=p?p.color:'#ffd25e';l.append(dot,(multi?ord(i+1)+'  ':'')+r.name);
    const t=document.createElement('span');t.textContent=fmtRace(r.time)+(r.pen?' (incl. +'+r.pen+' s)':'');li.append(l,t);ol.append(li);});
  if(multi){const still=[...room.players.values()].filter(p=>!p.fin&&p.st&&!p.st.done).length;$('reNote').textContent=still?still+(still>1?' racers are':' racer is')+' still flying…':'';
    $('reAgain').hidden=!room.isHost;$('reAgain').textContent='Race again';if(!room.isHost&&!still)$('reNote').textContent='Waiting for the host to start the next race.';}
  else{$('reAgain').hidden=false;$('reAgain').textContent='Try again';$('reNote').textContent='';}
  $('reLobby').hidden=!multi;
}
onRoomChange(()=>{if(!$('raceLobby').hidden)syncLobby();syncRaceEnd();});
onRaceStart(pl=>{G.raceLvl=pl&&GUIDE[pl.lvl]?pl.lvl:'';if(RACE)beginRace(false);});
function shareLevel(){setMyLevel(settings.guide);}
shareLevel();   // so the lobby can show the host's level before the race starts
function beginRace(solo){
  initAudio();if(actx&&actx.state==='suspended')actx.resume().catch(()=>{});
  $('camSetup').hidden=true;$('phoneSetup').hidden=true;
  G.mode='race';G.solo=solo;resetRun();resetGates();G.pen=0;G.raceT0=0;G.final=0;G.state='count';G.countEnd=performance.now()+3000;G._cdN=0;
  showOnly(null);$('coach').hidden=true;$('hud').hidden=false;$('hud').classList.remove('tut');$('count').hidden=false;canvas.focus();goFull();}
function countdown(now){const left=(G.countEnd-now)/1000,n=Math.ceil(left);const el=$('count');   // real clock, so every racer's GO lines up
  if(left<=0){G.state='play';G.raceT0=performance.now();el.textContent='GO';el.classList.add('go');tone(988,0.4,'triangle',0.09);buzz(30);setTimeout(()=>{el.hidden=true;el.classList.remove('go');},700);return;}
  el.textContent=n;el.classList.remove('go');if(n!==G._cdN){G._cdN=n;tone(523,0.18,'triangle',0.08);}}
function raceFinish(){G.state='end';G.final=raceTime()+G.pen;endRecording('finished');$('hud').hidden=true;
  const key='best.race',prev=store.get(key,0),isBest=!prev||G.final<prev;if(isBest)store.set(key,G.final);
  if(!G.solo&&room.status==='in')sendFinish(G.final,G.pen);
  const missed=gates.filter(g=>g.state===2).length;
  $('reTitle').textContent=missed===0?'Clean run':missed<=2?'Nice racing':'Finished';
  $('reMine').textContent='Your time '+fmtRace(G.final)+(missed?' · '+missed+' gate'+(missed>1?'s':'')+' missed (+'+G.pen+' s)':' · every gate')+(isBest?' · your best on this device':' · best '+fmtRace(prev));
  showOnly('raceEnd');syncRaceEnd();tone(392,0.3,'triangle',0.08);setTimeout(()=>tone(523,0.3,'triangle',0.08),120);setTimeout(()=>tone(784,0.5,'triangle',0.08),240);}
$('rName').addEventListener('change',e=>{const n=e.target.value.trim().slice(0,16)||myName();store.set('name',n);setMyName(n);});
$('rCreate').onclick=()=>{store.set('name',$('rName').value.trim()||myName());joinRoom(newRoomCode(),myName());};
$('rJoin').onclick=()=>{const c=cleanCode($('rCode').value);if(c.length<3){$('rMsg').textContent='Type the room code your friend sees on their screen.';return;}store.set('name',$('rName').value.trim()||myName());joinRoom(c,myName());};
$('rCode').addEventListener('keydown',e=>{if(e.key==='Enter'){e.stopPropagation();$('rJoin').click();}});
$('rSolo').onclick=$('rSolo2').onclick=()=>beginRace(true);
$('rStart').onclick=()=>{if(!room.isHost)return;G.raceLvl=settings.guide;startRace({lvl:settings.guide});beginRace(false);};
$('rLeave').onclick=()=>{leaveRoom();syncLobby();};
$('rCopy').onclick=()=>{try{navigator.clipboard.writeText(roomLink()).then(()=>toast('Link copied','good'));}catch(e){}};
$('rBack').onclick=()=>toMenu();
$('reAgain').onclick=()=>{if(G.solo||room.status!=='in'){beginRace(true);return;}if(room.isHost){G.raceLvl=settings.guide;startRace({lvl:settings.guide});beginRace(false);}};
$('reLobby').onclick=()=>openLobby();$('reMenu').onclick=()=>toMenu();
// ghosts: the other racers, see-through, with name tags
const ghosts=new Map();
function makeGhost(p){const grp=new THREE.Group();const mat=new THREE.MeshBasicMaterial({color:p.color,transparent:true,opacity:0.55,side:THREE.DoubleSide,depthWrite:false});
  const wing=new THREE.Shape();wing.moveTo(0,-1.1);wing.lineTo(1.35,0.55);wing.lineTo(0.3,0.9);wing.lineTo(0,1.6);wing.lineTo(-0.3,0.9);wing.lineTo(-1.35,0.55);wing.closePath();
  const wg=new THREE.ShapeGeometry(wing);wg.rotateX(-Math.PI/2);const w=new THREE.Mesh(wg,mat);grp.add(w);
  const body=new THREE.Mesh(new THREE.SphereGeometry(0.25,8,6),mat);body.position.set(0,0.12,-0.85);grp.add(body);
  const c=document.createElement('canvas');c.width=256;c.height=64;const g=c.getContext('2d');g.font='700 34px "Bricolage Grotesque",system-ui,sans-serif';g.textAlign='center';g.textBaseline='middle';
  g.fillStyle='rgba(13,16,32,.55)';const tw=Math.min(250,g.measureText(p.name).width+28);g.fillRect(128-tw/2,8,tw,48);g.fillStyle=p.color;g.fillText(p.name,128,33);
  const tag=new THREE.Sprite(new THREE.SpriteMaterial({map:new THREE.CanvasTexture(c),transparent:true,depthWrite:false,depthTest:false}));tag.scale.set(4.4,1.1,1);tag.position.y=2.3;grp.add(tag);
  grp.scale.setScalar(1.485);scene.add(grp);return {grp,name:p.name};}
let rtLimitedSeen=0,rtWarned=false;
function updateRaceNet(now){
  if(!RACE)return;
  if(G.state==='count'){countdown(now);updateHUD();}
  const racing=G.mode==='race'&&!G.solo&&room.status==='in';
  if(rtStats.limited>rtLimitedSeen){rtLimitedSeen=rtStats.limited;if(!rtWarned){rtWarned=true;logIssue('Race server','The race server refused messages because too many were sent at once (free plan limit). Positions or phone tilt may stutter. Phones on the same Wi‑Fi as their screen use the direct link and avoid this.');}}
  if(racing&&(G.state==='play'||G.state==='count'||G.state==='end'||G.state==='paused'))sendState(now,{p:[G.pos.x,G.pos.y,G.pos.z],a:[G.pitch,G.yaw,G.roll],s:G.s,done:G.state==='end'});
  const seen=new Set();
  if(racing&&G.state!=='menu')for(const p of room.players.values()){if(p.id===room.me.id)continue;const pose=ghostPose(p,now);if(!pose||pose.done)continue;seen.add(p.id);
    let gh=ghosts.get(p.id);if(gh&&gh.name!==p.name){scene.remove(gh.grp);gh=null;}if(!gh){gh=makeGhost(p);ghosts.set(p.id,gh);}
    gh.grp.visible=true;gh.grp.position.set(pose.p[0],pose.p[1],pose.p[2]);eul.set(pose.a[0],pose.a[1],pose.a[2],'YXZ');gh.grp.setRotationFromEuler(eul);}
  for(const [id,gh] of ghosts)if(!seen.has(id)){gh.grp.visible=false;if(!room.players.has(id)){scene.remove(gh.grp);ghosts.delete(id);}}
}
if(SKY)raceCfg.tag='sky-';
if(RACE){$('tutBtn').hidden=true;$('startBtn').querySelector('strong').textContent='Race '+TRACK_NAME[TRACK];
  $('startBtn').querySelector('span').textContent='Make a room and send friends the link, or practise alone. Fly through every gate: each one missed costs 3 seconds.';
  document.querySelector('#startScreen .lede').textContent=SKY?'A minute of open sky above a sea of clouds. Breathing gates, one enormous drop, a slalom between pylons of light, and a long climb home. Every third gate you fly through changes the colours of the world.':'A tight, twisting canyon of stone pillars and low arches. No gems: follow the glowing line through every gate to the finish, as fast as you can.';
  if(SKY)$('raceEyebrow').textContent='Halcyon Skyway · Race';}
if(ROOM_PARAM){joinRoom(ROOM_PARAM,myName());openLobby();}   // join straight away, even if the controls need setting up first

/* ================= control picker & camera control ================= */
attachCanvas($('camSetupView'));attachCanvas($('camHudView'));
onFist(()=>{if(settings.control==='camera'||!$('camSetup').hidden){ck.Fist=true;}if(G.state==='play'&&hand.enabled)tryBoost();});
const CTL_HELP={simple:'↑ climb · ↓ dive · ← → turn · Space boost · V view · P pause. W A S D work too.',
  arms:'W / S move your left arm, ↑ / ↓ your right arm: both up to dive, both down to climb, one of each to turn. A / D quick turn · Space boost.',
  mouse:'Press and hold on the view, then drag: up to dive, down to climb, sideways to turn. Double-click to boost.',
  phone:'Hold your phone flat, top edge toward this screen: nose up to climb, down to dive, roll to turn, tap its screen to boost.',
  camera:'Camera control: steer with a bare hand, or with any object you hold up. Choose which on the camera screen.',
  touch:'A thumb on each half: both up to dive, both down to climb, one of each to turn. Double-tap to boost.'};
const ck={Up:false,Down:false,Left:false,Right:false,Fist:false};let lostSince=0,handWarned=false,camPrev='simple';
function syncControlUI(){for(const b of document.querySelectorAll('.ctlcard'))b.setAttribute('aria-pressed',String(b.dataset.ctl===settings.control));
  $('ctlHelp').textContent=CTL_HELP[settings.control]||'';$('modeRow').hidden=settings.control!=='touch';}
function setControl(c){if(c==='phone'){camPrev=settings.control==='phone'||settings.control==='camera'?'simple':settings.control;openPhoneSetup();return;}if(phone.status!=='off')stopPhone();
  if(c==='camera'){camPrev=settings.control==='camera'?(isTouch?'touch':'simple'):settings.control;openCamSetup();return;}
  if(hand.enabled||hand.status!=='off')disableHand();settings.control=c;store.set('control',c);lastInput=c==='touch'?'touch':c==='mouse'?'mouse':'keys';syncControlUI();}
function needCam(){if(settings.control==='phone'&&phone.status!=='connected'){camPrev='simple';openPhoneSetup();return true;}
  if(settings.control==='camera'&&hand.status!=='ready'){camPrev=isTouch?'touch':'simple';openCamSetup();return true;}return false;}
function openCamSetup(){for(const k in ck)ck[k]=false;$('camSetup').hidden=false;$('handSens').value=hand.sens;beginRangeLearning();
  if(hand.status==='ready'){requestCalibration();return;}
  enableHand().then(ok=>{if(!ok)logIssue('Camera',hand.error);});}
function closeCamSetup(use){$('camSetup').hidden=true;
  if(use&&hand.status==='ready'){commitRangeLearning();settings.control='camera';store.set('control','camera');lastInput='remote';}
  else{disableHand();settings.control=camPrev;store.set('control',camPrev);}
  syncControlUI();if(RACE&&use&&G.state==='menu')openLobby();}
for(const b of document.querySelectorAll('.ctlcard'))b.onclick=()=>{if(G.state==='menu')setControl(b.dataset.ctl);};
$('camDone').onclick=()=>closeCamSetup(true);$('camCancel').onclick=()=>closeCamSetup(false);$('camRecalBtn').onclick=()=>{resetHandRange();beginRangeLearning();for(const k in ck)ck[k]=false;requestCalibration();};
$('handSens').addEventListener('input',e=>setHandSens(e.target.value));
function syncCamMode(){for(const b of $('camModeSeg').querySelectorAll('button'))b.setAttribute('aria-pressed',String(b.dataset.cam===hand.mode));const o=hand.mode==='object',pm=hand.mode==='palm';
  $('camTitle').textContent=o?'Any object is the glider':pm?'Your palm is the control stick':'Your hand is the glider';
  const L=o?[['Raise it','climb'],['Lower it','dive'],['Tilt left','turn left'],['Tilt right','turn right'],['Push toward the camera','boost']]
    :pm?[['Raise your hand','climb'],['Lower your hand','dive'],['Tilt it left, like a wheel','turn left'],['Tilt it right','turn right'],['Close a fist','boost']]:[['Fingertips up','climb'],['Fingertips down','dive'],['Tilt left','turn left'],['Tilt right','turn right'],['Close a fist','boost']];
  ['Up','Down','Left','Right','Fist'].forEach((k,i)=>{$('ck'+k).innerHTML='';$('ck'+k).append(L[i][0]+' ');const s=document.createElement('span');s.textContent=L[i][1];$('ck'+k).append(s);});}
for(const b of $('camModeSeg').querySelectorAll('button'))b.onclick=()=>{setCamMode(b.dataset.cam);beginRangeLearning();for(const k in ck)ck[k]=false;syncCamMode();};
syncCamMode();
window.addEventListener('keydown',e=>{if((e.key==='c'||e.key==='C')&&hand.enabled&&!e.repeat){requestCalibration();toast('Hold your hand flat','good');}});
/* phone glider pairing */
let qrFor='';
const pk={Up:false,Down:false,Left:false,Right:false,Tap:false};
function openPhoneSetup(){if(hand.enabled||hand.status!=='off')disableHand();for(const k in pk)pk[k]=false;$('phoneSetup').hidden=false;$('padSens').value=phone.sens;if(phone.status==='off'||phone.status==='error'){stopPhone();hostPhone();}}
function closePhoneSetup(use){$('phoneSetup').hidden=true;
  if(use&&phone.status==='connected'){settings.control='phone';store.set('control','phone');lastInput='remote';}
  else{stopPhone();settings.control=camPrev;store.set('control',camPrev);}
  syncControlUI();if(RACE&&use&&G.state==='menu')openLobby();}
$('padDone').onclick=()=>closePhoneSetup(true);$('padCancel').onclick=()=>closePhoneSetup(false);$('padSens').addEventListener('input',e=>setPhoneSens(e.target.value));
onPhoneBoost(()=>{if(!$('phoneSetup').hidden)pk.Tap=true;if(G.state==='play')tryBoost();});
let padLostSince=0,padSlowLogged=false,padStalls=0;
let screenFps=0,padChecked=0;
// what the phone link looks like right now, in plain words: used on the setup screen and in the issue log
function phoneCheck(){return (phone.via==='relay'?'relay link (slow)':'direct link')+' · network '+Math.round(phone.ms||0)+' ms · phone sends '+(phone.hz||'?')+' readings/s · gyroscope '+(phone.gyro||'?')+' · screen '+Math.round(screenFps)+' frames/s';}
function phoneHud(now){
  if(!$('phoneSetup').hidden){
    if(phone.url&&qrFor!==phone.url){qrFor=phone.url;$('padUrl').textContent=phone.url;QRCode.toCanvas($('padQR'),phone.url,{width:360,margin:1,color:{dark:'#191d2e',light:'#fff6ea'}},err=>{if(err)logIssue('Phone glider','Could not draw the QR code: '+err.message);});}
    $('padMsg').textContent=phone.status==='error'?phone.error:phone.status==='starting'?'Setting up the link…':phone.status==='waiting'?'Scan this code with your phone camera, then tap “Tap to connect” on the phone.'
      :phone.live?'Connected. Tilt the phone and watch the bar follow. Hold it flat and press “Set level” on the phone if it sits off-centre.':'Connected. Waiting for the phone to send its tilt…';
    $('padDone').disabled=phone.status!=='connected';
    $('padDial').style.transform='translateY('+(-(phone.sp||0)*1.1).toFixed(1)+'px) rotate('+(phone.sr||0).toFixed(1)+'deg)';
    if(phone.live){const sp=phone.sp||0,sr=phone.sr||0;if(sp>9)pk.Up=true;if(sp<-9)pk.Down=true;if(sr<-11)pk.Left=true;if(sr>11)pk.Right=true;}
    for(const k in pk)$('pk'+k).classList.toggle('ok',pk[k]);
    if(phone.status==='connected'){const ms=Math.round(phone.ms||0),relay=phone.via==='relay';
      $('padLink').textContent='Phone check: '+phoneCheck()+'. '+(relay?'Linked through the relay (slower). Put both devices on the same Wi‑Fi for the direct link.':'Linked directly.')+(ms?' Network delay about '+ms+' ms'+(ms>60?' — that is high; the same Wi‑Fi, closer to the router, helps.':', and the screen predicts past it, so the glider moves with your hand.'):'');}
  }
  {const slow=settings.control==='phone'&&(G.state==='play'||G.state==='count')&&phone.status==='connected'&&phone.via==='relay';$('linkChip').hidden=!slow;
   if(slow)$('linkChip').textContent='PHONE ON SLOW LINK'+(phone.ms?' · '+Math.round(phone.ms)+' MS':'')+' · SAME WI‑FI FIXES IT';}
  // a phone check in the issue log 8 s into each flight with the phone, so a report says where any delay comes from
  if(settings.control==='phone'&&G.state==='play'&&phone.live&&padChecked>=0){if(!padChecked)padChecked=now;if(now-padChecked>8000){padChecked=-1;logIssue('Phone check',phoneCheck()+'. Slow spots: relay link, network over 40 ms, under 50 readings/s, or under 50 frames/s.');}}
  if(settings.control==='phone'&&G.state==='play'){
    while(phone.stalls.length){const [ms,why]=phone.stalls.shift();if(G.state==='play'){recEvent('phone stall',ms+' ms: '+why);if(++padStalls<=3)logIssue('Phone glider','The phone went silent for '+(ms/1000).toFixed(1)+' s in flight: '+why+'. The glider eased level and picked your tilt up again.');}}
    if(phone.ms>110&&!padSlowLogged){padSlowLogged=true;logIssue('Phone glider','The phone link is slow (about '+Math.round(phone.ms)+' ms, '+(phone.via==='relay'?'through the relay':'direct')+'). Same Wi‑Fi for both devices makes it quicker.');}
    if(phone.live)padLostSince=0;else{if(!padLostSince)padLostSince=now;if(now-padLostSince>2500){pause();$('pauseNote').textContent='Paused because the phone stopped sending its tilt. Wake the phone and check it still says Connected, then resume.';}}
  }
}
function handHud(now){
  const on=hand.enabled&&hand.status==='ready',setup=!$('camSetup').hidden;
  $('camHud').hidden=!(on&&!setup&&(G.state==='play'||G.state==='paused'));
  if(setup){
    $('camMsg').textContent=hand.status==='starting'?'Starting the camera and loading the hand tracker. Allow the camera if your browser asks.':hand.status==='error'?hand.error
      :hand.mode==='object'&&!hand.calibrated&&hand.objState!=='learning'?'Step 1: keep the dashed box free of your object for a moment, so I can see you and the room without it. Pick something whose colour stands out from your clothes.'
      :hand.mode==='object'&&!hand.calibrated?'Step 2: now hold your object inside the dashed box, the way you want to hold it when level, and keep it still while I learn it.'
      :hand.mode==='object'&&!hand.tracking?'I lost the object. Bring it back into view, or press Start over to learn it again.'
      :hand.mode==='palm'&&!hand.tracking?'Hold one hand up facing the camera, open palm, fingers up, like a wave hello. Keep your elbow relaxed, about chest height.'
      :hand.mode==='palm'&&!hand.calibrated?'Good. Hold it still for a moment where it feels comfortable: that height becomes level.'
      :!hand.tracking?'Hold one hand out toward the screen: flat, palm down, fingertips pointing straight at the camera, like a paper plane flying into it.':!hand.calibrated?'Good. Keep it flat and still for a moment so I can learn your level position.'
      :'You are flying it. Now do each move below as far as feels comfortable. I set the sensitivity from your own reach.';
    if(hand.tracking&&hand.calibrated){if(hand.rawPitch>0.26)ck.Up=true;if(hand.rawPitch<-0.26)ck.Down=true;if(hand.rawRoll<-0.24)ck.Left=true;if(hand.rawRoll>0.24)ck.Right=true;}
    for(const k in ck)$('ck'+k).classList.toggle('ok',ck[k]);
    $('camDone').disabled=!(on&&hand.calibrated);$('camRecalBtn').disabled=!on;
    $('camSide').textContent=hand.mode==='object'?(hand.calibrated?'The orange tint shows what I am following. If it covers the wrong things, press Start over with a more colourful object.':''):hand.tracking&&hand.side?'Following your '+hand.side+' hand':'';
  }
  if(on&&G.state==='play'&&settings.control==='camera'){
    if(hand.tracking){lostSince=0;handWarned=false;}
    else{if(!lostSince)lostSince=now;const lost=(now-lostSince)/1000;
      if(lost>0.9&&!handWarned){handWarned=true;toast('Show your hand to the camera','bad');}
      if(lost>3.5){pause();$('pauseNote').textContent='Paused because the camera lost sight of your hand. Bring it back into view and resume.';}}
  }
}
// a phone paired before this tab reloaded (e.g. switching to the race canyon) reconnects by itself
if(settings.control==='phone'&&phoneWasPaired())hostPhone();
syncControlUI();

/* ================= loop ================= */
let last=performance.now(),fpsF=0,fpsT=0,lowCount=0;
// Quality ladder: when play drops under ~50 fps for 2 seconds, take one step down. Smoothness comes before looks.
const QSTEPS=[
  ()=>post.level>1&&(post.setLevel(1),'switched off the brushwork filter'),
  ()=>pixelRatio>1.25&&(pixelRatio=1.25,renderer.setPixelRatio(1.25),resize(),'lowered the resolution a little'),
  ()=>pixelRatio>1&&(pixelRatio=1,renderer.setPixelRatio(1),resize(),'lowered the resolution'),
  ()=>post.level>0&&(post.setLevel(0),'switched off bloom and colour grading'),
  ()=>pixelRatio>0.8&&(pixelRatio=0.8,renderer.setPixelRatio(0.8),resize(),'lowered the resolution further'),
];
// one recorder sample: controls in, what the line asked and added, what the glider did, the phone's raw and filtered tilt
function recSample(){return {s:G.s,off:G.lineOff,lk:G.lock,hl:G.help,cl:G.offV,ol:G.onLine,pi:G.pitchIn,ti:G.turnIn,np:G.needP,nt:G.needT,hy:G.helpYaw,hp:G.helpPitch,
  p:G.pitch,r:G.roll,yw:G.yaw,v:G.speed*G.flow,y:G.pos.y-floorY(G.s),gy:G.pos.y-groundAt(G.s,G.d),
  pp:phone.live?phone.pitch:null,pr:phone.live?phone.roll:null,fp:phone.live?phone.sp:null,fr:phone.live?phone.sr:null,pl:phone.status==='connected'?(phone.live?1:0):null,ms:phone.ms||null};}
// Each step is remembered on this device, so the next page load starts at a level that runs smoothly: a step taken
// mid-flight freezes the picture for 60-220 ms (owner's flight recordings: 2-3 such freezes in the first 4 s of every flight).
function stepQuality(fps){for(const st of QSTEPS){const what=st();if(what){store.set('qsteps',store.get('qsteps',0)+1);logIssue('Performance','Frame rate dropped to '+Math.round(fps)+' fps, so I '+what+' to keep play smooth (remembered for next time).');return true;}}return false;}
// start where this device settled last time (unless ?fx= forces a level)
if(!new URLSearchParams(location.search).has('fx')){const n=store.get('qsteps',0);let done=0;for(let k=0;k<n;k++){let any=false;for(const st of QSTEPS){if(st()){any=true;done++;break;}}if(!any)break;}}
function loop(now){requestAnimationFrame(loop);let dt=(now-last)/1000;const rawMs=now-last;last=now;if(dt>0.05)dt=0.05;if(dt<=0)dt=0.016;timeU.value=now/1000;
  try{if(G.state==='play'){update(dt);updateHUD();if(G._rec)recFrame(now,rawMs,recSample);if(G.mode==='tut')tutPads();}else $('oob').hidden=true;
    updateCamera(dt,false);updateVisuals(dt,now/1000);drawThumbs();updateHand(now);handHud(now);updatePhone(now);phoneHud(now);updateRaceNet(now);post.render(now/1000,G.state==='play'?clamp((G.speed-70)/100,0,1):0);}
  catch(e){logIssue('Frame',e.message+(e.stack?' | '+String(e.stack).split('\n')[1]:''));}
  fpsF++;fpsT+=dt;if(fpsT>=1){const fps=fpsF/fpsT;fpsF=0;fpsT=0;screenFps=fps;
    // also on the menu (it draws the same canyon), so the adjusting happens before you fly, not during the first bend
    if((G.state==='play'||G.state==='menu')&&fps<50&&!document.hidden){lowCount++;if(lowCount>=2&&stepQuality(fps))lowCount=0;}else lowCount=0;
  }}
resize();placeAt(30,48);updateCamera(0,true);
try{renderer.compile(scene,camera);}catch(e){}   // prepare every material's shader now, not the first time it comes into view
requestAnimationFrame(loop);
// ?debug: test hook for test/guide-sim.cjs (steps the flight without drawing)
if(/[?&]debug\b/.test(location.search))window.__game={quality:()=>({level:post.level,pr:renderer.getPixelRatio()}),scene,ribbonMat,guideLevel,G,update,settings,start,beginRace,routePoint,LEN,FINISH_S,GUIDE,snapCam:()=>updateCamera(0,true),render:t=>post.render(t,0),CAM,camera,recFrame,recSample,updateCamera,updateVisuals,updateHUD,startTutorial,pause,resume,toMenu,player};
})();

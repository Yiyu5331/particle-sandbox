'use strict';
import { CHUNK, EMBER, FIRE, FLOWER, FP_MAX, F_BODY, F_BURN, F_SCORCH, F_TIP, GLASS, LAVA, MATERIALS, M_LIFE0, NT, PLANT, RAIN_THR, SALTWATER, SMOKE, TNT, WATER } from '../engine/index.js';
import { $, CELL, QS, toast } from '../ui/host.js';
/* 渲染器：从“当前渲染的世界”每帧取一次只读状态（world.renderState()），画到画布上。
 * 只读不写；不调用任何会改世界的接口。特效（闪白、震动、冲击波）由宿主通过 fxBoom / fxThunder 触发。 */
// 当前帧的世界状态（每帧开头由 syncState 刷新；都是活引用，只读）
let $env, $CHN, $CW, $H, $N, $W, $aux, $charge, $chunkCount, $chunkTTL, $flags, $gx, $gy, $life, $ripples, $seed, $temp, $tick, $type, $wet, $fpAlive, $fpCount, $fpPX, $fpPY, $fpQX, $fpQY, $fpSeed, $fpTemp, $fpType, $fpX, $fpY, $perf, $GH, $GW, $cloud, $lastBolt, $vapor, $gridEpoch;
let renderSrc = null;                 // 当前渲染的世界（World 或 HOST_WORLD）
let sceneDirty = true, lastEpoch = -1; // sceneDirty：下一帧整屏重画；网格换代（清空、读档、换尺寸）时自动置位
/** 指定要画哪个世界（模式切换、浏览器自测时调用） */
export function setRenderWorld(w) { renderSrc = w; sceneDirty = true; }
export function renderWorld() { return renderSrc; }
/** 下一帧整屏重画（改了视图、画质、时间等） */
export function invalidate() { sceneDirty = true; }
export function setViewMode(v) { viewMode = v; sceneDirty = true; }
function syncState() {
  if (!renderSrc) return false;
  ({ env: $env, CHN: $CHN, CW: $CW, H: $H, N: $N, W: $W, aux: $aux, charge: $charge, chunkCount: $chunkCount, chunkTTL: $chunkTTL, flags: $flags, gx: $gx, gy: $gy, life: $life, ripples: $ripples, seed: $seed, temp: $temp, tick: $tick, type: $type, wet: $wet, fpAlive: $fpAlive, fpCount: $fpCount, fpPX: $fpPX, fpPY: $fpPY, fpQX: $fpQX, fpQY: $fpQY, fpSeed: $fpSeed, fpTemp: $fpTemp, fpType: $fpType, fpX: $fpX, fpY: $fpY, perf: $perf, GH: $GH, GW: $GW, cloud: $cloud, lastBolt: $lastBolt, vapor: $vapor, gridEpoch: $gridEpoch } = renderSrc.renderState());
  if ($gridEpoch !== lastEpoch) { lastEpoch = $gridEpoch; sceneDirty = true; }
  return $W > 0;
}

/* =====================================================================
 * 3. 渲染
 *    WebGL2 管线：状态纹理 → 场景着色（双输出：底色 + 自发光）
 *                → 辉光时间累积（拖尾）→ 5 级降采样/升采样（bloom + 大范围光照）
 *                → 光照合成 → 后处理（震动/冲击波/色差/闪白/色调映射/暗角/颗粒）
 *    不支持 WebGL2（或加 ?nogl=1）时退回 Canvas2D：同一套调色板，逐格上色。
 * ===================================================================== */
export const settings = { bloom: true, light: true, distort: true, shake: true, aberration: true,
                   vignette: true, grain: true, tonemap: true, gridLines: false, hd: true,
                   smooth: true, texture: true, shadows: true, clouds: true };
export const VIEW_NAMES = ['正常', '温度', '密度', '活跃块 / 刚体', '湿度'];
export let viewMode = 0;
export let canvas = null, gl = null, ctx2d = null, renderMode = 'none';
export let particleCount = 0;
export let pixelRatio = 1;

export const fx = { flash: 0, shake: 0, ca: 0, boomX: 0.5, boomY: 0.5,
             shocks: [0, 1, 2, 3].map(() => ({ x: 0, y: 0, age: 0, power: 0 })), next: 0 };

export function fxThunder() { fx.flash = Math.max(fx.flash, 0.45); fx.shake = Math.min(14, fx.shake + 3); }

export function fxBoom(x, y, R, P) {
  const s = P * R / 15;
  if (s > 0.3) {
    fx.flash = Math.max(fx.flash, Math.min(0.85, 0.25 + 0.55 * s));
    fx.ca = Math.max(fx.ca, 0.008 * s);
    const k = fx.shocks[fx.next]; fx.next = (fx.next + 1) & 3;
    k.x = x / $W; k.y = y / $H; k.age = 0; k.power = s;
  } else fx.flash = Math.max(fx.flash, 0.04);
  fx.shake = Math.min(14, fx.shake + 9 * s);
  fx.boomX = x / $W; fx.boomY = y / $H;
}

export function encTemp(T) {
  if (T <= 0) { const v = (T + 60) * (16 / 60); return v < 0 ? 0 : v; }
  return 16 + Math.sqrt((T > 2500 ? 2500 : T) / 2500) * 239;
}

/* ---------------------------------------------------------------------
 * 3.1 着色器
 * ------------------------------------------------------------------- */
export const VS_QUAD = `#version 300 es
in vec2 aPos; out vec2 vUv;
void main(){ vUv = aPos*0.5+0.5; gl_Position = vec4(aPos,0.0,1.0); }`;

export function matDefines() {
  let s = '';
  for (const m of MATERIALS) s += '#define T_' + m.key + ' ' + m.id + '.0\n';
  return s;
}

export const FS_SCENE = `#version 300 es
precision highp float; precision highp int;
${matDefines()}
uniform sampler2D uState, uState2, uPal, uHeat, uChunk, uCloud;
uniform vec2 uGrid, uGrav, uLightDir, uSunPos, uMoonPos;
uniform float uTime, uDistort, uGridLines, uDay, uEl, uShadowK, uBolt;
uniform vec4 uQual;                                        // 液面平滑、纹理与法线光照、阴影、云
uniform vec3 uRip[8];                                      // 涟漪：x, y（格），已过去的秒数
uniform int uView;
in vec2 vUv;
layout(location=0) out vec4 oCol;
layout(location=1) out vec4 oEmis;

float h21(vec2 p){ p = fract(p*vec2(123.34,456.21)); p += dot(p,p+45.32); return fract(p.x*p.y); }
float vnoise(vec2 p){
  vec2 i = floor(p), f = fract(p); f = f*f*(3.0-2.0*f);
  return mix(mix(h21(i),h21(i+vec2(1,0)),f.x), mix(h21(i+vec2(0,1)),h21(i+vec2(1,1)),f.x), f.y);
}
float fbm(vec2 p){ return vnoise(p)*0.55 + vnoise(p*2.1+3.7)*0.3 + vnoise(p*4.3+9.1)*0.15; }
bool inGrid(ivec2 c){ return c.x>=0 && c.y>=0 && c.x<int(uGrid.x) && c.y<int(uGrid.y); }
vec4 cell(ivec2 c){
  if(!inGrid(c)) return vec4(0.0,0.0,37.0,0.0);
  return floor(texelFetch(uState,c,0)*255.0+0.5);
}
vec4 cell2(ivec2 c){
  if(!inGrid(c)) return vec4(0.0);
  return floor(texelFetch(uState2,c,0)*255.0+0.5);
}
vec4 pal(float t,int k){ return texelFetch(uPal, ivec2(k,int(t)), 0); }
float kindOf(float t){ return floor(pal(t,6).r*255.0+0.5); }
float occ(ivec2 c){ if(!inGrid(c)) return 1.0; float k = kindOf(cell(c).r); return (k==1.0||k==2.0) ? 1.0 : 0.0; }   // 固体 / 粉末
float decT(float v){ return v<16.0 ? v*3.75-60.0 : pow((v-16.0)/239.0,2.0)*2500.0; }
vec3 blackbody(float T){
  float x = clamp((T-450.0)/1350.0,0.0,1.0);
  return vec3(smoothstep(0.0,0.3,x), smoothstep(0.18,0.8,x)*0.8, smoothstep(0.55,1.0,x)*0.65)*(0.35+1.6*x);
}
// 火焰按温度走黑体曲线：深红 → 橙 → 黄 → 白 → 偏蓝
vec3 flameColor(float T){
  vec3 c = mix(vec3(0.75,0.10,0.02), vec3(1.0,0.36,0.04), smoothstep(650.0,850.0,T));
  c = mix(c, vec3(1.0,0.72,0.22), smoothstep(850.0,1050.0,T));
  c = mix(c, vec3(1.0,0.95,0.78), smoothstep(1050.0,1300.0,T));
  return mix(c, vec3(0.80,0.90,1.0), smoothstep(1300.0,1700.0,T));
}
vec3 heatRamp(float T){
  if(T<20.0) return mix(vec3(0.15,0.5,1.0), vec3(0.03,0.03,0.07), clamp((T+40.0)/60.0,0.0,1.0));
  float x = sqrt(clamp((T-20.0)/1700.0,0.0,1.0));
  vec3 c = mix(vec3(0.03,0.03,0.07), vec3(0.55,0.05,0.35), smoothstep(0.0,0.25,x));
  c = mix(c, vec3(1.0,0.25,0.05), smoothstep(0.2,0.5,x));
  c = mix(c, vec3(1.0,0.85,0.2), smoothstep(0.45,0.8,x));
  return mix(c, vec3(1.0), smoothstep(0.8,1.0,x));
}

// 天空：按时间从星空渐变到白天，晨昏时地平线发橙；太阳 / 月亮；由湿度场凝成的云
vec3 background(vec2 uv){
  float asp = uGrid.x/uGrid.y;
  vec3 night = mix(vec3(0.052,0.058,0.100), vec3(0.016,0.016,0.030), smoothstep(0.0,1.0,uv.y));
  night += vec3(0.030,0.020,0.055)*(1.0-smoothstep(0.0,0.9,length(uv-vec2(0.5,0.08))));
  vec3 day = mix(vec3(0.20,0.42,0.78), vec3(0.62,0.78,0.92), pow(uv.y,0.8));
  vec3 col = mix(night, day, uDay);
  float tw = smoothstep(0.42,0.0,abs(uEl));                           // 晨昏
  col += vec3(0.95,0.42,0.14)*tw*pow(uv.y,1.6)*0.55 + vec3(0.35,0.10,0.25)*tw*(1.0-uv.y)*0.12;
  for(int l=0;l<2;l++){                                               // 星星 / 微尘
    float fl = float(l);
    vec2 p = vec2(uv.x*asp,uv.y)*mix(13.0,25.0,fl) + vec2(uTime*(0.035+0.02*fl), -uTime*0.02*(fl+1.0)) + fl*17.3;
    vec2 id = floor(p), f = fract(p)-0.5;
    float r = h21(id);
    vec2 o = (vec2(h21(id+3.1),h21(id+7.7))-0.5)*0.7;
    float twk = 0.5+0.5*sin(uTime*(0.5+r)+r*40.0);
    col += vec3(0.55,0.62,0.85)*smoothstep(0.07,0.0,length(f-o))*step(0.6,r)*twk*0.24*(1.0-uDay*0.9);
  }
  vec2 sd = (uv-uSunPos)*vec2(asp,1.0);
  col += vec3(1.0,0.85,0.55)*(smoothstep(0.045,0.03,length(sd)) + 0.35*exp(-length(sd)*7.0))*step(-0.12,uEl);
  vec2 md = (uv-uMoonPos)*vec2(asp,1.0);
  col += vec3(0.75,0.80,0.92)*(smoothstep(0.032,0.024,length(md))*0.8 + 0.10*exp(-length(md)*9.0))*step(uEl,0.12);
  if(uQual.w>0.5){
    float cl = texture(uCloud, uv).r*2.0;                             // 1.0 = 快要下雨的厚度
    float n = fbm(vec2(uv.x*asp,uv.y)*7.0 + vec2(uTime*0.025,0.0));
    float a = smoothstep(0.10,0.75, cl*(0.55+0.9*n));
    vec3 cc = mix(vec3(0.92,0.94,0.97), vec3(0.34,0.36,0.42), smoothstep(0.5,1.6,cl));   // 越厚越黑
    cc *= mix(0.22,1.0,uDay) + vec3(0.9,0.5,0.3)*tw*0.25;
    cc += vec3(0.7,0.8,1.0)*uBolt;                                    // 闪电把云照亮
    col = mix(col, cc, a*0.9);
  }
  if(uGridLines>0.5){
    vec2 gg = uv*uGrid/8.0;
    vec2 dl = abs(fract(gg-0.5)-0.5);
    col += vec3(0.5,0.6,1.0)*step(min(dl.x,dl.y),1.0/48.0)*0.05;
  }
  return col;
}

void main(){
  vec2 uv = vec2(vUv.x, 1.0-vUv.y);
  vec2 g = uv*uGrid;
  if(uView==0 && uDistort>0.0){
    // 热扭曲：用上一帧模糊后的自发光当热量估计，往重力方向取样，热浪就出现在热源上方
    vec3 hs = texture(uHeat, vUv + vec2(uGrav.x,-uGrav.y)*5.0/uGrid).rgb;
    float heat = smoothstep(0.03,0.45,dot(hs,vec3(0.45,0.4,0.15)));
    vec2 np = g*0.33 + uGrav*uTime*4.0;
    g += (vec2(vnoise(np),vnoise(np+31.7))-0.5)*heat*2.4*uDistort;
    vec4 s0 = cell(ivec2(floor(uv*uGrid)));
    if(kindOf(s0.r)==3.0 && s0.r!=T_LAVA)
      g += vec2(sin(uv.y*uGrid.y*0.9+uTime*1.7), cos(uv.x*uGrid.x*0.8+uTime*1.3))*0.2*uDistort;
  }
  ivec2 c = ivec2(floor(g));
  vec2 f = fract(g);
  vec4 s = cell(c);
  float kind = kindOf(s.r);
  float bubble = 0.0;

  // 液面平滑：在四个相邻格心之间对「是不是液体 / 固体」做双线性插值，取 0.5 等值线当液面（相当于 marching squares）
  if(uQual.x>0.5 && uView==0 && (kind==3.0 || kind==0.0 || kind==4.0)){
    vec2 gp = g-0.5; ivec2 b = ivec2(floor(gp)); vec2 fr = fract(gp);
    vec4 q00 = cell(b), q10 = cell(b+ivec2(1,0)), q01 = cell(b+ivec2(0,1)), q11 = cell(b+ivec2(1,1));
    float k00 = kindOf(q00.r), k10 = kindOf(q10.r), k01 = kindOf(q01.r), k11 = kindOf(q11.r);
    float l00 = (k00>=1.0&&k00<=3.0)?1.0:0.0, l10 = (k10>=1.0&&k10<=3.0)?1.0:0.0, l01 = (k01>=1.0&&k01<=3.0)?1.0:0.0, l11 = (k11>=1.0&&k11<=3.0)?1.0:0.0;
    float field = mix(mix(l00,l10,fr.x), mix(l01,l11,fr.x), fr.y);
    float nliq = float(k00==3.0)+float(k10==3.0)+float(k01==3.0)+float(k11==3.0);
    if(kind==3.0){ if(field<0.5){ s = vec4(0.0,0.0,s.b,0.0); kind = 0.0; } }
    else if(nliq>0.0 && field>=0.5){
      // 空气 / 气体格里的这一小块属于液体：借用旁边那格液体来上色；被液体包住的气体画成气泡
      vec4 pick = k00==3.0 ? q00 : (k10==3.0 ? q10 : (k01==3.0 ? q01 : q11));
      if(kind==4.0 && nliq>=3.0) bubble = 1.0;
      if(kind==0.0 || bubble>0.5){ s = pick; kind = 3.0; }
    }
  }
  float t = s.r, sd = s.g, T = decT(s.b);
  int aux = int(s.a);
  vec4 s2 = cell2(c);
  float wetv = clamp(s2.r/110.0,0.0,1.0);
  vec3 back = background(uv);
  // 简单的方向光阴影：朝着太阳 / 月亮走几步，路上有固体就在影子里
  float shadow = 0.0;
  if(uQual.z>0.5 && uShadowK>0.01 && uView==0){
    for(int k=1;k<=6;k++){ if(occ(ivec2(floor(g+uLightDir*(float(k)*2.3+0.6))))>0.5){ shadow = 1.0; break; } }
  }
  float occL = occ(c-ivec2(1,0)), occR = occ(c+ivec2(1,0)), occU = occ(c-ivec2(0,1)), occD = occ(c+ivec2(0,1));
  if(kind==0.0 || kind==4.0) back *= 1.0 - 0.07*(occL+occR+occU+occD)*uQual.y;      // 角落里的环境光遮蔽（影子只落在固体表面上，空气里不画）
  vec3 col = back, em = vec3(0.0);
  float ncol = max(1.0, floor(pal(t,7).r*255.0+0.5));

  if(kind==1.0 || kind==2.0){                             // ---------- 固体 / 粉末 ----------
    float idx = mod(sd, ncol);
    if(t==T_FLOWER) idx = min(floor(sd/51.0), ncol-1.0);
    vec3 base = pal(t,int(idx)).rgb;
    float tex = uQual.y;
    if(kind==2.0 || t==T_PLANT || t==T_FLOWER) base *= 1.0 + (fract(sd*0.6180339)-0.5)*0.14;   // 松散粒子：颜色跟着粒子走
    else base = pal(t,0).rgb;                                                              // 静态固体：颜色只由世界坐标决定
    // 程序纹理（世界坐标）
    if(t==T_WOOD){
      float ring = sin((g.x*0.9 + vnoise(g*vec2(0.12,0.5))*7.0)*1.5);                       // 年轮 / 木纹
      base *= 0.80 + 0.16*ring*tex + 0.14*vnoise(vec2(g.x*2.2,g.y*0.25));
    }
    else if(t==T_STONE){
      float strata = vnoise(vec2(g.x*0.07, g.y*0.55));                                      // 层理
      base *= 0.78 + 0.26*strata + 0.14*vnoise(g*0.9)*tex;
      base = mix(base, base*vec3(1.06,1.0,0.92), step(0.8,vnoise(g*0.3+11.0))*tex);         // 斑点
    }
    else if(t==T_METAL){
      base *= 0.88 + 0.20*vnoise(vec2(g.x*0.12, g.y*2.4));                                  // 拉丝
      base += 0.10*smoothstep(0.6,1.0,sin((g.x+g.y)*0.35));
    }
    else if(t==T_STEEL){
      base *= 0.86 + 0.16*vnoise(vec2(g.x*0.1, g.y*2.0));
      base += 0.22*step(length(fract(g/6.0)-0.5),0.13)*tex;                                 // 铆钉
    }
    else if(t==T_BRICK){
      vec2 bb = vec2(g.x + mod(floor(g.y/3.0),2.0)*3.0, g.y);                               // 错缝砌法
      vec2 fb = fract(bb/vec2(6.0,3.0));
      float tone = h21(floor(bb/vec2(6.0,3.0)));
      base *= 0.82 + 0.34*tone;
      if(tex>0.5 && (fb.x<0.14 || fb.y<0.26)) base = vec3(0.62,0.60,0.56)*(0.9+0.2*vnoise(g));  // 砖缝
    }
    else if(t==T_CONCRETE){
      base *= 0.86 + 0.22*vnoise(g*1.3) ;
      base *= 1.0 - 0.14*step(fract(g.y/10.0),0.09)*tex;                                    // 模板缝
    }
    else if(t==T_SOIL){ base *= 0.82 + 0.34*vnoise(g*0.55); }
    else if(t==T_TNT){
      base = mix(vec3(0.88,0.19,0.19), vec3(0.95,0.91,0.9), step(0.66,fract(float(c.y)/3.0+0.01)));
      base *= 0.9+0.1*step(0.5,fract(float(c.x)/4.0));
    }
    else if(t==T_ICE){
      base += 0.16*smoothstep(0.7,1.0,vnoise(g*0.5));
      base += step(0.997,h21(vec2(c)+floor(uTime*4.0)))*0.6;
      base = mix(back, base, 0.88);
    }
    else if(t==T_SNOW) base += step(0.985,h21(vec2(c)+floor(uTime*3.0)))*0.25;
    else if(t==T_SALT) base += step(0.99,h21(vec2(c)+floor(uTime*3.0)))*0.3;
    else if(t==T_ROPE) base *= 0.78 + 0.3*step(0.5,fract((g.x+g.y)*0.5));                   // 绞股
    else if(t==T_ANCHOR){
      float p = 0.6+0.4*sin(uTime*2.0);
      base *= 0.8 + 0.4*step(abs(f.x-0.5),0.16) + 0.4*step(abs(f.y-0.5),0.16);
      em = base*0.12*p;
    }
    else if(t==T_CLONE){
      float p = 0.5+0.5*sin(uTime*4.0+float(c.x+c.y)*0.7);
      base *= 0.8+0.4*p; em = base*0.3*p;
    }
    else if(t==T_VOID){
      bool rim = cell(c+ivec2(1,0)).r!=t || cell(c-ivec2(1,0)).r!=t || cell(c+ivec2(0,1)).r!=t || cell(c-ivec2(0,1)).r!=t;
      float p = 0.6+0.4*sin(uTime*3.0+float(c.x-c.y)*0.9);
      base = rim ? vec3(0.22,0.04,0.42)*p : vec3(0.008,0.0,0.016);
      if(rim) em = vec3(0.4,0.1,0.85)*0.7*p;
    }
    col = base;
    if(t==T_GLASS){                                       // 玻璃：半透明 + 斜向高光 + 边缘亮线
      float streak = smoothstep(0.84,1.0,sin((g.x-g.y)*0.55));
      col = mix(back*1.15, base, 0.3) + vec3(0.9,0.97,1.0)*streak*0.24;
      float e = 0.0;
      if(cell(c+ivec2(1,0)).r!=t) e = max(e, smoothstep(0.62,1.0,f.x));
      if(cell(c-ivec2(1,0)).r!=t) e = max(e, smoothstep(0.38,0.0,f.x));
      if(cell(c+ivec2(0,1)).r!=t) e = max(e, smoothstep(0.62,1.0,f.y));
      if(cell(c-ivec2(0,1)).r!=t) e = max(e, smoothstep(0.38,0.0,f.y));
      col += vec3(0.75,0.9,1.0)*e*0.3;
    } else if(t!=T_VOID && t!=T_CLONE){
      // 假法线：邻格空着的那一侧算「斜面」，朝光的一侧提亮、背光的一侧压暗；四面都被包住的内部略暗（AO）
      if(tex>0.5){
        vec2 n = vec2((1.0-occR)*smoothstep(0.45,1.0,f.x) - (1.0-occL)*smoothstep(0.55,0.0,f.x),
                      (1.0-occD)*smoothstep(0.45,1.0,f.y) - (1.0-occU)*smoothstep(0.55,0.0,f.y));
        col *= 1.0 + dot(n,uLightDir)*0.42*max(uShadowK,0.25);
        col *= 0.90 + 0.10*(1.0-0.25*(occL+occR+occU+occD)) + 0.0;
      }
      col *= 1.0 - 0.38*shadow*uShadowK;
      if(t==T_PLANT) col *= 1.0 - 0.08*wetv; else col *= 1.0 - 0.45*wetv;                    // 打湿了颜色变深
    }
    if((aux&2)!=0) col *= 0.38;                           // 焦黑
    if((aux&1)!=0){                                       // 正在燃烧 / 引信已点
      if(t==T_TNT){
        float b = step(0.5,fract(uTime*6.0));
        col = mix(col, vec3(1.0,0.9,0.7), b*0.7); em += vec3(1.0,0.5,0.2)*b*0.7;
      } else {
        float fl = 0.5+0.5*vnoise(g*0.9+uTime*vec2(1.3,-2.1));
        col = mix(col, vec3(0.28,0.07,0.02), 0.5);
        em += vec3(1.0,0.36,0.07)*fl*(t==T_CHARCOAL ? 1.1 : 0.85);
      }
    }
    if(T>450.0) em += blackbody(T)*((t==T_METAL||t==T_STEEL) ? 1.3 : 0.8);   // 黑体辐射
  }
  else if(kind==3.0){                                     // ---------- 液体 ----------
    ivec2 up = -ivec2(uGrav);
    float depth = 0.0;
    for(int k=1;k<=6;k++){ if(kindOf(cell(c+up*k).r)==3.0) depth += 1.0; else break; }
    float dk = depth/6.0;
    float edge = dot(f-0.5,-uGrav)+0.5;
    vec3 base = pal(t,int(mod(sd,ncol))).rgb;
    float rip = 0.0;                                      // 涟漪：从砸进液面的地方向两边传开
    for(int k=0;k<8;k++){
      vec3 r = uRip[k];
      if(r.z>2.5) continue;
      float d = length((g-r.xy)*vec2(1.0,2.5));
      rip += sin(d*1.5 - r.z*9.0)*exp(-d*0.10)*exp(-r.z*1.6);
    }
    if(t==T_LAVA){
      float nz = vnoise(g*0.35+vec2(uTime*0.25,-uTime*0.15));
      float hot = clamp((T-800.0)/650.0,0.0,1.0);
      vec3 glow = mix(vec3(1.0,0.27,0.0), vec3(1.0,0.78,0.22), nz*nz);
      col = mix(vec3(0.20,0.035,0.01), glow, clamp(hot*0.75+nz*0.55,0.0,1.0));
      em = col*(0.55+0.95*hot);
    } else if(t==T_ACID){
      float p = 0.5+0.5*sin(uTime*2.5+g.x*0.3+g.y*0.3);
      col = mix(vec3(0.63,0.31,1.0), vec3(0.45,0.95,0.3), p*0.7)*(1.0-0.35*dk);
      em = vec3(0.3,0.9,0.25)*(0.07+0.11*p);
      if(depth==0.0) col += vec3(0.6,1.0,0.6)*smoothstep(0.55,1.0,edge)*0.3;
    } else {
      vec3 wc = mix(base*1.3+0.05, base*0.62, dk);
      wc += 0.07*(vnoise(g*0.22+vec2(uTime*0.35,uTime*0.2))-0.5);
      wc *= mix(0.55,1.0,max(uDay,0.25));
      col = mix(back, wc, pal(t,6).b);
      if(depth<=1.0){
        float wave = 0.5+0.5*sin(dot(g,abs(uGrav.yx))*0.7+uTime*2.2) + rip*0.9;
        float hl = smoothstep(0.5,1.0,edge + rip*0.25)*(0.3+0.45*wave)*(t==T_OIL ? 0.35 : 1.0)*(depth==0.0 ? 1.0 : 0.25);
        col += vec3(0.55,0.72,0.92)*hl*mix(0.45,1.0,uDay);
      }
      if(t==T_OIL && depth<2.0) col += 0.10*(0.5+0.5*cos(vec3(0.0,2.0,4.0)+g.x*0.25+uTime*0.5));
      if(T>80.0 && t!=T_OIL) col += 0.08*step(0.93,h21(vec2(c)+floor(uTime*8.0)));
    }
    if(bubble>0.5){                                       // 气泡：一圈亮边 + 高光
      float r = length(f-0.5);
      col = mix(col, col*1.35+0.10, smoothstep(0.46,0.30,r));
      col += vec3(0.9,0.95,1.0)*(smoothstep(0.08,0.0,abs(r-0.36))*0.5 + smoothstep(0.12,0.0,length(f-vec2(0.36,0.34)))*0.6);
    }
    if((aux&1)!=0){ float fl = 0.5+0.5*vnoise(g*0.9+uTime*vec2(1.3,-2.1)); em += vec3(1.0,0.4,0.08)*fl*0.9; }
    if(T>450.0 && t!=T_LAVA) em += blackbody(T)*0.6;
  }
  else if(kind==5.0){                                     // ---------- 电火花 / 闪电 ----------
    float fl = 0.6+0.4*h21(vec2(c)+floor(uTime*40.0));
    col = vec3(0.85,0.95,1.0);
    em = vec3(0.6,0.85,1.0)*2.6*fl;
  }

  if((aux&4)!=0 && kind!=4.0 && kind!=5.0 && kind!=0.0){  // 带电的导体
    float fl = 0.4+0.6*h21(vec2(c)+floor(uTime*30.0));
    col = mix(col, vec3(0.8,0.93,1.0), 0.45*fl);
    em += vec3(0.45,0.75,1.0)*(1.0+1.2*fl);
  }

  if(kind==0.0 || kind==4.0){                             // ---------- 气体：按密度累积的软边 ----------
    // 用一层随浮力方向流动的噪声去扰动取样位置（近似 curl noise 湍流），火苗和烟会卷、会舔
    vec2 flow = g*0.45 - uGrav*uTime*3.0;
    vec2 gw = g + (vec2(vnoise(flow), vnoise(flow+19.3))-0.5)*1.5;
    float smoke=0.0, smokeTone=0.0, steam=0.0, fire=0.0, fireT=0.0, ember=0.0, foam=0.0;
    for(int j=-1;j<=1;j++) for(int i=-1;i<=1;i++){
      ivec2 cc = c+ivec2(i,j);
      vec4 q = cell(cc);
      if(q.r==0.0) continue;
      float l = length((vec2(cc)+0.5)-gw);
      float w = smoothstep(1.4,0.15,l);
      if(q.r==T_SMOKE){
        float a = w*min(1.0,q.a/40.0);
        smoke += a;
        smokeTone += a*(q.g<50.0 ? 0.86 : (q.g<170.0 ? 0.36 : 0.09));   // 白烟（湿）/ 灰烟 / 黑烟（缺氧）
      }
      else if(q.r==T_STEAM) steam += w*(0.75+0.25*fract(q.g*0.53));
      else if(q.r==T_FIRE){ fire += w; fireT += w*max(decT(q.b), 620.0+q.a*16.0); }
      else if(q.r==T_EMBER) ember += smoothstep(0.8,0.1,length((vec2(cc)+0.5)-g));
      else if(q.r==T_FOAM) foam += smoothstep(1.0,0.25,length((vec2(cc)+0.5)-g));
    }
    if(smoke>0.0){
      float tone = smokeTone/smoke;
      col = mix(col, vec3(tone, tone, tone*1.04)*mix(0.6,1.0,max(uDay,0.3)), clamp(smoke*mix(0.42,0.62,1.0-tone),0.0,0.92));   // 黑烟更浓
    }
    col = mix(col, vec3(0.74,0.80,0.88)*mix(0.55,1.0,max(uDay,0.3)), clamp(steam*0.42,0.0,0.8));
    col = mix(col, vec3(0.93,0.96,1.0)*mix(0.5,1.0,max(uDay,0.3)), clamp(foam*0.8,0.0,0.92));
    if(fire>0.0){
      float fl = 0.75+0.5*vnoise(g*0.8-uGrav*uTime*7.0);
      vec3 fc = flameColor(fireT/fire + (fl-1.0)*120.0);
      float a = clamp(fire*0.72,0.0,1.0);
      col = mix(col, fc, a);
      em += fc*a*fl*1.35;
    }
    if(ember>0.0){
      vec3 ec = vec3(1.0,0.62,0.15);
      col = mix(col, ec, clamp(ember,0.0,1.0));
      em += ec*min(ember,1.0)*1.7;
    }
  }

  if(uView==1){ col = heatRamp(T); em = vec3(0.0); }
  else if(uView==2){
    col = t==0.0 ? vec3(0.015,0.015,0.03) : mix(vec3(0.08,0.2,0.55), vec3(1.0,0.9,0.3), pal(t,6).a);
    if(kind==4.0||kind==5.0) col = vec3(0.3,0.12,0.4);
    em = vec3(0.0);
  }
  else if(uView==3){
    vec2 cuv = uv*uGrid/32.0;
    float act = texelFetch(uChunk, ivec2(floor(cuv)), 0).r;
    vec2 dl = abs(fract(cuv)-0.5);
    col = col*0.6 + (act>0.5 ? vec3(0.08,0.42,0.16) : vec3(0.16,0.03,0.03))*0.6 + step(0.482,max(dl.x,dl.y))*0.12;
    if(s2.b>0.5) col = mix(col, vec3(1.0,0.8,0.2), 0.5);              // 刚体
    em = vec3(0.0);
  }
  else if(uView==4){                                                  // 湿度：含水量 + 云 / 水汽
    vec2 cv = texture(uCloud, uv).rg;
    col = vec3(0.02,0.03,0.06) + vec3(0.1,0.5,1.0)*clamp(s2.r/150.0,0.0,1.0)*step(0.5,t) + vec3(0.9)*cv.r*0.8 + vec3(0.2,0.7,0.6)*cv.g*0.6;
    if(kind==3.0) col = vec3(0.1,0.3,0.9);
    em = vec3(0.0);
  }
  oCol = vec4(col,1.0);
  oEmis = vec4(em,1.0);
}`;

export const VS_POINT = `#version 300 es
in vec2 aPos; in vec4 aCol; in float aSize;
uniform vec2 uGrid; out vec4 vCol;
void main(){
  vec2 p = aPos/uGrid;
  gl_Position = vec4(p.x*2.0-1.0, 1.0-p.y*2.0, 0.0, 1.0);
  gl_PointSize = aSize; vCol = aCol;
}`;
export const FS_POINT = `#version 300 es
precision highp float;
in vec4 vCol;
layout(location=0) out vec4 oCol;
layout(location=1) out vec4 oEmis;
void main(){ oCol = vec4(vCol.rgb,1.0); oEmis = vec4(vCol.rgb*vCol.a,1.0); }`;

export const FS_GLOW = `#version 300 es
precision highp float;
uniform sampler2D uEmis, uPrev; uniform float uDecay;
in vec2 vUv; out vec4 o;
void main(){ o = max(texture(uEmis,vUv), texture(uPrev,vUv)*uDecay); }`;

export const FS_DOWN = `#version 300 es
precision highp float;
uniform sampler2D uTex; uniform vec2 uTexel;
in vec2 vUv; out vec4 o;
void main(){
  vec2 h = uTexel;
  vec3 s = texture(uTex,vUv).rgb*4.0;
  s += texture(uTex,vUv-h).rgb + texture(uTex,vUv+h).rgb;
  s += texture(uTex,vUv+vec2(h.x,-h.y)).rgb + texture(uTex,vUv-vec2(h.x,-h.y)).rgb;
  o = vec4(s/8.0,1.0);
}`;

export const FS_UP = `#version 300 es
precision highp float;
uniform sampler2D uTex; uniform vec2 uTexel; uniform float uW;
in vec2 vUv; out vec4 o;
void main(){
  vec2 h = uTexel*0.5;
  vec3 s = texture(uTex,vUv+vec2(-h.x*2.0,0.0)).rgb + texture(uTex,vUv+vec2(h.x*2.0,0.0)).rgb
         + texture(uTex,vUv+vec2(0.0,h.y*2.0)).rgb + texture(uTex,vUv+vec2(0.0,-h.y*2.0)).rgb;
  s += (texture(uTex,vUv+vec2(-h.x,h.y)).rgb + texture(uTex,vUv+vec2(h.x,h.y)).rgb
      + texture(uTex,vUv+vec2(h.x,-h.y)).rgb + texture(uTex,vUv+vec2(-h.x,-h.y)).rgb)*2.0;
  o = vec4(s/12.0*uW,1.0);
}`;

export const FS_COMPOSITE = `#version 300 es
precision highp float;
uniform sampler2D uCol, uEmis, uBloom, uLight;
uniform vec4 uK;                                           // 环境光、光照强度、bloom 强度、是否调试视图
in vec2 vUv; out vec4 o;
void main(){
  vec3 c = texture(uCol,vUv).rgb;
  if(uK.w>0.5){ o = vec4(c,1.0); return; }
  vec3 e = texture(uEmis,vUv).rgb, l = texture(uLight,vUv).rgb, b = texture(uBloom,vUv).rgb;
  // 发光体照亮周围：物体表面按光色加亮（暖光下偏暖），空气里也留一点辉光
  o = vec4(c*(uK.x + l*uK.y) + l*uK.y*0.03 + e + b*uK.z, 1.0);
}`;

export const FS_POST = `#version 300 es
precision highp float;
uniform sampler2D uTex;
uniform float uTime, uFlash, uCA, uAspect;
uniform vec2 uShake, uBoom;
uniform vec4 uShock[4];
uniform vec4 uOpts;                                        // 暗角、颗粒、色调映射、是否调试视图
in vec2 vUv; out vec4 o;
vec3 aces(vec3 x){ return clamp((x*(2.51*x+0.03))/(x*(2.43*x+0.59)+0.14),0.0,1.0); }
void main(){
  vec2 uv = vUv;
  vec2 asp = vec2(uAspect,1.0);
  uv += uShake*(0.3+0.7*exp(-length((uv-uBoom)*asp)*2.5));          // 震动：离爆心越远越弱
  for(int i=0;i<4;i++){                                             // 冲击波圆环扭曲
    vec4 s = uShock[i];
    if(s.w<=0.0) continue;
    vec2 d = (uv-s.xy)*asp;
    float l = length(d);
    uv += normalize(d+1e-5)/asp*smoothstep(0.07,0.0,abs(l-s.z))*s.w*0.022;
  }
  vec3 c;
  if(uCA>0.0005){                                                   // 短暂色差
    vec2 dir = uv-0.5;
    c = vec3(texture(uTex,uv+dir*uCA).r, texture(uTex,uv).g, texture(uTex,uv-dir*uCA).b);
  } else c = texture(uTex,uv).rgb;
  c += uFlash;                                                      // 闪白
  if(uOpts.w<0.5){
    if(uOpts.z>0.5){ c = pow(max(c,0.0),vec3(2.2)); c = aces(c*1.25); c = pow(c,vec3(1.0/2.2)); }
    if(uOpts.x>0.5){ float v = smoothstep(1.05,0.35,length((vUv-0.5)*vec2(1.1,1.25))); c *= mix(0.6,1.0,v); }
    if(uOpts.y>0.5){
      float n = fract(sin(dot(gl_FragCoord.xy+fract(uTime)*91.7,vec2(12.9898,78.233)))*43758.5453);
      c += (n-0.5)*0.035;
    }
  }
  o = vec4(clamp(c,0.0,1.0),1.0);
}`;

/* ---------------------------------------------------------------------
 * 3.2 WebGL2 初始化
 * ------------------------------------------------------------------- */
export const R = { rip: new Float32Array(24), dayK: 1, hdr: false, prog: {}, quad: null, stateTex: null, stateBuf: null, stateTex2: null, stateBuf2: null, cloudTex: null, cloudBuf: null, palTex: null, chunkTex: null,
            chunkBuf: null, scene: null, post: null, glow: [null, null], glowIdx: 0, levels: [],
            ptVao: null, ptBuf: null, ptData: null, cw: 0, ch: 0 };

export function glProgram(vs, fs) {
  const mk = ($type, src) => {
    const sh = gl.createShader($type);
    gl.shaderSource(sh, src); gl.compileShader(sh);
    if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) throw new Error('着色器编译失败：' + gl.getShaderInfoLog(sh));
    return sh;
  };
  const p = gl.createProgram();
  gl.attachShader(p, mk(gl.VERTEX_SHADER, vs)); gl.attachShader(p, mk(gl.FRAGMENT_SHADER, fs));
  gl.bindAttribLocation(p, 0, 'aPos'); gl.bindAttribLocation(p, 1, 'aCol'); gl.bindAttribLocation(p, 2, 'aSize');
  gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error('着色器链接失败：' + gl.getProgramInfoLog(p));
  const u = {};
  const n = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS);
  for (let i = 0; i < n; i++) {
    const name = gl.getActiveUniform(p, i).name.replace(/\[0\]$/, '');
    u[name] = gl.getUniformLocation(p, name);
  }
  return { p, u };
}

export function glTexture(w, h, internal, format, typ, filter, data) {
  const t = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, t);
  gl.texImage2D(gl.TEXTURE_2D, 0, internal, w, h, 0, format, typ, data || null);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filter);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filter);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  return t;
}

export function glTarget(w, h, count) {
  w = Math.max(2, w | 0); h = Math.max(2, h | 0);
  const fbo = gl.createFramebuffer(), tex = [];
  gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
  const bufs = [];
  for (let i = 0; i < count; i++) {
    const t = R.hdr ? glTexture(w, h, gl.RGBA16F, gl.RGBA, gl.HALF_FLOAT, gl.LINEAR)
                    : glTexture(w, h, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, gl.LINEAR);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0 + i, gl.TEXTURE_2D, t, 0);
    tex.push(t); bufs.push(gl.COLOR_ATTACHMENT0 + i);
  }
  gl.drawBuffers(bufs);
  if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) throw new Error('帧缓冲不完整');
  gl.clearColor(0, 0, 0, 1); gl.clear(gl.COLOR_BUFFER_BIT);
  return { fbo, tex, w, h };
}

export function glFreeTarget(t) {
  if (!t) return;
  gl.deleteFramebuffer(t.fbo);
  for (const x of t.tex) gl.deleteTexture(x);
}

export function glInit(cv) {
  gl = cv.getContext('webgl2', { antialias: false, alpha: false, depth: false, stencil: false,
                                 powerPreference: 'high-performance', preserveDrawingBuffer: false });
  if (!gl) return false;
  R.hdr = !!gl.getExtension('EXT_color_buffer_float');
  gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
  R.prog.scene = glProgram(VS_QUAD, FS_SCENE);
  R.prog.point = glProgram(VS_POINT, FS_POINT);
  R.prog.glow = glProgram(VS_QUAD, FS_GLOW);
  R.prog.down = glProgram(VS_QUAD, FS_DOWN);
  R.prog.up = glProgram(VS_QUAD, FS_UP);
  R.prog.comp = glProgram(VS_QUAD, FS_COMPOSITE);
  R.prog.post = glProgram(VS_QUAD, FS_POST);

  R.quad = gl.createVertexArray();
  gl.bindVertexArray(R.quad);
  const qb = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, qb);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);

  // 飞行粒子：每个粒子 3 个点（本体 + 两段拖尾），每点 7 个 float
  R.ptData = new Float32Array(FP_MAX * 3 * 7);
  R.ptVao = gl.createVertexArray();
  gl.bindVertexArray(R.ptVao);
  R.ptBuf = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, R.ptBuf);
  gl.bufferData(gl.ARRAY_BUFFER, R.ptData.byteLength, gl.DYNAMIC_DRAW);
  gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 28, 0);
  gl.enableVertexAttribArray(1); gl.vertexAttribPointer(1, 4, gl.FLOAT, false, 28, 8);
  gl.enableVertexAttribArray(2); gl.vertexAttribPointer(2, 1, gl.FLOAT, false, 28, 24);
  gl.bindVertexArray(null);

  // 调色板纹理：每种材料一行；0-4 列颜色，6 列 (状态, 发光, 透明度, 密度)，7 列 (颜色数)
  const pd = new Uint8Array(8 * NT * 4);
  for (let t = 0; t < NT; t++) {
    const m = MATERIALS[t];
    for (let k = 0; k < 5; k++) {
      const c = m.rgb[Math.min(k, m.rgb.length - 1)], o = (t * 8 + k) * 4;
      pd[o] = c[0]; pd[o + 1] = c[1]; pd[o + 2] = c[2]; pd[o + 3] = 255;
    }
    let o = (t * 8 + 6) * 4;
    pd[o] = m.state; pd[o + 1] = Math.round(m.emissive * 255); pd[o + 2] = Math.round(m.alpha * 255);
    pd[o + 3] = Math.round(Math.min(1, Math.log(Math.max(1, m.density)) / Math.log(8000)) * 255);
    o = (t * 8 + 7) * 4;
    pd[o] = m.rgb.length;
  }
  R.palTex = glTexture(8, NT, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, gl.NEAREST, pd);
  return true;
}

export function glResize() {
  // 网格尺寸变了：重建状态纹理和所有渲染目标
  R.stateBuf = new Uint8Array($N * 4);
  if (R.stateTex) gl.deleteTexture(R.stateTex);
  R.stateTex = glTexture($W, $H, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, gl.NEAREST);
  R.stateBuf2 = new Uint8Array($N * 4);
  if (R.stateTex2) gl.deleteTexture(R.stateTex2);
  R.stateTex2 = glTexture($W, $H, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, gl.NEAREST);
  R.cloudBuf = new Uint8Array($GW * $GH * 2);
  if (R.cloudTex) gl.deleteTexture(R.cloudTex);
  R.cloudTex = glTexture($GW, $GH, gl.RG8, gl.RG, gl.UNSIGNED_BYTE, gl.LINEAR);
  R.chunkBuf = new Uint8Array($CW * $CHN);
  if (R.chunkTex) gl.deleteTexture(R.chunkTex);
  R.chunkTex = glTexture($CW, $CHN, gl.R8, gl.RED, gl.UNSIGNED_BYTE, gl.NEAREST);
  const cw = canvas.width, ch = canvas.height;
  R.cw = cw; R.ch = ch;
  glFreeTarget(R.scene); glFreeTarget(R.post); glFreeTarget(R.glow[0]); glFreeTarget(R.glow[1]);
  for (const l of R.levels) glFreeTarget(l);
  R.scene = glTarget(cw, ch, 2);
  R.post = glTarget(cw, ch, 1);
  R.glow = [glTarget(cw >> 1, ch >> 1, 1), glTarget(cw >> 1, ch >> 1, 1)];
  R.levels = [];
  for (let i = 2; i <= 6; i++) R.levels.push(glTarget(cw >> i, ch >> i, 1));
  sceneDirty = true;
}

/* ---------------------------------------------------------------------
 * 3.3 状态打包：只重写清醒的块（休眠的块内容没变），顺便统计粒子数
 * ------------------------------------------------------------------- */
export function packState() {
  const buf = R.stateBuf, buf2 = R.stateBuf2, all = sceneDirty;
  let changed = all;
  for (let cy = 0; cy < $CHN; cy++) for (let cx = 0; cx < $CW; cx++) {
    const c = cx + cy * $CW;
    if (!all && $chunkTTL[c] === 0) continue;
    changed = true;
    const x0 = cx << 5, x1 = Math.min($W, x0 + CHUNK), y0 = cy << 5, y1 = Math.min($H, y0 + CHUNK);
    let cnt = 0;
    for (let y = y0; y < y1; y++) {
      for (let x = x0, i = y * $W + x0, o = i * 4; x < x1; x++, i++, o += 4) {
        const t = $type[i];
        buf[o] = t; buf[o + 1] = $seed[i]; buf[o + 2] = encTemp($temp[i]);
        buf2[o] = $wet[i]; buf2[o + 1] = $aux[i]; buf2[o + 2] = ($flags[i] & F_BODY) ? 255 : 0;
        if (t === 0) { buf[o + 3] = 0; continue; }
        cnt++;
        if (M_LIFE0[t] > 0) { const L = $life[i]; buf[o + 3] = L > 255 ? 255 : L; }
        else { const f = $flags[i]; buf[o + 3] = ((f & F_BURN) ? 1 : 0) | ((f & F_SCORCH) ? 2 : 0) | ($charge[i] ? 4 : 0) | ((f & F_TIP) ? 8 : 0); }
      }
    }
    $chunkCount[c] = cnt;
  }
  if (changed) {
    let total = 0;
    for (let c = 0; c < $chunkCount.length; c++) total += $chunkCount[c];
    particleCount = total;
  }
  return changed;
}

export function packPoints() {
  if ($fpCount === 0) return 0;
  const d = R.ptData, size = CELL * pixelRatio;
  let n = 0;
  for (let pass = 0; pass < 3; pass++) {                 // 先画最淡的拖尾，本体最后画在上面
    for (let k = 0; k < FP_MAX; k++) {
      if (!$fpAlive[k]) continue;
      const m = MATERIALS[$fpType[k]], c = m.rgb[$fpSeed[k] % m.rgb.length];
      const isEmber = $fpType[k] === EMBER;
      let x, y, a, s;
      if (pass === 0) { x = $fpQX[k]; y = $fpQY[k]; a = 0.3; s = size * 0.5; }
      else if (pass === 1) { x = $fpPX[k]; y = $fpPY[k]; a = 0.55; s = size * 0.75; }
      else { x = $fpX[k]; y = $fpY[k]; a = 1; s = size; }
      const o = n * 7;
      d[o] = x; d[o + 1] = y; d[o + 2] = c[0] / 255 * a; d[o + 3] = c[1] / 255 * a; d[o + 4] = c[2] / 255 * a;
      d[o + 5] = isEmber ? 1.8 : ($fpTemp[k] > 300 ? 0.5 : 0); d[o + 6] = s;
      n++;
    }
  }
  return n;
}

/* ---------------------------------------------------------------------
 * 3.4 WebGL2 一帧
 * ------------------------------------------------------------------- */
export function glBind(unit, tex) { gl.activeTexture(gl.TEXTURE0 + unit); gl.bindTexture(gl.TEXTURE_2D, tex); }
export function glPass(target, prog) {
  gl.bindFramebuffer(gl.FRAMEBUFFER, target ? target.fbo : null);
  gl.viewport(0, 0, target ? target.w : R.cw, target ? target.h : R.ch);
  gl.useProgram(prog.p);
}
export function glQuad() { gl.bindVertexArray(R.quad); gl.drawArrays(gl.TRIANGLES, 0, 3); }

export function renderGL(timeMs, dt) {
  const t0 = performance.now();
  if (packState()) {
    glBind(0, R.stateTex);
    gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, $W, $H, gl.RGBA, gl.UNSIGNED_BYTE, R.stateBuf);
    glBind(4, R.stateTex2);
    gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, $W, $H, gl.RGBA, gl.UNSIGNED_BYTE, R.stateBuf2);
  }
  // 云和水汽（粗网格，线性过滤 → 软边）
  for (let c = 0, n = $GW * $GH; c < n; c++) {
    const cl = $cloud[c] / RAIN_THR * 127, vp = $vapor[c] * 40;
    R.cloudBuf[c * 2] = cl > 255 ? 255 : cl; R.cloudBuf[c * 2 + 1] = vp > 255 ? 255 : vp;
  }
  glBind(5, R.cloudTex);
  gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, $GW, $GH, gl.RG, gl.UNSIGNED_BYTE, R.cloudBuf);
  sceneDirty = false;
  if (viewMode === 3) {
    for (let c = 0; c < R.chunkBuf.length; c++) R.chunkBuf[c] = $chunkTTL[c] > 0 ? 255 : 0;
    glBind(3, R.chunkTex);
    gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, $CW, $CHN, gl.RED, gl.UNSIGNED_BYTE, R.chunkBuf);
  }
  const npts = packPoints();
  const t1 = performance.now();
  const time = (timeMs / 1000) % 3600;
  const debugView = viewMode !== 0;
  gl.disable(gl.BLEND);

  // 1) 场景
  let P = R.prog.scene;
  glPass(R.scene, P);
  glBind(0, R.stateTex); glBind(1, R.palTex); glBind(2, R.levels[1].tex[0]); glBind(3, R.chunkTex);
  glBind(4, R.stateTex2); glBind(5, R.cloudTex);
  gl.uniform1i(P.u.uState, 0); gl.uniform1i(P.u.uPal, 1); gl.uniform1i(P.u.uHeat, 2); gl.uniform1i(P.u.uChunk, 3);
  gl.uniform1i(P.u.uState2, 4); gl.uniform1i(P.u.uCloud, 5);
  gl.uniform2f(P.u.uGrid, $W, $H); gl.uniform2f(P.u.uGrav, $gx, $gy);
  // 昼夜：太阳 / 月亮的位置、朝向光源的方向、光照强度
  const th = ($env.time - 0.25) * 6.2832, cs = Math.cos(th), sn = Math.sin(th), el = $env.dayNight ? $env.el : 1;
  const dayK = $env.dayNight ? Math.min(1, Math.max(0, el * 2.2 + 0.25)) : 1;
  R.dayK = dayK;
  gl.uniform2f(P.u.uSunPos, 0.5 - cs * 0.45, 0.62 - sn * 0.5); gl.uniform2f(P.u.uMoonPos, 0.5 + cs * 0.45, 0.62 + sn * 0.5);
  if (!$env.dayNight) gl.uniform2f(P.u.uLightDir, -0.5, -0.866);
  else if (el >= 0) gl.uniform2f(P.u.uLightDir, -cs, -sn); else gl.uniform2f(P.u.uLightDir, cs, sn);
  gl.uniform1f(P.u.uDay, dayK); gl.uniform1f(P.u.uEl, el);
  gl.uniform1f(P.u.uShadowK, el >= 0 ? Math.min(1, el * 3) : Math.min(1, -el * 3) * 0.3);
  const boltAge = $lastBolt && $tick >= $lastBolt.tick ? ($tick - $lastBolt.tick) : 999;
  gl.uniform1f(P.u.uBolt, boltAge < 12 ? 1 - boltAge / 12 : 0);
  gl.uniform4f(P.u.uQual, settings.smooth ? 1 : 0, settings.texture ? 1 : 0, settings.shadows ? 1 : 0, settings.clouds ? 1 : 0);
  for (let k = 0; k < 8; k++) R.rip[k * 3] = $ripples[k * 3], R.rip[k * 3 + 1] = $ripples[k * 3 + 1], R.rip[k * 3 + 2] = $ripples[k * 3 + 2] > 0 && $tick >= $ripples[k * 3 + 2] ? ($tick - $ripples[k * 3 + 2]) / 60 : 99;
  gl.uniform3fv(P.u.uRip, R.rip);
  gl.uniform1f(P.u.uTime, time); gl.uniform1f(P.u.uDistort, settings.distort ? 1 : 0);
  gl.uniform1f(P.u.uGridLines, settings.gridLines ? 1 : 0); gl.uniform1i(P.u.uView, viewMode);
  glQuad();
  if (npts > 0 && !debugView) {
    P = R.prog.point;
    gl.useProgram(P.p);
    gl.uniform2f(P.u.uGrid, $W, $H);
    gl.bindVertexArray(R.ptVao);
    gl.bindBuffer(gl.ARRAY_BUFFER, R.ptBuf);
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, R.ptData, 0, npts * 7);
    gl.drawArrays(gl.POINTS, 0, npts);
  }

  const useGlow = !debugView && (settings.bloom || settings.light || settings.distort);
  if (useGlow) {
    // 2) 辉光时间累积：上一帧的辉光乘衰减后和这一帧取最大值 → 余烬、火星、碎片自带拖尾
    const src = R.glow[R.glowIdx], dst = R.glow[R.glowIdx ^ 1];
    P = R.prog.glow;
    glPass(dst, P);
    glBind(0, R.scene.tex[1]); glBind(1, src.tex[0]);
    gl.uniform1i(P.u.uEmis, 0); gl.uniform1i(P.u.uPrev, 1);
    gl.uniform1f(P.u.uDecay, Math.pow(0.80, dt / 16.7));
    glQuad();
    R.glowIdx ^= 1;
    // 3) 降采样
    P = R.prog.down;
    let prev = dst;
    for (let i = 0; i < R.levels.length; i++) {
      glPass(R.levels[i], P);
      glBind(0, prev.tex[0]);
      gl.uniform1i(P.u.uTex, 0); gl.uniform2f(P.u.uTexel, 1 / prev.w, 1 / prev.h);
      glQuad();
      prev = R.levels[i];
    }
    // 4) 升采样并逐级叠加
    P = R.prog.up;
    gl.enable(gl.BLEND); gl.blendFunc(gl.ONE, gl.ONE);
    for (let i = R.levels.length - 1; i > 0; i--) {
      const s = R.levels[i];
      glPass(R.levels[i - 1], P);
      glBind(0, s.tex[0]);
      gl.uniform1i(P.u.uTex, 0); gl.uniform2f(P.u.uTexel, 1 / s.w, 1 / s.h); gl.uniform1f(P.u.uW, 0.85);
      glQuad();
    }
    gl.disable(gl.BLEND);
  }
  const t2 = performance.now();

  // 5) 光照合成
  P = R.prog.comp;
  glPass(R.post, P);
  glBind(0, R.scene.tex[0]); glBind(1, R.scene.tex[1]); glBind(2, R.levels[0].tex[0]); glBind(3, R.levels[2].tex[0]);
  gl.uniform1i(P.u.uCol, 0); gl.uniform1i(P.u.uEmis, 1); gl.uniform1i(P.u.uBloom, 2); gl.uniform1i(P.u.uLight, 3);
  // 夜里环境光弱、火光显眼；白天环境光强、火光的照明作用不明显
  gl.uniform4f(P.u.uK, settings.light ? 0.5 + 0.5 * R.dayK : 1.0, settings.light ? 2.2 - 1.5 * R.dayK : 0, settings.bloom ? 0.55 : 0, debugView ? 1 : 0);
  glQuad();

  // 6) 后处理
  const k = Math.pow(0.5, dt / 16.7);
  fx.flash *= Math.pow(0.45, dt / 16.7); fx.shake *= Math.pow(0.86, dt / 16.7); fx.ca *= Math.pow(0.84, dt / 16.7);
  if (fx.flash < 0.002) fx.flash = 0;
  P = R.prog.post;
  glPass(null, P);
  glBind(0, R.post.tex[0]);
  gl.uniform1i(P.u.uTex, 0);
  gl.uniform1f(P.u.uTime, time); gl.uniform1f(P.u.uAspect, R.cw / R.ch);
  const on = settings.shake && !debugView, amp = on ? fx.shake * pixelRatio : 0, ang = Math.random() * 6.283;
  gl.uniform2f(P.u.uShake, Math.cos(ang) * amp / R.cw, Math.sin(ang) * amp / R.ch);
  gl.uniform2f(P.u.uBoom, fx.boomX, 1 - fx.boomY);
  gl.uniform1f(P.u.uFlash, settings.aberration && !debugView ? fx.flash : 0);
  gl.uniform1f(P.u.uCA, settings.aberration && !debugView ? fx.ca : 0);
  const sh = new Float32Array(16);
  for (let i = 0; i < 4; i++) {
    const s = fx.shocks[i];
    if (s.power > 0) {
      s.age += dt;
      const $life = 520;
      if (s.age > $life) s.power = 0;
      sh[i * 4] = s.x; sh[i * 4 + 1] = 1 - s.y; sh[i * 4 + 2] = s.age * 0.0011;
      sh[i * 4 + 3] = settings.distort && !debugView ? s.power * (1 - s.age / $life) : 0;
    }
  }
  gl.uniform4fv(P.u.uShock, sh);
  gl.uniform4f(P.u.uOpts, settings.vignette ? 1 : 0, settings.grain ? 1 : 0, settings.tonemap ? 1 : 0, debugView ? 1 : 0);
  glQuad();
  const t3 = performance.now();
  $perf.pack += t1 - t0; $perf.draw += t2 - t1; $perf.post += t3 - t2;
  void k;
}

/* ---------------------------------------------------------------------
 * 3.5 Canvas2D 退路：逐格上色，每格 1 像素，由 CSS 放大
 * ------------------------------------------------------------------- */
export const R2 = { img: null, px: null, dayK: -1 };
export const BG32 = 0xff000000 | (15 << 16) | (10 << 8) | 10;

export function rgb32(r, g, b) {
  r = r < 0 ? 0 : r > 255 ? 255 : r | 0; g = g < 0 ? 0 : g > 255 ? 255 : g | 0; b = b < 0 ? 0 : b > 255 ? 255 : b | 0;
  return 0xff000000 | (b << 16) | (g << 8) | r;
}

export function render2D(timeMs) {
  const t0 = performance.now();
  // 退路里没有着色器：天空只按昼夜换一个底色，云、阴影、纹理、液面平滑都没有
  const dk = $env.dayNight ? Math.min(1, Math.max(0, $env.el * 2.2 + 0.25)) : 0;
  if (Math.abs(dk - R2.dayK) > 0.02) { R2.dayK = dk; sceneDirty = true; }
  const bg = rgb32(10 + 60 * R2.dayK, 10 + 100 * R2.dayK, 15 + 175 * R2.dayK);
  const px = R2.px, all = sceneDirty, fr = (timeMs / 60) | 0;
  let changed = all;
  for (let cy = 0; cy < $CHN; cy++) for (let cx = 0; cx < $CW; cx++) {
    const c = cx + cy * $CW;
    if (!all && $chunkTTL[c] === 0) continue;
    changed = true;
    const x0 = cx << 5, x1 = Math.min($W, x0 + CHUNK), y0 = cy << 5, y1 = Math.min($H, y0 + CHUNK);
    let cnt = 0;
    const act = $chunkTTL[c] > 0;
    for (let y = y0; y < y1; y++) for (let x = x0, i = y * $W + x0; x < x1; x++, i++) {
      const t = $type[i], T = $temp[i];
      let r, g, b;
      if (viewMode === 1) {                                // 温度
        if (T < 20) { const k = Math.max(0, (T + 40) / 60); r = 38 - 30 * k; g = 128 - 120 * k; b = 255 - 237 * k; }
        else { const k = Math.sqrt(Math.min(1, (T - 20) / 1700)); r = 8 + 247 * Math.min(1, k * 2.2); g = 8 + 230 * Math.max(0, k * 1.6 - 0.5); b = 18 + 200 * Math.max(0, k * 3 - 2.2); }
        if (t !== 0) cnt++;
        px[i] = rgb32(r, g, b);
        continue;
      }
      if (t === 0) {
        if (viewMode === 3) px[i] = act ? rgb32(10, 46, 22) : rgb32(30, 10, 12);
        else px[i] = bg;
        continue;
      }
      cnt++;
      const m = MATERIALS[t];
      if (viewMode === 2) { const k = Math.min(1, Math.log(Math.max(1, m.density)) / Math.log(8000)); px[i] = rgb32(20 + 235 * k, 50 + 180 * k, 140 - 60 * k); continue; }
      const sd = $seed[i], col = t === FLOWER ? m.rgb[Math.min(m.rgb.length - 1, (sd / 51) | 0)] : m.rgb[sd % m.rgb.length];
      const v = 1 + (((sd * 157) & 255) / 255 - 0.5) * 0.14;
      r = col[0] * v; g = col[1] * v; b = col[2] * v;
      const f = $flags[i];
      if (m.life) {                                        // 气体 / 能量：按寿命淡出，火焰闪烁
        const a = t === SMOKE ? Math.min(1, $life[i] / 40) * 0.8 : 1;
        if (t === SMOKE) { const tone = sd < 50 ? 215 : sd < 170 ? 92 : 28; r = g = b = tone; }
        if (t === FIRE) { const k = ((sd + fr * 37 + x * 13 + y * 7) & 63) / 63; r = 255; g = 70 + 150 * k; b = 20 + 40 * k; }
        r = 10 + (r - 10) * a; g = 10 + (g - 10) * a; b = 15 + (b - 15) * a;
      } else if (t === LAVA) { const k = Math.min(1, Math.max(0, (T - 800) / 650)); r = 90 + 165 * k; g = 20 + 110 * k * (0.6 + 0.4 * (sd / 255)); b = 5; }
      else if (t === TNT) { if (y % 3 === 0) { r = 240; g = 232; b = 230; } if ((f & F_BURN) && (fr & 4)) { r = 255; g = 220; b = 160; } }
      else if (t === GLASS) { r = 10 + (r - 10) * 0.45; g = 10 + (g - 10) * 0.45; b = 15 + (b - 15) * 0.45; if (((x - y) & 7) === 0) { r += 40; g += 45; b += 50; } }
      else if (t === WATER || t === SALTWATER) { const k = ((x * 3 + y * 5 + fr) & 31) === 0 ? 30 : 0; r += k; g += k; b += k; }
      if ($wet[i] > 20 && t !== PLANT) { const k = 1 - 0.4 * Math.min(1, $wet[i] / 110); r *= k; g *= k; b *= k; }
      if (f & F_SCORCH) { r *= 0.4; g *= 0.4; b *= 0.4; }
      if ((f & F_BURN) && t !== TNT) { const k = ((sd + fr * 29) & 31) / 31; r = r * 0.4 + 200 + 55 * k; g = g * 0.4 + 60 + 60 * k; b = b * 0.4; }
      if (T > 450 && !m.life && t !== LAVA) { const k = Math.min(1, (T - 450) / 1350); r += 255 * Math.min(1, k * 3); g += 200 * Math.max(0, k * 1.6 - 0.3); b += 160 * Math.max(0, k * 2.5 - 1.4); }
      if ($charge[i]) { r = r * 0.5 + 140; g = g * 0.5 + 160; b = b * 0.5 + 180; }
      if (viewMode === 3) { r = r * 0.6 + (act ? 10 : 40); g = g * 0.6 + (act ? 50 : 10); b = b * 0.6 + 10; }
      px[i] = rgb32(r, g, b);
    }
    $chunkCount[c] = cnt;
  }
  sceneDirty = false;
  if (changed) {
    let total = 0;
    for (let c = 0; c < $chunkCount.length; c++) total += $chunkCount[c];
    particleCount = total;
  }
  ctx2d.putImageData(R2.img, 0, 0);
  if ($fpCount > 0) {                                       // 飞行粒子直接画在上面
    for (let k = 0; k < FP_MAX; k++) {
      if (!$fpAlive[k]) continue;
      const m = MATERIALS[$fpType[k]], c = m.rgb[$fpSeed[k] % m.rgb.length];
      ctx2d.fillStyle = 'rgba(' + c[0] + ',' + c[1] + ',' + c[2] + ',0.45)';
      ctx2d.fillRect($fpPX[k] | 0, $fpPY[k] | 0, 1, 1);
      ctx2d.fillStyle = 'rgb(' + c[0] + ',' + c[1] + ',' + c[2] + ')';
      ctx2d.fillRect($fpX[k] | 0, $fpY[k] | 0, 1, 1);
    }
  }
  if (fx.flash > 0.01 && settings.aberration) {            // 爆炸闪白
    ctx2d.fillStyle = 'rgba(255,255,255,' + Math.min(0.8, fx.flash).toFixed(3) + ')';
    ctx2d.fillRect(0, 0, $W, $H);
  }
  fx.flash *= 0.5; fx.shake *= 0.86;
  canvas.style.transform = settings.shake && fx.shake > 0.3 ?
    'translate(' + ((Math.random() - 0.5) * fx.shake).toFixed(1) + 'px,' + ((Math.random() - 0.5) * fx.shake).toFixed(1) + 'px)' : '';
  $perf.draw += performance.now() - t0;
}

/* ---------------------------------------------------------------------
 * 3.6 对外接口
 * ------------------------------------------------------------------- */
export function createRenderer(host) {
  canvas = document.createElement('canvas');
  let ok = false;
  if (!QS.has('nogl')) {
    try { ok = glInit(canvas); } catch (e) { console.warn('WebGL2 初始化失败，退回 Canvas2D：', e.message); ok = false; gl = null; }
  }
  if (ok) renderMode = 'webgl2';
  else {
    canvas = document.createElement('canvas');
    ctx2d = canvas.getContext('2d', { alpha: false });
    renderMode = 'canvas2d';
    canvas.style.imageRendering = 'pixelated';
  }
  canvas.id = 'canvas';
  host.insertBefore(canvas, host.firstChild);
  if (gl) {
    canvas.addEventListener('webglcontextlost', e => { e.preventDefault(); toast('WebGL 上下文丢失，请刷新页面'); });
  }
}

export function resizeRenderer() {
  if (!syncState()) return;
  canvas.style.width = $W * CELL + 'px';
  canvas.style.height = $H * CELL + 'px';
  if (gl) {
    let pr = settings.hd ? Math.min(window.devicePixelRatio || 1, 2) : 1;
    if ($W * CELL * pr * $H * CELL * pr > 5.2e6) pr = 1;
    pixelRatio = pr;
    canvas.width = Math.round($W * CELL * pr); canvas.height = Math.round($H * CELL * pr);
    glResize();
  } else {
    pixelRatio = 1;
    canvas.width = $W; canvas.height = $H;
    R2.img = ctx2d.createImageData($W, $H);
    R2.px = new Uint32Array(R2.img.data.buffer);
    sceneDirty = true;
  }
}

export function renderFrame(timeMs, dt) {
  if (!syncState()) return;
  if (gl) renderGL(timeMs, dt); else render2D(timeMs);
}

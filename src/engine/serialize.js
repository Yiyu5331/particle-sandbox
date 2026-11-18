'use strict';
import { cmdLog } from './commands.js';
import { elecCount, elecCur, electricSet } from './electric.js';
import { WL, env } from './env.js';
import { exA, exActive, exCur, exN, exP, exPhase, exR, exRays, exX, exY, explosionSet } from './explosion.js';
import { F_BODY, F_SAVE, H, N, W, allocGrid, aux, charge, chargeE, chunkTTL, clearGrid, flags, fuel, gravity, gridSet, initFuel, life, parity, rippleHead, ripples, seed, setGravity, temp, tick, type, wakeAll, wet } from './grid.js';
import { M_RIGID, NT, PLANT, SOIL } from './materials.js';
import { fpAge, fpAlive, fpCount, fpHead, fpPX, fpPY, fpQX, fpQY, fpSeed, fpTemp, fpType, fpVX, fpVY, fpX, fpY, particlesSet } from './particles.js';
import { _rs, setRngState } from './rng.js';
import { sceneState, scenesSet } from './scenes.js';
import { slowPhase, slowSet } from './slow.js';
import { BODY_MAX, bodies, bodiesClear, bodyCount, fracTick, fracVX, fracVY, markStructAll, pinTick, sdCount, sdList, sdSeen, structCooldown, structDirty, structFull, structHold, structSettle, structStats, structureSet } from './structure.js';
import { cloud, heatC, lastBolt, setWeather, solidC, solidRow, updateSun, vapor, weatherSet, windShade, windX } from './weather.js';

/* =====================================================================
 * 2.14 场景编解码（撤销快照、存档、导入导出共用；RLE 压缩）
 * ===================================================================== */
export function rleEncode(src) {
  const n = src.length, out = new Uint8Array(n * 2 + 2);
  let p = 0, i = 0;
  while (i < n) {
    const v = src[i];
    let run = 1;
    while (run < 255 && i + run < n && src[i + run] === v) run++;
    out[p++] = run; out[p++] = v;
    i += run;
  }
  return out.slice(0, p);
}

export function rleDecode(buf, n) {
  const out = new Uint8Array(n);
  let p = 0;
  for (let q = 0; q + 1 < buf.length && p < n; q += 2) {
    const run = buf[q];
    out.fill(buf[q + 1], p, Math.min(n, p + run));
    p += run;
  }
  return out;
}

// 快照：类型整张 RLE；其余属性只存非空格子，按字节平面分别 RLE。
// 正在下落的刚体按当前位置存成普通固体；空气的温度、浑浊度和湿度场不存。
export function captureScene() {
  let cnt = 0;
  for (let i = 0; i < N; i++) if (type[i] !== 0) cnt++;
  const sd = new Uint8Array(cnt), tl = new Uint8Array(cnt), th = new Uint8Array(cnt),
        ll = new Uint8Array(cnt), lh = new Uint8Array(cnt), fl = new Uint8Array(cnt),
        w = new Uint8Array(cnt), x = new Uint8Array(cnt), ul = new Uint8Array(cnt), uh = new Uint8Array(cnt);
  for (let i = 0, k = 0; i < N; i++) {
    if (type[i] === 0) continue;
    let T = Math.round(temp[i]);
    T = (T < -32768 ? -32768 : T > 32767 ? 32767 : T) & 0xffff;
    const L = (flags[i] & F_BODY) ? 0 : life[i];
    sd[k] = seed[i]; tl[k] = T & 255; th[k] = T >> 8;
    ll[k] = L & 255; lh[k] = L >> 8; fl[k] = flags[i] & F_SAVE;
    w[k] = wet[i]; x[k] = aux[i]; ul[k] = fuel[i] & 255; uh[k] = fuel[i] >> 8;
    k++;
  }
  return { w: W, h: H, g: gravity, n: cnt, t: rleEncode(type), s: sd,
           tl: rleEncode(tl), th: rleEncode(th), ll: rleEncode(ll), lh: rleEncode(lh), f: rleEncode(fl),
           wt: rleEncode(w), ax: rleEncode(x), ul: rleEncode(ul), uh: rleEncode(uh),
           env: { time: env.time, timeScale: env.timeScale, temp: env.temp, wind: env.wind, windPower: env.windPower, weather: env.weather } };
}

// 还原到当前网格；尺寸不同的话按「底边居中」对齐，超出部分裁掉。v3 的存档没有含水量等字段，按默认值补。
export function restoreScene(s) {
  const src = rleDecode(s.t, s.w * s.h), n = s.n;
  const tl = rleDecode(s.tl, n), th = rleDecode(s.th, n), ll = rleDecode(s.ll, n), lh = rleDecode(s.lh, n), fl = rleDecode(s.f, n);
  const v4 = !!s.wt;
  const wt = v4 ? rleDecode(s.wt, n) : null, ax = v4 ? rleDecode(s.ax, n) : null,
        ul = v4 ? rleDecode(s.ul, n) : null, uh = v4 ? rleDecode(s.uh, n) : null;
  clearGrid();
  setGravity(s.g || 'down');
  if (s.env) {
    env.time = s.env.time; env.timeScale = s.env.timeScale; env.temp = s.env.temp; env.wind = s.env.wind;
    setWeather(s.env.weather || 'clear');
    env.temp = s.env.temp; env.windPower = s.env.windPower;
    updateSun();
  }
  const ox = ((W - s.w) / 2) | 0, oy = H - s.h;
  let k = 0;
  for (let y = 0; y < s.h; y++) {
    for (let x = 0; x < s.w; x++) {
      const t = src[x + y * s.w];
      if (t === 0) continue;
      const kk = k++;
      const X = x + ox, Y = y + oy;
      if (X < 0 || X >= W || Y < 0 || Y >= H || t >= NT) continue;
      const i = X + Y * W;
      let T = tl[kk] | (th[kk] << 8);
      if (T > 32767) T -= 65536;
      type[i] = t; seed[i] = s.s[kk]; temp[i] = T; life[i] = ll[kk] | (lh[kk] << 8); flags[i] = fl[kk] | (parity ^ 1);
      if (v4) { wet[i] = wt[kk]; aux[i] = ax[kk]; fuel[i] = ul[kk] | (uh[kk] << 8); }
      else { wet[i] = t === PLANT ? 60 : 0; aux[i] = M_RIGID[t] ? 255 : t === SOIL ? 200 : 0; fuel[i] = initFuel(t); }
    }
  }
  markStructAll();
  wakeAll();
}

export function bytesToB64(u8) {
  let s = '';
  for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000));
  return btoa(s);
}

export function b64ToBytes(b) {
  const s = atob(b), u8 = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) u8[i] = s.charCodeAt(i);
  return u8;
}

export const SCENE_STREAMS = ['t', 's', 'tl', 'th', 'll', 'lh', 'f', 'wt', 'ax', 'ul', 'uh'];

export function sceneToJSON(s) {
  const o = { app: 'particle-sandbox', v: 4, w: s.w, h: s.h, g: s.g, n: s.n, env: s.env };
  for (const k of SCENE_STREAMS) o[k] = bytesToB64(s[k]);
  return JSON.stringify(o);
}

export function sceneFromJSON(str) {
  const o = JSON.parse(str);
  if (!o || o.app !== 'particle-sandbox' || !(o.w > 0) || !(o.h > 0)) throw new Error('不是粒子沙盘的存档文件');
  const s = { w: o.w | 0, h: o.h | 0, g: o.g, n: o.n | 0, env: o.env || null };
  for (const k of SCENE_STREAMS) if (typeof o[k] === 'string') s[k] = b64ToBytes(o[k]);
  if (!s.t || !s.s) throw new Error('存档文件不完整');
  return s;
}

/* =====================================================================
 * 2.16 世界状态：哈希、完整存档、命令录制与回放
 *   · worldHash()        对所有会影响后续模拟的状态算一个 64 位哈希（16 位十六进制）
 *   · serializeWorld()   完整存档：格子、温度、含水量、湿度场、云、风场、刚体、飞行粒子、
 *                        爆炸池、带电列表、随机数状态、天气和时间……读档后继续跑，结果逐格一致
 *   · execCmd()          玩家的每一次操作都走这里，记成 {step, command, args}，可以回放
 *   诊断用的计数（水量账本、结构统计、渲染涟漪）进存档，但不进哈希。
 * ===================================================================== */

// ---- 哈希 ----
export let _h1 = 0, _h2 = 0;
export function hashReset() { _h1 = 0x811c9dc5 | 0; _h2 = 0x01000193 ^ 0x5bd1e995; }
export function hashWord(w) {
  _h1 = Math.imul(_h1 ^ w, 0x01000193);
  _h2 = Math.imul(_h2 ^ w, 0x5bd1e995); _h2 ^= _h2 >>> 15;
}
export const _hf = new Float64Array(1), _hu = new Uint32Array(_hf.buffer);
export function hashNum(v) { _hf[0] = v; hashWord(_hu[0]); hashWord(_hu[1]); }
export function hashStr(s) { hashWord(s.length); for (let i = 0; i < s.length; i++) hashWord(s.charCodeAt(i)); }
export function hashBytes(ta, len) {
  const u8 = new Uint8Array(ta.buffer, ta.byteOffset, len === undefined ? ta.byteLength : len * ta.BYTES_PER_ELEMENT);
  const n4 = u8.byteLength >> 2;
  hashWord(u8.byteLength);
  if ((u8.byteOffset & 3) === 0) {
    const u32 = new Uint32Array(u8.buffer, u8.byteOffset, n4);
    for (let i = 0; i < n4; i++) hashWord(u32[i]);
  } else for (let i = 0; i < n4; i++) hashWord(u8[i * 4] | (u8[i * 4 + 1] << 8) | (u8[i * 4 + 2] << 16) | (u8[i * 4 + 3] << 24));
  for (let i = n4 << 2; i < u8.byteLength; i++) hashWord(u8[i]);
}
export function hashValue(v) {
  if (v === null || v === undefined) { hashWord(0x7f7f7f7f); return; }
  if (typeof v === 'number') { hashNum(v); return; }
  if (typeof v === 'boolean') { hashWord(v ? 1 : 2); return; }
  if (typeof v === 'string') { hashStr(v); return; }
  if (ArrayBuffer.isView(v)) { hashBytes(v); return; }
  if (Array.isArray(v)) { hashWord(v.length); for (const x of v) hashValue(x); return; }
  const keys = Object.keys(v).sort();
  for (const k of keys) { hashStr(k); hashValue(v[k]); }
}
export function hex8(x) { return ('0000000' + (x >>> 0).toString(16)).slice(-8); }

// 参与哈希和存档的数组（顺序固定）。新增模拟状态时，在这里登记一行。
export function stateArrays() {
  return [
    ['type', type], ['seed', seed], ['flags', flags], ['charge', charge], ['chargeE', chargeE], ['wet', wet], ['aux', aux],
    ['fuel', fuel], ['life', life], ['temp', temp], ['chunkTTL', chunkTTL],
    ['windX', windX], ['heatC', heatC], ['vapor', vapor], ['cloud', cloud], ['solidC', solidC], ['windShade', windShade],
    ['fpAlive', fpAlive], ['fpType', fpType], ['fpSeed', fpSeed], ['fpAge', fpAge], ['fpTemp', fpTemp], ['fpX', fpX], ['fpY', fpY],
    ['fpVX', fpVX], ['fpVY', fpVY], ['fpPX', fpPX], ['fpPY', fpPY], ['fpQX', fpQX], ['fpQY', fpQY],
    ['exA', exA], ['exX', exX], ['exY', exY], ['exR', exR], ['exP', exP], ['exCur', exCur], ['exN', exN], ['exPhase', exPhase], ['exRays', exRays],
    ['sdList', sdList.subarray(0, sdCount)],
  ];
}

// 参与哈希和存档的标量
export function stateScalars() {
  return {
    W, H, tick, parity, gravity, rng: _rs, fpHead, fpCount, exActive, elecCount, slowPhase,
    structDirty, structFull, structCooldown, structHold, bodyCount, fracVX, fracVY, fracTick, pinTick, solidRow, sdCount, structSettle,
  };
}

export function bodyState(b) {
  const o = {};
  for (const k of Object.keys(b).sort()) o[k] = b[k];
  return o;
}

export function worldHash() {
  hashReset();
  hashValue(stateScalars());
  for (const [name, arr] of stateArrays()) { hashStr(name); hashBytes(arr); }
  hashBytes(elecCur === null ? new Int32Array(0) : elecCur.subarray(0, elecCount));
  for (let k = 0; k < BODY_MAX; k++) { const b = bodies[k]; if (b) { hashWord(k); hashValue(bodyState(b)); } }
  const e = {};
  for (const k of Object.keys(env)) e[k] = env[k];
  hashValue(e);
  hashValue(sceneState);
  return hex8(_h1) + hex8(_h2);
}

// ---- 完整存档 ----
export function taToB64(ta) { return bytesToB64(new Uint8Array(ta.buffer, ta.byteOffset, ta.byteLength)); }
export function b64ToTA(b64, Ctor) {
  const u8 = b64ToBytes(b64);
  const copy = new Uint8Array(u8.length); copy.set(u8);
  return new Ctor(copy.buffer, 0, copy.length / Ctor.BYTES_PER_ELEMENT);
}
export function encodeValue(v) {
  if (ArrayBuffer.isView(v)) return { $ta: v.constructor.name, b: taToB64(v) };
  return v;
}
export const TA_CTORS = { Uint8Array, Uint16Array, Int32Array, Uint32Array, Float32Array, Float64Array, Int16Array, Int8Array };
export function decodeValue(v) {
  if (v && typeof v === 'object' && v.$ta) return b64ToTA(v.b, TA_CTORS[v.$ta]);
  return v;
}

export function serializeWorld() {
  const arrays = {};
  for (const [name, arr] of stateArrays()) arrays[name] = taToB64(arr);
  arrays.elec = taToB64(elecCur === null ? new Int32Array(0) : elecCur.subarray(0, elecCount));
  arrays.ripples = taToB64(ripples);
  const bs = [];
  for (let k = 0; k < BODY_MAX; k++) {
    const b = bodies[k];
    if (!b) { bs.push(null); continue; }
    const o = {};
    for (const key of Object.keys(b)) o[key] = encodeValue(b[key]);
    bs.push(o);
  }
  return JSON.stringify({
    app: 'particle-sandbox', v: 41, kind: 'full', scalars: stateScalars(), env: Object.assign({}, env), sceneState,
    arrays, bodies: bs, ledger: Object.assign({}, WL), structStats: Object.assign({}, structStats), rippleHead,
    lastBolt, cmdLogLen: cmdLog.length,
  });
}

export function deserializeWorld(str) {
  const o = typeof str === 'string' ? JSON.parse(str) : str;
  if (!o || o.app !== 'particle-sandbox' || o.kind !== 'full') throw new Error('不是完整存档');
  const sc = o.scalars;
  allocGrid(sc.W, sc.H);
  setGravity(sc.gravity);                 // 先设重力：它会唤醒所有分块，必须在恢复分块状态之前
  const setArr = (dst, b64) => { const src = b64ToBytes(b64); new Uint8Array(dst.buffer, dst.byteOffset, dst.byteLength).set(src.subarray(0, dst.byteLength)); };
  for (const [name, arr] of stateArrays()) if (name !== 'sdList') setArr(arr, o.arrays[name]);
  const sd = b64ToTA(o.arrays.sdList, Int32Array);
  sdList.set(sd); structureSet('sdCount', sd.length);
  for (let k = 0; k < sdCount; k++) sdSeen[sdList[k]] = 1;
  const el = b64ToTA(o.arrays.elec, Int32Array);
  if (el.length > 0) { const ec = new Int32Array(N); ec.set(el); electricSet('elecCur', ec); electricSet('elecNext', new Int32Array(N)); }
  setArr(ripples, o.arrays.ripples);
  bodiesClear();
  for (let k = 0; k < o.bodies.length; k++) {
    const src = o.bodies[k];
    if (!src) continue;
    const b = {};
    for (const key of Object.keys(src)) b[key] = decodeValue(src[key]);
    bodies[k] = b;
  }
  gridSet('tick', sc.tick); gridSet('parity', sc.parity); setRngState(sc.rng);
  particlesSet('fpHead', sc.fpHead); particlesSet('fpCount', sc.fpCount); explosionSet('exActive', sc.exActive);
  electricSet('elecCount', el.length); slowSet('slowPhase', sc.slowPhase);
  for (const k of ['structDirty', 'structFull', 'structCooldown', 'structHold', 'bodyCount', 'fracVX', 'fracVY', 'fracTick', 'pinTick', 'structSettle']) structureSet(k, sc[k]);
  weatherSet('solidRow', sc.solidRow);
  for (const k of Object.keys(env)) delete env[k];
  Object.assign(env, o.env);
  scenesSet('sceneState', o.sceneState);
  Object.assign(WL, o.ledger); Object.assign(structStats, o.structStats);
  gridSet('rippleHead', o.rippleHead); weatherSet('lastBolt', o.lastBolt);
}

/* ---- 本模块的全部可变状态（多世界切换、读档用；由迁移脚本生成，新增 let 状态时记得加进来） ---- */
export function serializeSave() { return { _h1, _h2 }; }
export function serializeLoad(s) { ({ _h1, _h2 } = s); }
export function serializeSet(name, v) {
  switch (name) {
    case '_h1': _h1 = v; break;
    case '_h2': _h2 = v; break;
    default: throw new Error('serialize.js 没有可写的状态 ' + name);
  }
}

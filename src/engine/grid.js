'use strict';
import { electricSet } from './electric.js';
import { env, ledgerReset } from './env.js';
import { exClear } from './explosion.js';
import { AIRLIKE, EMPTY, M_ABSORB, M_BLAST, M_BURNTIME, M_LIFE0, M_LIFE1, M_RIGID, M_SPAWN, PLANT, SOIL, SPARK } from './materials.js';
import { fpClear } from './particles.js';
import { rnd, rndi } from './rng.js';
import { allocStruct, bodiesClear, markStructAll, markStructAround, sdList } from './structure.js';
import { allocWeather, clearWeather, weatherSet } from './weather.js';

export const CHUNK = 32;          // 分块边长
export const WAKE_TTL = 3;        // 被唤醒后至少再模拟几帧
export const SIM_HZ = 60;

/* ---------------------------------------------------------------------
 * 1.5 网格与分块
 * ------------------------------------------------------------------- */
export const F_PAR = 1, F_BURN = 2, F_SCORCH = 4, F_TIP = 8, F_BODY = 16, F_PIN = 32, F_FALL = 0xC0;   // flags 位
export const F_SAVE = F_BURN | F_SCORCH | F_TIP;
export const STALE_MAX = 200;     // 空气浑浊度到这个值就不够支持燃烧了

export let W = 0, H = 0, N = 0;
export let type, seed, flags, charge, chargeE, life, temp;
export let wet;                   // 含水量（非空格）
export let aux;                   // 空气格：浑浊度（缺氧程度）；刚性固体：结构完整度；土：养分
export let fuel;                  // 可燃格剩余燃料（帧）
export let CW = 0, CHN = 0, chunkTTL, chunkCount;
export let parity = 0, tick = 0;
export let gravity = 'down', gx = 0, gy = 1, lx = 1, ly = 0;
export let gridEpoch = 0;         // 网格被整体重建 / 清空 / 唤醒的次数：渲染层看到它变了就整张重传

export function allocGrid(w, h) {
  W = w; H = h; N = w * h;
  type = new Uint8Array(N); seed = new Uint8Array(N); flags = new Uint8Array(N);
  charge = new Uint8Array(N); chargeE = new Uint8Array(N);
  wet = new Uint8Array(N); aux = new Uint8Array(N); fuel = new Uint16Array(N);
  life = new Uint16Array(N); temp = new Float32Array(N).fill(env.temp);
  CW = Math.ceil(w / CHUNK); CHN = Math.ceil(h / CHUNK);
  chunkTTL = new Uint8Array(CW * CHN); chunkCount = new Uint16Array(CW * CHN);
  electricSet('elecCount', 0); fpClear(); exClear(); bodiesClear(); allocStruct(); allocWeather();
  wakeAll();
}

export function clearGrid() {
  type.fill(0); seed.fill(0); flags.fill(0); charge.fill(0); chargeE.fill(0); life.fill(0); temp.fill(env.temp);
  wet.fill(0); aux.fill(0); fuel.fill(0);
  electricSet('elecCount', 0); fpClear(); exClear(); bodiesClear(); clearWeather();
  env.waterIn = env.waterOut = env.waterSink = 0; env.rainCount = env.snowCount = env.strikes = 0; env.charge = 0;
  ledgerReset();
  ripples.fill(0); rippleHead = 0; weatherSet('lastBolt', null);      // 渲染用的涟漪和闪电记录也清掉
  markStructAll();
  wakeAll();
}

export function wakeAll() { chunkTTL.fill(WAKE_TTL); gridEpoch++; }

export function inb(x, y) { return x >= 0 && x < W && y >= 0 && y < H; }

export function wake(x, y) {
  const cx = x >> 5, cy = y >> 5, c = cx + cy * CW, ax = x & 31, ay = y & 31;
  chunkTTL[c] = WAKE_TTL;
  if (ax === 0) { if (cx > 0) chunkTTL[c - 1] = WAKE_TTL; }
  else if (ax === 31) { if (cx < CW - 1) chunkTTL[c + 1] = WAKE_TTL; }
  if (ay === 0) { if (cy > 0) chunkTTL[c - CW] = WAKE_TTL; }
  else if (ay === 31) { if (cy < CHN - 1) chunkTTL[c + CW] = WAKE_TTL; }
}

export function initLife(t) {
  const a = M_LIFE0[t];
  return a ? a + rndi(M_LIFE1[t] - a + 1) : 0;
}

// 燃料量：爆炸物的 burnTime 是引信（放在 life 里），其余可燃物是能烧多少帧
export function initFuel(t) {
  const bt = M_BURNTIME[t];
  return bt && !M_BLAST[t] ? Math.max(1, (bt * (0.7 + rnd() * 0.6)) | 0) : 0;
}

// 新生成一个粒子（笔刷、克隆、喷发等）
export function put(i, t, x, y) {
  const old = type[i];
  type[i] = t; seed[i] = rndi(256); temp[i] = M_SPAWN[t];
  life[i] = t === PLANT ? rndi(150) : initLife(t);      // 植物的 life 是年龄：起始年龄随机，免得整片同时老死
  flags[i] = parity | (t === SPARK ? F_TIP : 0); charge[i] = 0;
  wet[i] = t === PLANT ? 60 : 0; fuel[i] = initFuel(t);
  aux[i] = M_RIGID[t] ? 255 : t === SOIL ? 200 : (AIRLIKE[t] && AIRLIKE[old]) ? aux[i] : 0;   // 火焰和烟继承所在空气格的浑浊度
  if (M_RIGID[t] | M_RIGID[old]) markStructAround(i);
  wake(x, y);
}

// 清成空气，保留该格温度
export function clearCell(i, x, y) {
  const old = type[i];
  type[i] = 0; life[i] = 0; flags[i] = parity; charge[i] = 0; wet[i] = 0; fuel[i] = 0;
  if (!AIRLIKE[old]) aux[i] = 0;                     // 火焰 / 烟消失后，这格空气的浑浊度留着
  if (M_RIGID[old]) markStructAround(i);
  wake(x, y);
}

// 原地变成另一种材料，保留 seed、温度和含水量
export function morph(i, t, x, y) {
  if (t === EMPTY) { clearCell(i, x, y); return; }
  const o = type[i];
  type[i] = t; life[i] = initLife(t); flags[i] = (flags[i] & F_SCORCH) | parity;
  fuel[i] = initFuel(t);
  aux[i] = M_RIGID[t] ? (M_RIGID[o] ? aux[i] >> 1 : 255) : t === SOIL ? 255 : (AIRLIKE[t] && AIRLIKE[o]) ? aux[i] : 0;
  if (wet[i] > M_ABSORB[t]) wet[i] = M_ABSORB[t];
  if (M_RIGID[t] | M_RIGID[o]) markStructAround(i);
  wake(x, y);
}

export function swapCells(i, j, x, y, nx, ny) {
  let a = type[i]; type[i] = type[j]; type[j] = a;
  a = seed[i]; seed[i] = seed[j]; seed[j] = a;
  a = life[i]; life[i] = life[j]; life[j] = a;
  a = wet[i]; wet[i] = wet[j]; wet[j] = a;
  a = aux[i]; aux[i] = aux[j]; aux[j] = a;
  a = fuel[i]; fuel[i] = fuel[j]; fuel[j] = a;
  const fi = flags[i], fj = flags[j];
  flags[i] = (fj & ~F_PAR) | parity; flags[j] = (fi & ~F_PAR) | parity;
  const tf = temp[i]; temp[i] = temp[j]; temp[j] = tf;
  wake(x, y); wake(nx, ny);
}

export function setGravity(dir) {
  gravity = dir;
  if (dir === 'down') { gx = 0; gy = 1; lx = 1; ly = 0; }
  else if (dir === 'up') { gx = 0; gy = -1; lx = 1; ly = 0; }
  else if (dir === 'left') { gx = -1; gy = 0; lx = 0; ly = 1; }
  else { gx = 1; gy = 0; lx = 0; ly = 1; }
  if (sdList.length === N && N > 0) markStructAll();
  if (chunkTTL) wakeAll();
}

// 涟漪事件（只给渲染用）：最近 8 次有东西砸进液面的位置
export let ripples = new Float32Array(8 * 3);
export let rippleHead = 0;
export function addRipple(x, y) {
  const o = rippleHead * 3;
  ripples[o] = x; ripples[o + 1] = y; ripples[o + 2] = tick;
  rippleHead = (rippleHead + 1) & 7;
}

/* =====================================================================
 * 2. 模拟
 * ===================================================================== */
export const DX4 = [1, -1, 0, 0], DY4 = [0, 0, 1, -1];
export const DX8 = [1, -1, 0, 0, 1, 1, -1, -1], DY8 = [0, 0, 1, -1, 1, -1, 1, -1];

// 每个模拟步开头调用：翻转「本步已处理」的奇偶位，步数加一
export function advanceTick() { parity ^= 1; tick++; }

/* ---- 本模块的全部可变状态（多世界切换、读档用；由迁移脚本生成，新增 let 状态时记得加进来） ---- */
export function gridSave() { return { W, H, N, type, seed, flags, charge, chargeE, life, temp, wet, aux, fuel, CW, CHN, chunkTTL, chunkCount, parity, tick, gravity, gx, gy, lx, ly, gridEpoch, ripples, rippleHead }; }
export function gridLoad(s) { ({ W, H, N, type, seed, flags, charge, chargeE, life, temp, wet, aux, fuel, CW, CHN, chunkTTL, chunkCount, parity, tick, gravity, gx, gy, lx, ly, gridEpoch, ripples, rippleHead } = s); }
export function gridSet(name, v) {
  switch (name) {
    case 'W': W = v; break;
    case 'H': H = v; break;
    case 'N': N = v; break;
    case 'type': type = v; break;
    case 'seed': seed = v; break;
    case 'flags': flags = v; break;
    case 'charge': charge = v; break;
    case 'chargeE': chargeE = v; break;
    case 'life': life = v; break;
    case 'temp': temp = v; break;
    case 'wet': wet = v; break;
    case 'aux': aux = v; break;
    case 'fuel': fuel = v; break;
    case 'CW': CW = v; break;
    case 'CHN': CHN = v; break;
    case 'chunkTTL': chunkTTL = v; break;
    case 'chunkCount': chunkCount = v; break;
    case 'parity': parity = v; break;
    case 'tick': tick = v; break;
    case 'gravity': gravity = v; break;
    case 'gx': gx = v; break;
    case 'gy': gy = v; break;
    case 'lx': lx = v; break;
    case 'ly': ly = v; break;
    case 'gridEpoch': gridEpoch = v; break;
    case 'ripples': ripples = v; break;
    case 'rippleHead': rippleHead = v; break;
    default: throw new Error('grid.js 没有可写的状态 ' + name);
  }
}

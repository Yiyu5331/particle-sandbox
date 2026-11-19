'use strict';
import { burnStep, emitSmoke, hasOxygen, ignite, openSky } from './combustion.js';
import { addCharge } from './electric.js';
import { WL, env, st } from './env.js';
import { noteRule } from './events.js';
import { moveGas, moveLiquid, movePowder } from './fluids.js';
import { DX4, DX8, DY4, DY8, F_BODY, F_BURN, F_PAR, F_TIP, H, W, clearCell, flags, gx, gy, inb, life, morph, parity, put, seed, swapCells, temp, type, wake, wet } from './grid.js';
import { ANCHOR, CLONE, EMBER, FIRE, FOAM, ICE, LAVA, M_ABSORB, M_BLAST, M_BOIL, M_BOILINTO, M_DECAY, M_DECAYP, M_ELEC, M_FLAM, M_FLATENT, M_FREEZE, M_FREEZEINTO, M_IGN, M_LATENT, M_LATK, M_LIFE0, M_MELT, M_MELTINTO, M_RIGID, M_SAP, M_STATE, NT, PLANT, SALTWATER, SNOW, SPARK, STEAM, S_GAS, S_LIQUID, S_POWDER, VOID, WATER } from './materials.js';
import { growTip } from './plants.js';
import { rnd, rndi } from './rng.js';
import { HASRX, RX } from './rules.js';
import { markStructAround } from './structure.js';
import { vaporAdd } from './weather.js';
// 植物能不能长：要有光，气温也要在 2°C 以上
export function canGrow() { return env.sun >= 0.12 && env.ambient > 2; }

/* ---------------------------------------------------------------------
 * 2.4 特殊材料钩子（返回 true 表示这一格已经处理完）
 * ------------------------------------------------------------------- */
// 火焰和余烬舔到可燃物会把它烤热：火苗被风吹到哪边，火就往哪边蔓延
export function scorchNeighbors(x, y, heat) {
  for (let k = 0; k < 4; k++) {
    const nx = x + DX4[k], ny = y + DY4[k];
    if (nx < 0 || nx >= W || ny < 0 || ny >= H) continue;
    const j = nx + ny * W;
    if (M_FLAM[type[j]] > 0 && !(flags[j] & (F_BURN | F_BODY))) { temp[j] += heat; wake(nx, ny); }
  }
}
export function hookFire(x, y, i) { if (temp[i] < 700) temp[i] = 700; st.fire++; scorchNeighbors(x, y, 16); return false; }
export function hookEmber(x, y, i) { if (temp[i] < 600) temp[i] = 600; scorchNeighbors(x, y, 22); return false; }

export function hookLava(x, y, i) {
  if (rnd() < 0.002) {                               // 偶尔迸出余烬
    const nx = x - gx, ny = y - gy;
    if (inb(nx, ny) && type[nx + ny * W] === 0) put(nx + ny * W, EMBER, nx, ny);
  }
  return false;
}

// 水把贴着的吸水材料打湿，自己按量减少（100 单位含水量 = 一格水）
export function hookWater(x, y, i) {
  for (let k = 0; k < 4; k++) {
    const nx = x + DX4[k], ny = y + DY4[k];
    if (nx < 0 || nx >= W || ny < 0 || ny >= H) continue;
    const j = nx + ny * W, o = type[j];
    if (o === 0) continue;
    if (temp[j] > 120 && M_STATE[o] < S_LIQUID) { temp[j] -= 30; temp[i] += 8; wake(x, y); wake(nx, ny); }   // 水贴着高温的东西：把热量带走（自己会被烧开）
    const cap = M_ABSORB[o];
    if (cap === 0) continue;
    const w = wet[j];
    if (w >= cap || (flags[j] & F_BODY)) continue;
    wake(x, y);
    if (rnd() < 0.2) {
      const add = cap - w < 34 ? cap - w : 34;
      wet[j] = w + add;
      if (w <= 60 && w + add > 60) wake(nx, ny);
      if (rnd() * 100 < add) { clearCell(i, x, y); return true; }
    }
  }
  return false;
}

// 蒸汽碰到冷的表面直接凝成水珠
export function hookSteam(x, y, i) {
  if (rnd() > 0.25) return false;
  const k = rndi(4), nx = x + DX4[k], ny = y + DY4[k];
  if (nx < 0 || nx >= W || ny < 0 || ny >= H) return false;
  const j = nx + ny * W, o = type[j];
  if (o !== 0 && M_STATE[o] < S_LIQUID && temp[j] < 50 && rnd() < 0.3) {
    type[i] = WATER; life[i] = 0; flags[i] = parity; temp[i] = 60; WL.wallCondense++;
    wake(x, y);
    return true;
  }
  return false;
}

// 泡沫：浮在液面上不动，脚下空了才往下掉
export function hookFoam(x, y, i) {
  const bx = x + gx, by = y + gy;
  if (bx >= 0 && bx < W && by >= 0 && by < H && type[bx + by * W] === 0) swapCells(i, bx + by * W, x, y, bx, by);
  return true;
}

export function hookPlant(x, y, i) {
  if (flags[i] & F_TIP) { wake(x, y); if (rnd() < 0.06) growTip(x, y, i); return false; }
  const bx = x + gx, by = y + gy;
  if (bx >= 0 && bx < W && by >= 0 && by < H && type[bx + by * W] === 0) {
    for (let k = 0; k < 8; k++) {                    // 周围没有任何支撑才会落下
      const nx = x + DX8[k], ny = y + DY8[k];
      if (nx < 0 || nx >= W || ny < 0 || ny >= H) continue;
      const o = type[nx + ny * W];
      if (o !== 0 && M_STATE[o] < S_LIQUID) return false;
    }
    swapCells(i, bx + by * W, x, y, bx, by);
    return true;
  }
  return false;
}

export function hookClone(x, y, i) {
  let src = life[i];
  const k0 = rndi(4);
  if (!src) {                                          // 还没记住任何材料：锁定第一个碰到的
    for (let k = 0; k < 4; k++) {
      const kk = (k0 + k) & 3, nx = x + DX4[kk], ny = y + DY4[kk];
      if (nx < 0 || nx >= W || ny < 0 || ny >= H) continue;
      const o = type[nx + ny * W];
      if (o !== 0 && o !== CLONE && o !== VOID && o !== ANCHOR && !(flags[nx + ny * W] & F_BODY)) { src = o; break; }
    }
    if (!src) return false;
    life[i] = src;
  }
  wake(x, y);
  if (rnd() >= 0.1) return false;
  for (let k = 0; k < 4; k++) {
    const kk = (k0 + k) & 3, nx = x + DX4[kk], ny = y + DY4[kk];
    if (nx < 0 || nx >= W || ny < 0 || ny >= H) continue;
    if (type[nx + ny * W] === 0) { put(nx + ny * W, src, nx, ny); if (src === WATER || src === SALTWATER || src === STEAM || src === SNOW || src === ICE) WL.cloneIn++; return false; }
  }
  return false;
}

export function hookVoid(x, y, i) {
  wake(x, y);
  for (let n = 0; n < 10; n++) {
    const dx = rndi(11) - 5, dy = rndi(11) - 5, d2 = dx * dx + dy * dy;
    if (d2 === 0 || d2 > 25) continue;
    const px = x + dx, py = y + dy;
    if (px < 0 || px >= W || py < 0 || py >= H) continue;
    const j = px + py * W, o = type[j];
    if (o === 0 || o === VOID || o === ANCHOR || (flags[j] & F_BODY)) continue;
    if (d2 <= 2) { if (o === WATER || o === SALTWATER || o === SNOW || o === ICE || o === STEAM) WL.voidOut++; clearCell(j, px, py); continue; }
    if (rnd() < 0.6) {
      let sx = dx > 0 ? -1 : dx < 0 ? 1 : 0, sy = dy > 0 ? -1 : dy < 0 ? 1 : 0;
      const adx = dx < 0 ? -dx : dx, ady = dy < 0 ? -dy : dy;
      if (adx > 2 * ady) sy = 0; else if (ady > 2 * adx) sx = 0;
      const qx = px + sx, qy = py + sy, q = qx + qy * W, qt = type[q];
      if (qt === 0) { swapCells(j, q, px, py, qx, qy); if (M_RIGID[o]) { markStructAround(j); markStructAround(q); } }
      else if (qt === VOID) { if (o === WATER || o === SALTWATER || o === SNOW || o === ICE || o === STEAM) WL.voidOut++; clearCell(j, px, py); }
    }
  }
  return false;
}

export function hookSpark(x, y, i) {
  st.elec++;
  for (let k = 0; k < 4; k++) {
    const nx = x + DX4[k], ny = y + DY4[k];
    if (nx < 0 || nx >= W || ny < 0 || ny >= H) continue;
    const j = nx + ny * W, o = type[j];
    if (o === 0) continue;
    if (M_ELEC[o]) addCharge(j, 255);
    else if (M_FLAM[o] > 0) { temp[j] += 260; wake(nx, ny); }
  }
  const f = flags[i];
  if (f & F_TIP) {                                   // 只有「头」会继续向前窜并分叉，后面的留下来当亮线
    flags[i] = f & ~F_TIP;
    const L = life[i];
    if (L > 3) {
      const n = rnd() < 0.3 ? 2 : 1;
      for (let b = 0; b < n; b++) {
        const k = rndi(8), nx = x + DX8[k], ny = y + DY8[k];
        if (inb(nx, ny) && type[nx + ny * W] === 0) {
          const j = nx + ny * W;
          put(j, SPARK, nx, ny);
          life[j] = L - 1 - rndi(2);
        }
      }
    }
  }
  return false;
}

export const HOOK = new Array(NT).fill(null);
HOOK[FIRE] = hookFire; HOOK[EMBER] = hookEmber; HOOK[LAVA] = hookLava; HOOK[PLANT] = hookPlant;
HOOK[CLONE] = hookClone; HOOK[VOID] = hookVoid; HOOK[SPARK] = hookSpark;
HOOK[WATER] = hookWater; HOOK[SALTWATER] = hookWater; HOOK[STEAM] = hookSteam; HOOK[FOAM] = hookFoam;

/* ---------------------------------------------------------------------
 * 2.5 接触规则执行（规则本身在 1.3 的 RULES 表里）
 * ------------------------------------------------------------------- */
export function applyRule(r, i, j, x, y, nx, ny) {
  noteRule(r.idx, x, y);
  if (r.tag === 'hiss') st.hiss++;
  if (r.b2 !== r.b) {
    morph(j, r.b2, nx, ny);
    if (r.bT !== undefined) temp[j] = r.bT;
  }
  if (r.bDT !== undefined) { temp[j] += r.bDT; wake(nx, ny); }
  if (r.use && rnd() < r.use) { clearCell(i, x, y); return true; }
  if (r.aDT !== undefined) temp[i] += r.aDT;
  if (r.a2 !== r.a) {
    morph(i, r.a2, x, y);
    if (r.aT !== undefined) temp[i] = r.aT;
    return true;
  }
  return false;
}

/* ---------------------------------------------------------------------
 * 2.6 单格更新：烘干 → 相变 → 燃烧 → 寿命 → 钩子 → 接触规则 → 运动
 * ------------------------------------------------------------------- */
export function updateCell(x, y, i) {
  const t = type[i];
  let f = flags[i];
  if ((f & F_PAR) === parity) return;        // 本帧已经处理过（刚移动进来的）
  f ^= F_PAR; flags[i] = f;
  if (f & F_BODY) return;                    // 刚体盖的章，由刚体系统管
  let T = temp[i];

  // 湿的东西过了 100°C 先烘干：吸热、放出水汽，烘干之前点不着
  const w = wet[i];
  if (w > M_SAP[t] && T > 100) {
    wet[i] = w - 1; T -= 120; temp[i] = T;   // 汽化潜热很大：每烘掉 1 单位水分要吃掉 120°C，一个燃烧的邻格烤不干一块湿透的木头
    const d = 1;
    vaporAdd(x, y, d / 100); WL.evapWet += d / 100;
    wake(x, y);
    if (rnd() < 0.04) emitSmoke(x, y, 0);
  }

  // 温度相变
  if (T > M_MELT[t]) {
    const lat = M_LATENT[t];
    if (lat > 0) {                           // 有潜热的（冰、雪）：多出来的热量先攒着，攒够才融化
      const add = ((T - M_MELT[t]) * M_LATK[t]) | 0;
      temp[i] = M_MELT[t];
      if (add > 0) {
        const L = life[i] + add;
        if (L >= lat) { morph(i, M_MELTINTO[t], x, y); return; }
        life[i] = L; wake(x, y);
      }
    } else { morph(i, M_MELTINTO[t], x, y); return; }
  } else if (T > M_BOIL[t]) {
    morph(i, M_BOILINTO[t], x, y); temp[i] = T < 135 ? 160 : T + 25; st.boil++;
    return;
  } else if (T < M_FREEZE[t]) {
    if (t === STEAM) {
      if (openSky(x, y)) { clearCell(i, x, y); vaporAdd(x, y, 1); WL.steamToVapor++; }   // 头顶通着天：变成看不见的水汽升上去
      else { type[i] = WATER; life[i] = 0; flags[i] = parity; temp[i] = 60; WL.wallCondense++; wake(x, y); }   // 关在容器里：就地凝成水珠
      return;
    }
    const lat = M_FLATENT[t];
    if (lat > 0) {                           // 结冰要放出潜热：温度钉在冰点，放够了才变成冰
      const add = ((M_FREEZE[t] - T) * 4) | 0;
      temp[i] = M_FREEZE[t];
      if (add > 0) {
        const L = life[i] + add;
        if (L >= lat) { morph(i, M_FREEZEINTO[t], x, y); temp[i] = M_FREEZE[t] - 0.5; return; }
        life[i] = L; wake(x, y);
      }
    } else { morph(i, M_FREEZEINTO[t], x, y); return; }
  } else if (M_FLATENT[t] > 0 && life[i] > 0) life[i] = 0;    // 回暖了：结冰进度清零

  // 燃烧
  if (M_FLAM[t] > 0) {
    if (f & F_BURN) { if (burnStep(x, y, i, t, T)) return; }
    else if (T >= M_IGN[t] && wet[i] <= M_SAP[t] && (M_BLAST[t] || hasOxygen(x, y))) { if (rnd() < M_FLAM[t]) ignite(i, t, x, y); else wake(x, y); }
  }

  // 有寿命的（火、烟、余烬、电火花、泡沫）
  if (M_LIFE0[t] > 0) {
    const L = life[i];
    if (L <= 1) {
      if (rnd() < M_DECAYP[t]) { morph(i, M_DECAY[t], x, y); seed[i] = 90 + rndi(60); if (temp[i] > 200) temp[i] = 200; }
      else clearCell(i, x, y);
      return;
    }
    life[i] = L - 1;
    wake(x, y);
  }

  const hk = HOOK[t];
  if (hk !== null && hk(x, y, i)) return;

  if (HASRX[t]) {
    const base = t * NT;
    for (let k = 0; k < 4; k++) {
      const nx = x + DX4[k], ny = y + DY4[k];
      if (nx < 0 || nx >= W || ny < 0 || ny >= H) continue;
      const j = nx + ny * W, o = type[j];
      if (o === 0) continue;
      const r = RX[base + o];
      if (r === null || (flags[j] & F_BODY)) continue;
      wake(x, y);                            // 只要身边有能反应的对象，这一块就保持清醒
      if ((r.maxT === undefined || T < r.maxT) && rnd() < r.p) {     // 温度条件按这一步开始时的温度判断
        if (applyRule(r, i, j, x, y, nx, ny)) return;
      }
    }
  }

  switch (M_STATE[t]) {
    case S_POWDER: movePowder(x, y, i, t); break;
    case S_LIQUID: moveLiquid(x, y, i, t); break;
    case S_GAS: moveGas(x, y, i, t); break;
  }
}

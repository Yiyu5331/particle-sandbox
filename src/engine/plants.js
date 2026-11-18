'use strict';
import { canGrow } from './cells.js';
import { WL, env } from './env.js';
import { DX4, DX8, DY4, DY8, F_TIP, H, W, aux, clearCell, flags, fuel, gx, gy, inb, initFuel, life, lx, ly, parity, put, seed, type, wake, wet } from './grid.js';
import { FLOWER, M_RIGID, M_STATE, PLANT, SAND, SOIL, S_GAS, S_LIQUID, WATER } from './materials.js';
import { rnd } from './rng.js';
import { markStructAround } from './structure.js';

/* ---------------------------------------------------------------------
 * 2.3 植物：基因来自 seed 字节，整株共用
 *     低 4 位：株高上限 8~32 格；4-5 位：分叉概率；6-7 位：叶片密度
 * ------------------------------------------------------------------- */
export function plantLifespan(g) { return 2400 + (g & 15) * 160; }  // 寿命（慢速过程的轮次，约等于秒）：40~80 分钟
export function geneHeight(g) { return 8 + (((g & 15) * 1.6) | 0); }
export function geneBranch(g) { return 0.05 + ((g >> 4) & 3) * 0.05; }
export function geneLeaf(g) { return 0.3 + ((g >> 6) & 3) * 0.13; }

// 头顶 14 格内有没有被固体挡住，或者被别的枝叶遮得太厉害
export function skyOpen(x, y) {
  let leaves = 0;
  for (let k = 1; k <= 14; k++) {
    const nx = x - gx * k, ny = y - gy * k;
    if (nx < 0 || nx >= W || ny < 0 || ny >= H) return true;
    const o = type[nx + ny * W];
    if (o === PLANT || o === FLOWER) { if (++leaves > 7) return false; }
    else if (o !== 0 && M_STATE[o] < S_LIQUID) return false;
  }
  return true;
}

export function biomass(x, y, r) {
  let n = 0;
  for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
    const nx = x + dx, ny = y + dy;
    if (nx >= 0 && nx < W && ny >= 0 && ny < H && type[nx + ny * W] === PLANT) n++;
  }
  return n;
}

// 离地多高：顺着重力往下数，穿过空气和枝叶，直到碰到别的东西
export function stemHeight(x, y) {
  let n = 0;
  for (let k = 1; k <= 48; k++) {
    const nx = x + gx * k, ny = y + gy * k;
    if (nx < 0 || nx >= W || ny < 0 || ny >= H) break;
    const o = type[nx + ny * W];
    if (o !== 0 && o !== PLANT && o !== FLOWER) break;
    n++;
  }
  return n;
}

// 生长要用水：先从茎里的水分取，取不到就顺着茎往下找到根，从脚下的湿土或旁边的水里取。取不到就不长。
export function drawSap(x, y, need) {
  let cx = x, cy = y;
  for (let n = 0; n < 50; n++) {
    const c = cx + cy * W;
    if (wet[c] >= need) { wet[c] -= need; env.waterSink += need / 100; WL.plantUse += need / 100; return true; }
    const nx = cx + gx, ny = cy + gy;
    if (nx < 0 || nx >= W || ny < 0 || ny >= H) return false;
    if (type[nx + ny * W] === PLANT) { cx = nx; cy = ny; continue; }
    let found = false;
    for (let d = -1; d <= 1; d += 2) {
      const ax = nx + lx * d, ay = ny + ly * d;
      if (ax >= 0 && ax < W && ay >= 0 && ay < H && type[ax + ay * W] === PLANT) { cx = ax; cy = ay; found = true; break; }
    }
    if (found) continue;
    const b = nx + ny * W, o = type[b];
    if ((o === SOIL || o === SAND) && wet[b] >= need) { wet[b] -= need; env.waterSink += need / 100; WL.plantUse += need / 100; return true; }
    for (let k = 0; k < 4; k++) {
      const wx = cx + DX4[k], wy = cy + DY4[k];
      if (wx < 0 || wx >= W || wy < 0 || wy >= H || type[wx + wy * W] !== WATER) continue;
      if (rnd() * 100 < need) clearCell(wx + wy * W, wx, wy);
      env.waterSink += need / 100; WL.plantUse += need / 100;
      return true;
    }
    return false;
  }
  return false;
}

export function bloom(x, y, i) {
  flags[i] &= ~F_TIP;
  const g = seed[i], dens = geneLeaf(g);
  for (let k = 0; k < 8; k++) {                      // 展叶：每片叶子也要水
    const nx = x + DX8[k], ny = y + DY8[k];
    if (!inb(nx, ny) || type[nx + ny * W] !== 0 || rnd() > dens) continue;
    if (!drawSap(x, y, 6)) break;
    const j = nx + ny * W;
    put(j, PLANT, nx, ny); seed[j] = g; wet[j] = 10;
  }
}

export function growTip(x, y, i) {
  const e = life[i];
  if (e <= 0) { bloom(x, y, i); return; }
  if (!canGrow() || !skyOpen(x, y)) return;           // 没光、太冷都不长
  const g = seed[i];
  if (stemHeight(x, y) >= geneHeight(g)) { life[i] = 0; return; }   // 到株高上限了：停止长高，展叶
  const side = rnd() < 0.3 ? (rnd() < 0.5 ? 1 : -1) : 0;
  const alt = rnd() < 0.5 ? 1 : -1;
  for (let a = 0; a < 3; a++) {
    const sd = a === 0 ? side : a === 1 ? (side === 0 ? alt : 0) : (side === 0 ? -alt : -side);
    const nx = x - gx + lx * sd, ny = y - gy + ly * sd;
    if (!inb(nx, ny)) continue;
    const j = nx + ny * W, o = type[j];
    if (!(o === 0 || M_STATE[o] === S_GAS)) continue;
    if (biomass(nx, ny, 3) > 26) { life[i] = 0; return; }   // 太挤：不再长高
    if (!drawSap(x, y, 14)) return;                         // 没水：等着
    put(j, PLANT, nx, ny); flags[j] |= F_TIP; life[j] = e - 1; seed[j] = g; wet[j] = 10;
    flags[i] &= ~F_TIP; life[i] = 0;
    if (e > 4 && rnd() < geneBranch(g)) {                   // 分叉
      const bs = rnd() < 0.5 ? 1 : -1;
      const bx = x + lx * bs - gx, by = y + ly * bs - gy;
      if (inb(bx, by) && type[bx + by * W] === 0 && drawSap(x, y, 14)) {
        const bj = bx + by * W;
        put(bj, PLANT, bx, by); flags[bj] |= F_TIP; life[bj] = (e >> 1) + 1; seed[bj] = g; wet[bj] = 10;
      }
    }
    return;
  }
  life[i] = 0;                                              // 被挡住：直接展叶
}

export function sprout(i, x, y) {
  const wasRigid = M_RIGID[type[i]];
  type[i] = PLANT; flags[i] = parity | F_TIP; life[i] = geneHeight(seed[i]); wet[i] = 30; fuel[i] = initFuel(PLANT); aux[i] = 0;
  if (wasRigid) markStructAround(i);
  wake(x, y);
}

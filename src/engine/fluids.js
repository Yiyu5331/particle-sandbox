'use strict';
import { st } from './env.js';
import { F_FALL, H, W, addRipple, clearCell, flags, gx, gy, inb, lx, ly, put, seed, swapCells, temp, type, wake, wet } from './grid.js';
import { FOAM, LAVA, M_DENS, M_DISP, M_RIGID, M_SLIDE, M_STATE, M_VISC, M_WIND, NT, OIL, SINKP, SMOKE, SNOW, STONE, S_GAS, S_LIQUID, S_POWDER } from './materials.js';
import { FP_MAX, fpCount, spawnFree } from './particles.js';
import { rnd, rndi } from './rng.js';
import { markStruct } from './structure.js';
import { GW, windX } from './weather.js';

/* ---------------------------------------------------------------------
 * 2.1 运动：粉末 / 液体 / 气体。方向全部用重力向量 g 和侧向向量 l 表达，
 *     四个重力方向共用同一份代码。
 *     惯性的做法：连续下落会加速（每步最多 4 格）；高速砸到东西时，
 *     粒子（或被它挤开的液体）转成带浮点位置和速度的飞行粒子弹出去 → 飞溅、反弹。
 * ------------------------------------------------------------------- */
export function windPush(x, y, i, t, k) {
  const wv = windX[(x >> 3) + (y >> 3) * GW];
  if (wv !== 0 && rnd() < (wv < 0 ? -wv : wv) * k) {
    const nx = x + (wv > 0 ? 1 : -1);
    if (nx >= 0 && nx < W && type[nx + y * W] === 0) { swapCells(i, nx + y * W, x, y, nx, y); return true; }
  }
  return false;
}

export function foamAt(x, y) {
  for (let k = -1; k <= 1; k++) {
    const nx = x - gx + lx * k, ny = y - gy + ly * k;
    if (inb(nx, ny) && type[nx + ny * W] === 0) { put(nx + ny * W, FOAM, nx, ny); return; }
  }
}

// 高速砸进液面：被挤上来的那格液体变成水花飞出去，液面起涟漪和泡沫
export function splash(x, y, i, liquid) {
  addRipple(x, y);
  if (fpCount < FP_MAX - 200 && rnd() < 0.6) {
    spawnFree(liquid, x + 0.5, y + 0.5,
              lx * (rnd() - 0.5) * 2.6 - gx * (1 + rnd() * 1.6), ly * (rnd() - 0.5) * 2.6 - gy * (1 + rnd() * 1.6),
              temp[i], seed[i]);
    clearCell(i, x, y);
  }
  if (liquid !== LAVA && liquid !== OIL && rnd() < 0.3) foamAt(x, y);
}

export function movePowder(x, y, i, t) {
  let sp = flags[i] >> 6;                    // 连续下落帧数 → 每步多走几格
  if (t === SNOW) { sp = 0; if (rnd() < 0.45) { wake(x, y); return; } }   // 雪飘得慢
  let cx = x, cy = y, ci = i, moved = 0;
  const base = t * NT;
  for (let s = 0; s <= sp; s++) {
    const nx = cx + gx, ny = cy + gy;
    if (nx < 0 || nx >= W || ny < 0 || ny >= H) break;
    const j = nx + ny * W, o = type[j];
    if (o !== 0) {
      const so = M_STATE[o];
      if (so < S_LIQUID) break;
      if (so === S_LIQUID) {                 // 沉降速度看密度差和粘度；比液体轻就浮着
        const p = SINKP[base + o];
        if (p > 0) {
          if (rnd() < p) {
            swapCells(ci, j, cx, cy, nx, ny);
            if (sp >= 2) splash(cx, cy, ci, o);
            ci = j; cx = nx; cy = ny; moved = 2;
          } else wake(cx, cy);
        }
        break;
      }
    }
    swapCells(ci, j, cx, cy, nx, ny); ci = j; cx = nx; cy = ny; moved = 1;
  }
  if (moved) {
    flags[ci] = (flags[ci] & ~F_FALL) | (moved === 1 ? (sp < 3 ? sp + 1 : 3) << 6 : 0);
    st.powder++;
    const ux = x - gx, uy = y - gy;          // 原来压在它上面的如果是刚性固体，支撑关系可能变了
    if (ux >= 0 && ux < W && uy >= 0 && uy < H && M_RIGID[type[ux + uy * W]]) markStruct(ux + uy * W);
    if (moved === 1 && M_WIND[t] > 0) windPush(cx, cy, ci, t, M_WIND[t]);
    return;
  }
  if (sp) {
    flags[i] &= ~F_FALL;
    const ux = x - gx, uy = y - gy;
    if (sp === 3 && wet[i] <= 60 && fpCount < FP_MAX - 400 && rnd() < 0.12 &&
        ux >= 0 && ux < W && uy >= 0 && uy < H && type[ux + uy * W] === 0) {       // 高速落地、头顶是空的：弹起来
      const d = rnd() < 0.5 ? 1 : -1, v = 0.5 + rnd();
      spawnFree(t, x + 0.5, y + 0.5, lx * d * v - gx * (0.6 + rnd() * 0.8), ly * d * v - gy * (0.6 + rnd() * 0.8), temp[i], seed[i]);
      clearCell(i, x, y);
      return;
    }
  }
  // 滑落：侧下方要有 need 格深的落差才滑。松散粉末 1 格（约 45°），土 2 格（更陡），湿沙 4 格（近乎直立）
  const need = wet[i] > 60 ? 4 : M_SLIDE[t];
  const d = rnd() < 0.5 ? 1 : -1;
  for (let s = 0; s < 2; s++) {
    const dd = s ? -d : d;
    let ok = true, j1 = -1, x1 = 0, y1 = 0;
    for (let k = 1; k <= need; k++) {
      const nx = x + gx * k + lx * dd, ny = y + gy * k + ly * dd;
      if (nx < 0 || nx >= W || ny < 0 || ny >= H) { ok = false; break; }
      const j = nx + ny * W, o = type[j];
      if (k === 1) {
        if (!(o === 0 || M_STATE[o] >= S_GAS || rnd() < SINKP[base + o] * 0.7)) { ok = false; break; }
        j1 = j; x1 = nx; y1 = ny;
      } else if (!(o === 0 || M_STATE[o] >= S_LIQUID)) { ok = false; break; }
    }
    if (ok) { swapCells(i, j1, x, y, x1, y1); st.powder++; return; }
  }
}

// 液体能否沿重力方向挤进 o：空气、气体、更轻的液体、更轻的粉末（让灰浮上来）
export function liquidCanSink(t, o) {
  if (o === 0) return true;
  const so = M_STATE[o];
  if (so >= S_GAS) return true;
  if (so === S_LIQUID) return M_DENS[t] > M_DENS[o] && rnd() < 0.6;
  if (so === S_POWDER) return M_DENS[t] > M_DENS[o] && rnd() < 0.3;
  return false;
}

export function moveLiquid(x, y, i, t) {
  const sp = flags[i] >> 6, visc = M_VISC[t];
  if (visc > 0.5 && rnd() < visc * 0.3) { wake(x, y); return; }       // 很粘：这一帧整个不动
  let cx = x, cy = y, ci = i, moved = 0;
  for (let s = 0; s <= sp; s++) {
    const nx = cx + gx, ny = cy + gy;
    if (nx < 0 || nx >= W || ny < 0 || ny >= H) break;
    const j = nx + ny * W, o = type[j];
    if (!liquidCanSink(t, o)) break;
    const dense = o !== 0 && M_STATE[o] < S_GAS;
    swapCells(ci, j, cx, cy, nx, ny); ci = j; cx = nx; cy = ny;
    if (dense) { moved = 2; break; }
    moved = 1;
  }
  if (moved) {
    flags[ci] = (flags[ci] & ~F_FALL) | (moved === 1 ? (sp < 3 ? sp + 1 : 3) << 6 : 0);
    st.liquid++;
    if (moved === 1 && sp > 0 && visc < 0.3) windPush(cx, cy, ci, t, 0.5);   // 雨被风吹斜
    return;
  }
  if (sp) {
    flags[i] &= ~F_FALL;
    if (sp === 3 && visc < 0.5) {            // 高速落地
      const bx = x + gx, by = y + gy;
      const b = bx >= 0 && bx < W && by >= 0 && by < H ? type[bx + by * W] : STONE;
      if (M_STATE[b] === S_LIQUID) { addRipple(x, y); if (rnd() < 0.35) foamAt(x, y); }
      else if (fpCount < FP_MAX - 400 && rnd() < 0.25) {             // 砸在硬东西上：溅开
        const d = rnd() < 0.5 ? 1 : -1, v = 0.6 + rnd() * 1.2;
        spawnFree(t, x + 0.5, y + 0.5, lx * d * v - gx * (0.4 + rnd() * 0.9), ly * d * v - gy * (0.4 + rnd() * 0.9), temp[i], seed[i]);
        clearCell(i, x, y);
        return;
      }
    }
  }
  if (visc > 0 && rnd() < visc) return;      // 粘：这一帧不侧流

  const d = rnd() < 0.5 ? 1 : -1;
  for (let s = 0; s < 2; s++) {              // 斜下
    const dd = s ? -d : d;
    const nx = x + gx + lx * dd, ny = y + gy + ly * dd;
    if (nx < 0 || nx >= W || ny < 0 || ny >= H) continue;
    const j = nx + ny * W;
    if (liquidCanSink(t, type[j])) { swapCells(i, j, x, y, nx, ny); st.liquid++; return; }
  }
  const disp = M_DISP[t];
  for (let s = 0; s < 2; s++) {              // 侧向扩散：找得到落差才一定流，否则只是偶尔漂一下（水面能静下来）
    const dd = s ? -d : d;
    let best = -1, bx = 0, by = 0, drop = false;
    for (let k = 1; k <= disp; k++) {
      const nx = x + lx * dd * k, ny = y + ly * dd * k;
      if (nx < 0 || nx >= W || ny < 0 || ny >= H) break;
      const j = nx + ny * W, o = type[j];
      if (o !== 0 && M_STATE[o] < S_GAS) break;
      best = j; bx = nx; by = ny;
      const ux = nx + gx, uy = ny + gy;
      if (ux >= 0 && ux < W && uy >= 0 && uy < H) {
        const u = type[ux + uy * W];
        if (u === 0 || M_STATE[u] >= S_GAS || (M_STATE[u] === S_LIQUID && M_DENS[u] < M_DENS[t])) { drop = true; break; }
      }
    }
    if (best >= 0 && (drop || rnd() < 0.2)) { swapCells(i, best, x, y, bx, by); st.liquid++; return; }
  }
}

// 气体永远逆着重力走；会被风吹斜；能从液体里冒泡上去
export function moveGas(x, y, i, t) {
  if (t === SMOKE && rnd() < 0.3) return;
  if (windPush(x, y, i, t, M_WIND[t] * 0.9)) return;
  const r = rndi(3) - 1;
  let nx = x - gx + lx * r, ny = y - gy + ly * r;
  if (nx >= 0 && nx < W && ny >= 0 && ny < H) {
    const j = nx + ny * W, o = type[j];
    if (o === 0 || (M_STATE[o] === S_LIQUID && rnd() < 0.3) ||
        (M_STATE[o] === S_GAS && M_DENS[o] > M_DENS[t] && rnd() < 0.3)) {
      swapCells(i, j, x, y, nx, ny);
      return;
    }
  }
  const d = rnd() < 0.5 ? 1 : -1;
  nx = x + lx * d; ny = y + ly * d;
  if (nx >= 0 && nx < W && ny >= 0 && ny < H && type[nx + ny * W] === 0) swapCells(i, nx + ny * W, x, y, nx, ny);
}

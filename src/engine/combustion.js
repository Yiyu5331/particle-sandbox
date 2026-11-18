'use strict';
import { st } from './env.js';
import { startExplosion } from './explosion.js';
import { DX4, DY4, F_BURN, F_SCORCH, F_TIP, H, STALE_MAX, W, aux, clearCell, flags, fuel, gx, gy, inb, initFuel, life, lx, ly, morph, put, seed, temp, type, wake } from './grid.js';
import { AIRLIKE, EMBER, FIRE, M_BLAST, M_BPOW, M_BURNINTO, M_BURNTEMP, M_BURNTIME, M_FLAM, M_FLAME, M_IGN, M_RESIDUE, M_RIGID, M_STATE, OIL, SALTWATER, SMOKE, STEAM, S_GAS, WATER } from './materials.js';
import { FP_MAX, fpCount, spawnFree } from './particles.js';
import { rnd, rndi } from './rng.js';
import { markStructAround } from './structure.js';

/* ---------------------------------------------------------------------
 * 2.2 燃烧：燃料 + 热量 + 氧气
 * ------------------------------------------------------------------- */
// 逆着重力往上走 48 格，路上只有空气 / 气体就算「通着天」
export function openSky(x, y) {
  for (let k = 1; k <= 48; k++) {
    const nx = x - gx * k, ny = y - gy * k;
    if (nx < 0 || nx >= W || ny < 0 || ny >= H) return true;
    const o = type[nx + ny * W];
    if (o !== 0 && M_STATE[o] < S_GAS) return false;
  }
  return true;
}

// 旁边有没有还能支持燃烧的空气
export function hasOxygen(x, y) {
  for (let k = 0; k < 4; k++) {
    const nx = x + DX4[k], ny = y + DY4[k];
    if (nx < 0 || nx >= W || ny < 0 || ny >= H) continue;
    const j = nx + ny * W;
    if (AIRLIKE[type[j]] && aux[j] < STALE_MAX) return true;
  }
  return false;
}

export function ignite(i, t, x, y) {
  flags[i] = (flags[i] | F_BURN) & ~F_TIP;
  if (M_BLAST[t]) life[i] = M_BURNTIME[t];           // 引信
  else if (fuel[i] === 0) fuel[i] = initFuel(t);     // 只有从没装过燃料的才装；熄灭后剩多少就是多少
  wake(x, y);
}

export function emitFlame(x, y, t) {
  const r = rndi(3) - 1;
  let nx = x - gx + lx * r, ny = y - gy + ly * r;
  if (!(inb(nx, ny) && type[nx + ny * W] === 0)) {
    const k = rndi(4);
    nx = x + DX4[k]; ny = y + DY4[k];
    if (!(inb(nx, ny) && type[nx + ny * W] === 0)) return;
  }
  const j = nx + ny * W;
  put(j, FIRE, nx, ny);
  if (M_FLAME[t] > 0.3) life[j] += 18;       // 油：火焰更大
}

// kind：0 白烟（湿的东西 / 刚被浇灭），1 灰烟，2 黑烟（缺氧）
export function emitSmoke(x, y, kind) {
  let nx = x - gx, ny = y - gy;
  if (!(inb(nx, ny) && type[nx + ny * W] === 0)) {
    const k = rndi(4);
    nx = x + DX4[k]; ny = y + DY4[k];
    if (!(inb(nx, ny) && type[nx + ny * W] === 0)) return;
  }
  const j = nx + ny * W;
  put(j, SMOKE, nx, ny);
  seed[j] = kind === 0 ? rndi(50) : kind === 1 ? 90 + rndi(60) : 200 + rndi(56);
}

// 返回 true 表示这一格已经变成别的东西
export function burnStep(x, y, i, t, T) {
  wake(x, y);
  if (M_BLAST[t]) {                          // 爆炸物：F_BURN 表示引信在烧
    const L = life[i];
    if (L > 1) { life[i] = L - 1; return false; }
    clearCell(i, x, y); startExplosion(x, y, M_BLAST[t], M_BPOW[t]);
    return true;
  }
  let airJ = -1, airStale = 255, wetJ = -1, wx = 0, wy = 0;
  for (let k = 0; k < 4; k++) {
    const nx = x + DX4[k], ny = y + DY4[k];
    if (nx < 0 || nx >= W || ny < 0 || ny >= H) continue;
    const j = nx + ny * W, o = type[j];
    if (AIRLIKE[o]) { const s = aux[j]; if (s < airStale) { airStale = s; airJ = j; } }      // 空气，或者被火苗 / 烟占着的空气
    else if (o === WATER || o === SALTWATER) { wetJ = j; wx = nx; wy = ny; }
  }
  if (wetJ >= 0) {
    st.hiss++;
    if (t === OIL) {                         // 油火遇水：水瞬间汽化，把燃烧的油崩成飞溅的火滴
      if (rnd() < 0.25) {
        morph(wetJ, STEAM, wx, wy); temp[wetJ] = 160;
        if (fpCount < FP_MAX - 100) {
          spawnFree(OIL, x + 0.5, y + 0.5, lx * (rnd() - 0.5) * 3.2 - gx * (1.5 + rnd() * 2), ly * (rnd() - 0.5) * 3.2 - gy * (1.5 + rnd() * 2), 700, seed[i]);
          clearCell(i, x, y);
          return true;
        }
      }
    } else {                                 // 水吸热、汽化；降到燃点以下就熄灭
      T -= 150; temp[i] = T;
      if (rnd() < 0.5) { morph(wetJ, STEAM, wx, wy); temp[wetJ] = 160; }
      else temp[wetJ] += 25;
      if (T < M_IGN[t]) {
        flags[i] = (flags[i] & ~F_BURN) | F_SCORCH;
        emitSmoke(x, y, 0);
        return false;
      }
    }
  }
  if (airJ < 0 || airStale >= STALE_MAX) {          // 缺氧：不放热、不耗燃料，很快闷熄
    if (rnd() < 0.12) { flags[i] = (flags[i] & ~F_BURN) | F_SCORCH; if (rnd() < 0.5) emitSmoke(x, y, 2); }
    return false;
  }
  aux[airJ] = airStale + 3 > 255 ? 255 : airStale + 3;                    // 消耗氧气
  for (let k = 0; k < 4; k++) {                                           // 火焰直接烘烤贴着的可燃物
    const nx = x + DX4[k], ny = y + DY4[k];
    if (nx < 0 || nx >= W || ny < 0 || ny >= H) continue;
    const j = nx + ny * W;
    if (M_FLAM[type[j]] > 0 && !(flags[j] & F_BURN)) { temp[j] += 6; wake(nx, ny); }
  }
  const bt = M_BURNTEMP[t];
  if (T < bt) temp[i] = T + (bt - T) * 0.25;           // 燃烧放热
  if (rnd() < M_FLAME[t]) emitFlame(x, y, t);
  if (rnd() < 0.012) {                                 // 偶尔迸出一粒余烬，随风飘去点燃别处
    const ex = x - gx, ey = y - gy;
    if (ex >= 0 && ex < W && ey >= 0 && ey < H && type[ex + ey * W] === 0) put(ex + ey * W, EMBER, ex, ey);
  }
  if (rnd() < (airStale > 90 ? 0.06 : 0.012)) emitSmoke(x, y, airStale > 90 ? 2 : 1);   // 越缺氧烟越黑越浓
  const a = aux[i];
  if (M_RIGID[t] && a > 0) {                           // 烧焦的木头越来越不结实
    aux[i] = a > 2 ? a - 2 : 0;
    if ((a >= 70 && a - 2 < 70) || (a >= 91 && a - 2 < 91)) markStructAround(i);
  }
  const F = fuel[i];
  if (F > 1) { fuel[i] = F - 1; return false; }
  // 燃料烧完
  if (rnd() < M_RESIDUE[t]) morph(i, M_BURNINTO[t], x, y);
  else put(i, FIRE, x, y);
  return true;
}

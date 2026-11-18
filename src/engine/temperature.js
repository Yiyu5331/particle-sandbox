'use strict';
import { env } from './env.js';
import { CHN, CHUNK, CW, H, W, WAKE_TTL, aux, chunkTTL, temp, tick, type } from './grid.js';
import { AIRLIKE, KTAB, METAL, M_IHC, M_RELAX, NT, STEEL } from './materials.js';
import { markStructAround } from './structure.js';

/* ---------------------------------------------------------------------
 * 2.10 温度场 + 空气含氧：只在清醒的块里做成对交换（守恒、原地），
 *      再向环境气温缓慢回落。空气格之间还交换「浑浊度」，网格边缘是开阔大气（恒为新鲜）。
 * ------------------------------------------------------------------- */
export function stepThermal() {
  const NTn = NT, K = KTAB, IHC = M_IHC, RLX = M_RELAX, amb = env.ambient;
  for (let cy = 0; cy < CHN; cy++) {
    for (let cx = 0; cx < CW; cx++) {
      const c = cx + cy * CW;
      if (chunkTTL[c] === 0) continue;
      const x0 = cx << 5, x1 = Math.min(W, x0 + CHUNK), y0 = cy << 5, y1 = Math.min(H, y0 + CHUNK);
      let active = false, right = false, down = false;
      for (let y = y0; y < y1; y++) {
        const hasDown = y + 1 < H, edgeY = y === 0 || y === H - 1;
        for (let x = x0, i = y * W + x0; x < x1; x++, i++) {
          const a = type[i];
          let Ti = temp[i];
          if (AIRLIKE[a]) {                  // 空气（含火焰 / 烟占着的）：浑浊度扩散
            if (edgeY || x === 0 || x === W - 1) aux[i] = 0;
            else {
              if (AIRLIKE[type[i + 1]]) { const d = aux[i + 1] - aux[i]; if (d > 3 || d < -3) { const q = d >> 2; aux[i] += q; aux[i + 1] -= q; } }
              if (AIRLIKE[type[i + W]]) { const d = aux[i + W] - aux[i]; if (d > 3 || d < -3) { const q = d >> 2; aux[i] += q; aux[i + W] -= q; } }
            }
          } else if (Ti > 900 && (a === METAL || a === STEEL) && (tick & 31) === 0) markStructAround(i);   // 烧软的金属：重新评估
          if (x + 1 < W) {
            const d = temp[i + 1] - Ti;
            if (d > 0.5 || d < -0.5) {
              const b = type[i + 1], fl = d * K[a * NTn + b];
              Ti += fl * IHC[a]; temp[i + 1] -= fl * IHC[b];
              if (fl > 0.3 || fl < -0.3) { active = true; if (x + 1 === x1) right = true; }
            }
          }
          if (hasDown) {
            const j = i + W, d = temp[j] - Ti;
            if (d > 0.5 || d < -0.5) {
              const b = type[j], fl = d * K[a * NTn + b];
              Ti += fl * IHC[a]; temp[j] -= fl * IHC[b];
              if (fl > 0.3 || fl < -0.3) { active = true; if (y + 1 === y1) down = true; }
            }
          }
          const r = RLX[a];
          if (r > 0) {
            const d = (amb - Ti) * r;
            Ti += d;
            if (d > 0.08 || d < -0.08) active = true;
          }
          temp[i] = Ti;
        }
      }
      if (active) chunkTTL[c] = WAKE_TTL;
      if (right && cx + 1 < CW) chunkTTL[c + 1] = WAKE_TTL;
      if (down && cy + 1 < CHN) chunkTTL[c + CW] = WAKE_TTL;
    }
  }
}

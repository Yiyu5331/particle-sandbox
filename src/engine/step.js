'use strict';
import { updateCell } from './cells.js';
import { stepElectric } from './electric.js';
import { stepExplosions } from './explosion.js';
import { CHN, CHUNK, CW, H, W, advanceTick, chunkTTL, gx, gy, type } from './grid.js';
import { stepFree } from './particles.js';
import { rnd } from './rng.js';
import { stepScene } from './scenes.js';
import { slowTick } from './slow.js';
import { stepStructure } from './structure.js';
import { stepThermal } from './temperature.js';
import { stepWeather } from './weather.js';

/* ---------------------------------------------------------------------
 * 2.12 主步进：60Hz 固定步长。扫描顺序从「重力下游」开始，逐行（或逐列）
 *      跳过休眠的块，每行随机左右方向。
 * ------------------------------------------------------------------- */
export let perf = { cells: 0, thermal: 0, misc: 0, struct: 0, weather: 0, slow: 0, pack: 0, draw: 0, post: 0, gpu: 0,
               steps: 0, frames: 0, activeChunks: 0 };
export let simStepsTotal = 0;

export function sweepCells() {
  if (gy !== 0) {
    const start = gy > 0 ? H - 1 : 0, end = gy > 0 ? -1 : H, inc = gy > 0 ? -1 : 1;
    for (let y = start; y !== end; y += inc) {
      const crow = (y >> 5) * CW, row = y * W;
      if (rnd() < 0.5) {
        for (let cx = 0; cx < CW; cx++) {
          if (chunkTTL[crow + cx] === 0) continue;
          const x0 = cx << 5, x1 = Math.min(W, x0 + CHUNK);
          for (let x = x0; x < x1; x++) if (type[row + x] !== 0) updateCell(x, y, row + x);
        }
      } else {
        for (let cx = CW - 1; cx >= 0; cx--) {
          if (chunkTTL[crow + cx] === 0) continue;
          const x0 = cx << 5, x1 = Math.min(W, x0 + CHUNK);
          for (let x = x1 - 1; x >= x0; x--) if (type[row + x] !== 0) updateCell(x, y, row + x);
        }
      }
    }
  } else {
    const start = gx > 0 ? W - 1 : 0, end = gx > 0 ? -1 : W, inc = gx > 0 ? -1 : 1;
    for (let x = start; x !== end; x += inc) {
      const ccol = x >> 5;
      if (rnd() < 0.5) {
        for (let cy = 0; cy < CHN; cy++) {
          if (chunkTTL[ccol + cy * CW] === 0) continue;
          const y0 = cy << 5, y1 = Math.min(H, y0 + CHUNK);
          for (let y = y0; y < y1; y++) if (type[x + y * W] !== 0) updateCell(x, y, x + y * W);
        }
      } else {
        for (let cy = CHN - 1; cy >= 0; cy--) {
          if (chunkTTL[ccol + cy * CW] === 0) continue;
          const y0 = cy << 5, y1 = Math.min(H, y0 + CHUNK);
          for (let y = y1 - 1; y >= y0; y--) if (type[x + y * W] !== 0) updateCell(x, y, x + y * W);
        }
      }
    }
  }
}

// 分析用的计时器由宿主注入（页面里是 performance.now）。模拟代码自己不读任何时钟
export let simClock = null;
export function setSimClock(fn) { simClock = fn; }

export function simStep() {
  advanceTick(); simStepsTotal++;
  const clk = simClock;
  const t0 = clk ? clk() : 0;
  let act = 0;
  for (let c = 0, n = chunkTTL.length; c < n; c++) {
    const v = chunkTTL[c];
    if (v > 0) { chunkTTL[c] = v - 1; if (v > 1) act++; }
  }
  perf.activeChunks = act;
  stepScene();
  stepWeather();
  const t1 = clk ? clk() : 0;
  stepExplosions();
  stepElectric();
  const t2 = clk ? clk() : 0;
  stepStructure();
  const t3 = clk ? clk() : 0;
  sweepCells();
  const t4 = clk ? clk() : 0;
  stepThermal();
  const t5 = clk ? clk() : 0;
  stepFree();
  const t6 = clk ? clk() : 0;
  slowTick();
  const t7 = clk ? clk() : 0;
  perf.weather += t1 - t0; perf.misc += (t2 - t1) + (t6 - t5); perf.struct += t3 - t2;
  perf.cells += t4 - t3; perf.thermal += t5 - t4; perf.slow += t7 - t6; perf.steps++;
}

/* ---- 本模块的全部可变状态（多世界切换、读档用；由迁移脚本生成，新增 let 状态时记得加进来） ---- */
export function stepSave() { return { perf, simStepsTotal, simClock }; }
export function stepLoad(s) { ({ perf, simStepsTotal, simClock } = s); }
export function stepSet(name, v) {
  switch (name) {
    case 'perf': perf = v; break;
    case 'simStepsTotal': simStepsTotal = v; break;
    case 'simClock': simClock = v; break;
    default: throw new Error('step.js 没有可写的状态 ' + name);
  }
}

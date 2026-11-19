'use strict';
import { SAND, TNT, WATER, createWorld } from '../engine/index.js';
import { gl, renderFrame } from '../render/renderer.js';
/* 冷启动热身：加载时在一个看不见的小世界里先跑一遍爆炸、倒塌、闪电，让 JIT 把这些代码路径都编译好。
 * 用的是独立的世界（createWorld），跑完就扔，不影响任何一局的确定性。 */

export let warmMs = 0;
export function warmUp() {
  const t0 = performance.now();
  const w = createWorld({ width: 200, height: 130, seed: 7 });
  w.setRecording(false);
  w.exec('loadScene', { index: 4 });                       // 爆破拆除：导爆索、TNT、刚体、倒塌
  w.exec('setWeather', { key: 'storm' });
  w.exec('setEnv', { key: 'structure', value: true });
  w.exec('setEnv', { key: 'time', value: 0.9 });
  w.exec('fillRect', { mat: WATER, x0: 0, y0: 112, x1: 199, y1: 118 });
  w.exec('fillRect', { mat: SAND, x0: 0, y0: 119, x1: 199, y1: 129 });
  for (let k = 0; k < 4; k++) { const x = 30 + k * 40; w.exec('fillRect', { mat: TNT, x0: x, y0: 124, x1: x + 1, y1: 125 }); w.exec('ignite', { x, y: 124 }); }
  for (let s = 0; s < 360; s++) { w.step(1); if (s % 90 === 30) w.exec('lightning', { x: 20 + (s % 160) }); }
  w.hash(); w.serialize(); w.snapshot();
  w.dispose();
  warmMs = performance.now() - t0;
}

// 着色器热身：在真实画布上画几帧（第一次画会编译 / 链接着色器）
export function warmRender() { for (let k = 0; k < 3; k++) renderFrame(performance.now(), 16.7); if (gl) gl.finish(); }

'use strict';
import { warmUpEngine } from '../engine/index.js';
/* 冷启动热身：引擎在一个看不见的临时世界里先跑一遍爆炸、倒塌、闪电（warmUpEngine），让 JIT 把这些路径编译好。
 * 不影响任何一局的确定性。着色器热身在 main.js 的 warmRender。 */

export let warmMs = 0;
export function warmUp() {
  const t0 = performance.now();
  warmUpEngine();
  warmMs = performance.now() - t0;
}

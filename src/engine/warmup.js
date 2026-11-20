'use strict';
import { createWorld } from './world.js';
/* 冷启动热身（引擎内部）：在一个临时世界里跑一遍爆炸、倒塌、闪电，让 JIT 把这些路径都编译好。
 * 内容和 v4.1 的热身一样（建筑 + 导爆索 + 埋在沙里的 TNT + 雷暴），只是放在独立的世界里，跑完就扔，
 * 不影响任何一局的确定性。宿主通过 index.js 的 warmUpEngine() 调用。 */

export function warmUpEngine() {
  const w = createWorld({ width: 200, height: 130, seed: 7 });
  w.setRecording(false);
  w._warm();
  w.hash(); w.serialize(); w.snapshot();
  w.dispose();
}

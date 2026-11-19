'use strict';
import { SCENES } from './engine/index.js';
import { buildMenu, registerMode, startLoop, startMode } from './game/manager.js';
import { warmRender, warmUp } from './game/warmup.js';
import { civModeDef } from './modes/civ/index.js';
import { defenseModeDef } from './modes/defense/index.js';
import { ecoModeDef } from './modes/eco/index.js';
import { puzzleModeDef } from './modes/puzzle/index.js';
import { sandboxModeDef } from './modes/sandbox/index.js';
import { createRenderer } from './render/renderer.js';
import { $, QS, toast } from './ui/host.js';
import { benchInPage, coldBoom, goldenInPage, runAllTests, soakInPage } from '../tests/browser/devtools.js';
/* =====================================================================
 * 启动：建渲染器 → 冷启动热身 → 注册模式 → 进入沙盘（或 ?mode=）→ 主循环。
 * 浏览器测试入口：?test=1 / ?soak=1 / ?bench=1 / ?golden=1 / ?coldboom=1（加 &nowarm=1 不热身）。
 * ===================================================================== */
import '../tests/suites/v3.js';
import '../tests/suites/v4.js';
import '../tests/suites/v41.js';
import '../tests/suites/api.js';
import '../tests/browser/gl.js';
import '../tests/browser/golden.js';

function main() {
  createRenderer($('viewport'));
  if (!QS.has('nowarm')) warmUp();
  for (const def of [sandboxModeDef, defenseModeDef, puzzleModeDef, civModeDef, ecoModeDef]) registerMode(def);
  buildMenu();
  const params = {};
  const devtool = ['test', 'coldboom', 'soak', 'bench', 'golden'].some(k => QS.has(k));
  if (!devtool && QS.has('scene')) params.scene = Math.max(0, Math.min(SCENES.length - 1, (+QS.get('scene') || 1) - 1));
  startMode(QS.get('mode') || 'sandbox', params);
  if (!QS.has('nowarm')) warmRender();
  if (QS.has('test')) setTimeout(runAllTests, 400);
  else if (QS.has('coldboom')) setTimeout(coldBoom, 50);
  else if (QS.has('soak')) setTimeout(soakInPage, 400);
  else if (QS.has('bench')) setTimeout(benchInPage, 400);
  else if (QS.has('golden')) setTimeout(goldenInPage, 400);
  else if (!QS.has('scene')) toast('左键绘制 · 右键擦除 · 「场景」里有 10 个预设 · M 打开主菜单');
  startLoop();
}
main();

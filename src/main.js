'use strict';
import { SCENES } from './engine/index.js';
import { game, registerMode, startLoop } from './game/manager.js';
import { uiHudMode } from './ui/hud.js';
import { uiApplication } from './ui/application.js';
import { createProfileStore } from './meta/profile/index.js';
import { createMemoryStorage, openProfileStorage } from './meta/profile/storage.js';
import { applySandboxProfile } from './modes/sandbox/ui.js';
import { openMapgenPage } from './ui/mapgen.js';
import { uiDemoMode } from './ui/demo.js';
import { warmUp } from './game/warmup.js';
import { civModeDef } from './modes/civ/index.js';
import { defenseModeDef } from './modes/defense/index.js';
import { ecoModeDef } from './modes/eco/index.js';
import { puzzleModeDef } from './modes/puzzle/index.js';
import { sandboxModeDef } from './modes/sandbox/index.js';
import { createRenderer, gl, renderFrame } from './render/renderer.js';
import { $, QS, toast } from './ui/host.js';
import { benchInPage, coldBoom, goldenInPage, runAllTests, soakInPage } from '../tests/browser/devtools.js';
/* =====================================================================
 * 启动：建渲染器 → 冷启动热身 → 注册模式 → 进入主菜单（或指定模式）→ 主循环。
 * 浏览器测试入口：?test=1 / ?soak=1 / ?bench=1 / ?golden=1 / ?coldboom=1（加 &nowarm=1 不热身）。
 * ===================================================================== */
import '../tests/suites/v3.js';
import '../tests/suites/v4.js';
import '../tests/suites/v41.js';
import '../tests/suites/api.js';
import '../tests/browser/gl.js';
import '../tests/browser/mapgen.js';
import '../tests/browser/golden.js';

// 着色器热身：在真实画布上画几帧（第一次画会编译 / 链接着色器）
function warmRender() { for (let k = 0; k < 3; k++) renderFrame(performance.now(), 16.7); if (gl) gl.finish(); }

async function main() {
  if (QS.get('dev') === '1' && QS.get('mapgen') === '1') { openMapgenPage(); return; }
  const { screens, hud, launch, ready } = uiApplication();
  // 在同步热身前给浏览器一次实际绘制进度的机会。
  const stage = async (n, label) => {
    screens.loading(n, label);
    await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
  };
  await stage(0, '初始化画布');
  createRenderer($('viewport'));
  await stage(25, '引擎热身');
  if (!QS.has('nowarm')) warmUp();
  await stage(50, '准备模式');
  for (const def of [sandboxModeDef, defenseModeDef, puzzleModeDef, civModeDef, ecoModeDef]) registerMode(uiHudMode(def,hud));
  registerMode(uiDemoMode);
  const params = {};
  const devtool = ['test', 'coldboom', 'soak', 'bench', 'golden'].some(k => QS.has(k));
  try {
    const adapter = devtool ? createMemoryStorage() : await openProfileStorage();
    game.profile = createProfileStore(adapter, {onWarning:toast});
    applySandboxProfile(await game.profile.readProfile());
  } catch (e) { game.profile = null; toast(e.message); }
  if (!devtool && QS.has('scene')) params.scene = Math.max(0, Math.min(SCENES.length - 1, (+QS.get('scene') || 1) - 1));
  const first = QS.get('mode') || (devtool || QS.has('scene') ? 'sandbox' : 'home');
  launch(first, params);
  await stage(75, '渲染热身');
  if (!QS.has('nowarm')) warmRender();
  await stage(100, '就绪');
  ready();
  if (QS.has('test')) setTimeout(runAllTests, 400);
  else if (QS.has('coldboom')) setTimeout(coldBoom, 50);
  else if (QS.has('soak')) setTimeout(soakInPage, 400);
  else if (QS.has('bench')) setTimeout(benchInPage, 400);
  else if (QS.has('golden')) setTimeout(goldenInPage, 400);
  else if (first === 'sandbox' && !QS.has('scene')) toast('左键绘制 · 右键擦除 · 「场景」里有 10 个预设 · M 打开主菜单');
  startLoop();
}
main();

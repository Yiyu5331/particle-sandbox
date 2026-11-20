'use strict';
import { audioBoom, audioThunder } from '../../audio/audio.js';
import { SAND, thunderDelay } from '../../engine/index.js';
import { OUTCOME_PLAYING } from '../../game/mode.js';
import { V, bindKeys, bindPointer, bindResize, buildControls, buildEnvPanel, buildPalette, closePops, hud, loadScene, playbackTick, pointer, selectTool, sbxReleaseInput, setUIActive, setUIWorld, settingBoxes, stamp, stopPlayback, syncEnvUI, syncGravityUI, syncPauseUI, resetUndo, updateHud, world } from './ui.js';
import { R, fxBoom, fxThunder, gl, pixelRatio, resizeRenderer, settings } from '../../render/renderer.js';
import { $, CELL, QS, toast } from '../../ui/host.js';
/* =====================================================================
 * 沙盘模式：v4 的完整玩法。界面在 ui.js；这里把它接到模式接口上。
 * 世界在离开模式时不销毁，回来接着玩。
 * ===================================================================== */

let built = false, kept = null;

export const sandboxModeDef = {
  id: 'sandbox', name: '沙盘', desc: '自由放材料、10 个预设场景、天气、结构力学、存档、录制与回放',
  create() { return createSandbox(); },
};

function createSandbox() {
  let ctx = null, unsubPause = null, frameT0 = 0, frameNo = 0, slowGpu = 0;
  return {
    id: 'sandbox', name: '沙盘',
    init(c, params) {
      ctx = c;
      let w = kept;
      if (!w || params.fresh) {
        if (w) w.dispose();
        resetUndo();
        const stage = $('stage');
        const gw = Math.max(48, Math.floor(stage.clientWidth / CELL)), gh = Math.max(48, Math.floor(stage.clientHeight / CELL));
        // 这一局的种子：地址栏 ?seed= 指定，否则随机。种子 + 录制下来的命令 = 能逐格复现的一局
        const seed = params.seed !== undefined ? params.seed : QS.has('seed') ? (+QS.get('seed') | 0) : ((Math.random() * 2147483647) | 0) || 1;
        w = c.createWorld({ width: gw, height: gh, seed });
        w.setFxHooks({
          onBoom: (x, y, R, P) => { fxBoom(x, y, R, P); audioBoom(P * R / 15); },
          onThunder: (x, y) => { fxThunder(); audioThunder(thunderDelay(x, y)); },      // 先闪后响，离得越远响得越晚
        });
        w.setProfiler(() => performance.now());           // 只给调试面板计时用，模拟本身不读时钟
        kept = w;
      }
      setUIWorld(w);
      c.setWorld(w);
      if (!built) { buildPalette(); selectTool(SAND); buildControls(); buildEnvPanel(); bindPointer(); bindKeys(); bindResize(); built = true; }
      setUIActive(true);
      syncGravityUI(); syncEnvUI(); syncPauseUI();
      unsubPause = c.bus.on('pause', syncPauseUI);
      if (params.scene !== undefined) loadScene(params.scene);
    },
    frameTiming(dt) {
      if (dt > 0 && dt < 5000) hud.interval += (dt - hud.interval) * 0.15;
      hud.frames++; V.perf.frames++;
    },
    preFrame() {
      frameT0 = performance.now();
      if (pointer.down && !pointer.line && !$('app').inert) stamp(pointer.x, pointer.y, pointer.erase);     // 按住不动也持续出料
    },
    beforeStep() { playbackTick(); },                    // 回放录制：把这一步该执行的命令喂进去
    update() {},
    onEvent() {},
    postRender() {
      const perf = V.perf;
      if (gl && frameNo % 30 === 0) {                    // 每 30 帧抽样一次真实 GPU 耗时
        const g0 = performance.now();
        gl.finish();
        perf.gpu += (performance.now() - g0 - perf.gpu) * 0.5;
        if (settings.hd && pixelRatio > 1 && perf.gpu > 13 && !document.hidden) {
          if (++slowGpu >= 6) {                          // GPU 持续吃紧：自动降到 1x 渲染
            settings.hd = false; slowGpu = 0;
            resizeRenderer();
            if (settingBoxes.hd) settingBoxes.hd.checked = false;
            toast('已自动关闭高清渲染以保持帧率');
          }
        } else slowGpu = 0;
      }
      frameNo++;
      hud.work += (performance.now() - frameT0 - hud.work) * 0.1;
    },
    postFrame(now) { updateHud(now); },
    getHUD() { return null; },
    checkOutcome() { return OUTCOME_PLAYING; },
    serialize() { return { world: world.serialize() }; },
    deserialize(o) { if (o && o.world) world.deserialize(o.world); syncGravityUI(); syncEnvUI(); },
    dispose() {
      if (unsubPause) unsubPause();
      stopPlayback(false);
      closePops();
      sbxReleaseInput();
      setUIActive(false);
    },
  };
}


/* =====================================================================
 * 黄金快照用的 5 段「玩家操作」脚本：按固定步数执行命令，生成录制文件。
 * 这些脚本只在生成录制时用一次；之后验证只读 tests/replays/*.json 回放。
 * ===================================================================== */
const GOLDEN_W = 240, GOLDEN_H = 150, GOLDEN_STEPS = [0, 1000, 5000, 36000];

function brushCmd(tool, x0, y0, x1, y1, size, shape, extra) {
  return Object.assign({ tool, x0, y0, x1, y1, size, shape: shape || 'circle', replace: false, erase: false }, extra || {});
}

const GOLDEN_SCRIPTS = [
  { name: '自由绘制：沙、水、木头、点火、熔岩', seed: 501, steps: 1500, plan: s => {
    const cx = W >> 1, cy = H >> 1;
    if (s === 0) { execCmd('fillRect', { mat: STONE, x0: 0, y0: H - 4, x1: W - 1, y1: H - 1 }); }
    if (s === 10) { execCmd('strokeBegin', {}); execCmd('stroke', brushCmd(SAND, cx - 60, cy - 30, cx - 20, cy - 30, 5)); execCmd('strokeEnd', {}); }
    if (s === 80) execCmd('stroke', brushCmd(WATER, cx, cy - 40, cx + 40, cy - 45, 6, 'spray'));
    if (s === 150) { execCmd('strokeBegin', {}); execCmd('stroke', brushCmd(WOOD, cx + 50, H - 5, cx + 50, H - 30, 2, 'square')); execCmd('stroke', brushCmd(WOOD, cx + 40, H - 30, cx + 70, H - 30, 2, 'square')); execCmd('strokeEnd', {}); }
    if (s === 300) execCmd('ignite', { x: cx + 50, y: H - 6 });
    if (s === 420) execCmd('stroke', brushCmd(LAVA, cx - 40, 10, cx - 40, 10, 4));
    if (s === 700) execCmd('stroke', brushCmd(TOOL_ERASE, cx - 60, cy, cx - 30, cy, 3, 'circle', { erase: true }));
    if (s === 900) execCmd('stroke', brushCmd(OIL, cx + 10, 20, cx + 30, 20, 3));
  } },
  { name: '爆破拆除：额外引爆 + 拆墙', seed: 502, steps: 2000, plan: s => {
    if (s === 0) execCmd('loadScene', { index: 4 });
    if (s === 200) execCmd('explode', { x: (W * 0.55) | 0, y: H - 40, r: 12, p: 0.9 });
    if (s === 400) execCmd('stroke', brushCmd(TOOL_ERASE, (W * 0.5) | 0, H - 60, (W * 0.6) | 0, H - 60, 4, 'square', { erase: true }));
    if (s === 900) execCmd('stroke', brushCmd(TNT, 30, H - 10, 34, H - 10, 3, 'square'));
    if (s === 905) execCmd('ignite', { x: 32, y: H - 10 });
  } },
  { name: '天气：雷暴、召唤闪电、改风、改气温', seed: 503, steps: 2000, plan: s => {
    if (s === 0) execCmd('loadScene', { index: 6 });
    if (s === 100) execCmd('lightning', { x: W >> 2 });
    if (s === 300) execCmd('setEnv', { key: 'wind', value: -0.8 });
    if (s === 500) execCmd('setWeather', { key: 'snow' });
    if (s === 800) execCmd('setEnv', { key: 'temp', value: 12 });
    if (s === 1000) execCmd('setWeather', { key: 'rain' });
    if (s === 1200) execCmd('lightning', { x: (W * 3) >> 2 });
    if (s === 1400) execCmd('setEnv', { key: 'timeScale', value: 60 });
  } },
  { name: '沙漏：翻转重力四个方向', seed: 504, steps: 1500, plan: s => {
    if (s === 0) execCmd('loadScene', { index: 2 });
    if (s === 300) execCmd('setGravity', { dir: 'up' });
    if (s === 600) execCmd('setGravity', { dir: 'left' });
    if (s === 900) execCmd('setGravity', { dir: 'right' });
    if (s === 1200) execCmd('setGravity', { dir: 'down' });
  } },
  { name: '撤销、读档与换网格尺寸', seed: 505, steps: 1500, plan: s => {
    const cx = W >> 1;
    if (s === 0) execCmd('loadScene', { index: 1 });
    if (s === 100) GOLDEN_SCRIPTS.snap = sceneToJSON(captureScene());
    if (s === 200) execCmd('stroke', brushCmd(WATER, cx - 50, 20, cx + 50, 20, 8));
    if (s === 400) execCmd('restoreScene', { json: GOLDEN_SCRIPTS.snap });           // 相当于玩家按了撤销
    if (s === 600) execCmd('resize', { w: W - 20, h: H - 10 });
    if (s === 900) execCmd('stroke', brushCmd(SEED, 20, 30, W - 20, 30, 2, 'spray'));
    if (s === 1100) execCmd('resize', { w: GOLDEN_W, h: GOLDEN_H });
  } },
];

// 按脚本录一段：从 resetWorld(seed) 开始，每步先执行到点的命令再走一步
function recordScript(sc) {
  allocGrid(GOLDEN_W, GOLDEN_H);
  cmdRecording = true;
  resetWorld(sc.seed);
  for (let s = 0; s < sc.steps; s++) { sc.plan(s); simStep(); }
  return { rec: recordingOf(sc.seed, GOLDEN_W, GOLDEN_H), hash: worldHash() };
}

function sceneHashes(k) {
  allocGrid(GOLDEN_W, GOLDEN_H);
  resetWorld(1000 + k);
  cmdRecording = false;
  buildScene(k);
  const out = {};
  let s = 0;
  for (const target of GOLDEN_STEPS) { while (s < target) { simStep(); s++; } out[target] = worldHash(); }
  cmdRecording = true;
  return out;
}

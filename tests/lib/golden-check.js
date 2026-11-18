'use strict';
import { cmdRecording, commandsSet, replay, resetWorld } from '../../src/engine/commands.js';
import { H, W, allocGrid } from '../../src/engine/grid.js';
import { buildScene } from '../../src/engine/scenes.js';
import { worldHash } from '../../src/engine/serialize.js';
import { simStep } from '../../src/engine/step.js';
import { GOLDEN_H, GOLDEN_STEPS, GOLDEN_W } from './golden-scripts.js';
// 黄金快照比对：Node（tools/test.mjs、tools/golden.mjs）和浏览器（?golden=1）共用
export function goldenCompare(maxStep, data) {
  const G = data || loadGoldenNode();
  const keepW = W, keepH = H;
  const rows = [];
  let ok = 0, bad = 0;
  for (const r of G.replays) {
    const h = replay(G.recs[r.file]);
    if (h === r.hash) ok++; else bad++;
    rows.push((h === r.hash ? '✓ ' : '✗ ') + r.name + ' ' + h + (h === r.hash ? '' : ' ≠ ' + r.hash));
  }
  for (const sc of G.scenes) {
    allocGrid(GOLDEN_W, GOLDEN_H);
    resetWorld(sc.seed);
    const keepRec = cmdRecording; commandsSet('cmdRecording', false);
    buildScene(sc.index);
    commandsSet('cmdRecording', keepRec);
    let s = 0;
    for (const target of GOLDEN_STEPS) {
      if (target > maxStep) break;
      while (s < target) { simStep(); s++; }
      const h = worldHash();
      if (h === sc.hashes[target]) ok++; else { bad++; rows.push('✗ ' + sc.name + ' 第 ' + target + ' 步：' + h + ' ≠ ' + sc.hashes[target]); }
    }
  }
  if (keepW > 0) allocGrid(keepW, keepH);
  return { ok, bad, rows };
}

// Node 下从 tests/golden.json 和 tests/replays/ 读；浏览器里由构建脚本把同样的数据嵌进页面（GOLDEN_DATA）
function loadGoldenNode() {
  if (typeof GOLDEN_DATA !== 'undefined') return GOLDEN_DATA;
  const fs = globalThis.process.getBuiltinModule('node:fs'), path = globalThis.process.getBuiltinModule('node:path');
  const dir = path.join(path.dirname(globalThis.__SRC_DIR), '..', 'tests');
  const g = JSON.parse(fs.readFileSync(path.join(dir, 'golden.json'), 'utf8'));
  g.recs = {};
  for (const r of g.replays) g.recs[r.file] = JSON.parse(fs.readFileSync(path.join(dir, r.file), 'utf8'));
  return g;
}

'use strict';
import { goldenCompare } from '../lib/golden-check.js';
import { TESTS } from '../lib/harness.js';
/* 黄金快照：浏览器里算出的哈希必须和 Node 录下来的逐位一致（跨引擎确定性）。
 * ?test=1 里跑每个场景的第 0 / 1000 / 5000 步和 5 段回放；?golden=1 跑完整的 36000 步 */

export function goldenCheck(maxStep) { return goldenCompare(maxStep, GOLDEN_DATA); }

TESTS.push({ name: '跨引擎确定性：浏览器算出的哈希和 Node 录的黄金快照逐位一致', browser: true, last: true, fn: () => {
  const r = goldenCheck(5000);
  return { ok: r.bad === 0 && r.ok === GOLDEN_DATA.replays.length + GOLDEN_DATA.scenes.length * 3,
           info: r.ok + ' 个一致，' + r.bad + ' 个不一致（10 个场景 × 第 0 / 1000 / 5000 步 + 5 段回放；完整 36000 步用 ?golden=1）' + (r.bad ? '：' + r.rows.filter(x => x[0] === '✗').join('；') : '') };
} });

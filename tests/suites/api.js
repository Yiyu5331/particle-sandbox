'use strict';
/* 公开世界 API（src/engine/world.js）的用例：每个用例结束都把宿主默认世界放回台上 */
import { createWorld, activateHostWorld, EVENT_TYPES } from '../../src/engine/world.js';
import { LAVA, SAND, STONE, WATER, WOOD, TNT } from '../../src/engine/materials.js';
import { defTest } from '../lib/harness.js';
import { loadGoldenNode } from '../lib/golden-check.js';
import { GOLDEN_W, GOLDEN_H } from '../lib/golden-scripts.js';

function withWorlds(fn) {
  const made = [];
  const mk = o => { const w = createWorld(o); made.push(w); return w; };
  try { return fn(mk); } finally { for (const w of made) w.dispose(); activateHostWorld(); }
}
const apiBrush = (tool, x0, y0, x1, y1, size, extra) => Object.assign({ tool, x0, y0, x1, y1, size, shape: 'circle', replace: false, erase: false }, extra || {});

defTest('API：createWorld + loadScene 的哈希等于黄金快照（10 个场景第 0 步、爆破第 1000 步、回放 2）', () => withWorlds(mk => {
  const G = loadGoldenNode();
  const bad = [];
  for (const sc of G.scenes) {
    const w = mk({ width: GOLDEN_W, height: GOLDEN_H, seed: sc.seed });
    w.setRecording(false); w.exec('loadScene', { index: sc.index }); w.setRecording(true);
    if (w.hash() !== sc.hashes[0]) bad.push(sc.name + '@0');
    if (sc.index === 4) { w.step(1000); if (w.hash() !== sc.hashes[1000]) bad.push(sc.name + '@1000'); }
    w.dispose();
  }
  const r = G.replays[1], w = mk({ width: GOLDEN_W, height: GOLDEN_H, seed: 1 });
  if (w.replay(G.recs[r.file]) !== r.hash) bad.push(r.name);
  return { ok: bad.length === 0, info: bad.length ? '不一致：' + bad.join('，') : '12 个哈希全部一致' };
}));

defTest('API：两个世界交错地一步一步跑，结果和各自单独跑一样', () => withWorlds(mk => {
  const run = (alone) => {
    const a = mk({ width: 160, height: 100, seed: 7 }), b = mk({ width: 140, height: 90, seed: 8 });
    a.exec('loadScene', { index: 4 }); b.exec('loadScene', { index: 6 });
    if (alone) { a.step(300); b.step(300); } else for (let k = 0; k < 300; k++) { a.step(1); b.step(1); }
    return [a.hash(), b.hash()];
  };
  const s = run(true), t = run(false);
  return { ok: s[0] === t[0] && s[1] === t[1], info: '单独 ' + s.join('/') + '，交错 ' + t.join('/') };
}));

defTest('API：snapshot/restore 和 serialize/deserialize 之后再跑 500 步哈希一致（爆炸进行中）', () => withWorlds(mk => {
  const w = mk({ width: 160, height: 100, seed: 11 });
  w.exec('loadScene', { index: 4 });
  w.step(120);
  w.exec('explode', { x: 80, y: 70, r: 14, p: 1 });
  w.step(3);
  const snap = w.snapshot(), save = w.serialize(), h0 = w.hash();
  w.step(500); const h1 = w.hash();
  w.restore(snap); const hr = w.hash(); w.step(500); const h2 = w.hash();
  const v = mk({ width: 32, height: 32, seed: 1 });
  v.deserialize(save); const hd = v.hash(); v.step(500); const h3 = v.hash();
  const ok = hr === h0 && hd === h0 && h1 === h2 && h1 === h3;
  return { ok, info: '存档时 ' + h0 + '，快照恢复 ' + hr + '，读档 ' + hd + '；500 步后 ' + [h1, h2, h3].join(' / ') };
}));

defTest('API：事件按固定顺序批量发出，爆破场景有 explosion / collapse / ignite；处理函数不能 step', () => withWorlds(mk => {
  const w = mk({ width: 200, height: 130, seed: 3 });
  w.exec('loadScene', { index: 4 });
  const seen = {}; let orderOk = true, stepBlocked = false, perStepMax = 0;
  w.on('*', e => { seen[e.type] = (seen[e.type] || 0) + 1; });
  w.on('explosion', () => { try { w.step(1); } catch (e) { stepBlocked = true; } });
  for (let k = 0; k < 600; k++) {
    const evs = w.step(1);
    let last = -1; const perType = {};
    for (const e of evs) {
      const o = EVENT_TYPES.indexOf(e.type);
      if (o < last) orderOk = false; last = o;
      if (e.step !== w.tick) orderOk = false;
      perType[e.type] = (perType[e.type] || 0) + 1;
    }
    if (perType.ignite > 1 || perType.extinguish > 1 || perType.explosion > 64) orderOk = false;       // 聚合：点火/熄灭每步最多一条，爆炸按块聚合
    perStepMax = Math.max(perStepMax, evs.length);
  }
  const ok = orderOk && stepBlocked && seen.explosion > 0 && seen.collapse > 0 && seen.ignite > 0;
  return { ok, info: Object.entries(seen).map(([k, v]) => k + ' ' + v).join('，') + '；顺序 ' + (orderOk ? '正确' : '错误') + '，单步最多 ' + perStepMax + ' 条' };
}));

defTest('API：订阅事件（什么都不做的处理函数）不改变模拟结果；处理函数里的 exec 从下一步起生效、可回放', () => withWorlds(mk => {
  const a = mk({ width: 150, height: 100, seed: 5 }), b = mk({ width: 150, height: 100, seed: 5 });
  a.exec('loadScene', { index: 1 }); b.exec('loadScene', { index: 1 });
  b.on('*', () => {});
  a.step(400); b.step(400);
  const same = a.hash() === b.hash();
  const c = mk({ width: 150, height: 100, seed: 5 });
  c.exec('loadScene', { index: 1 });
  let fired = 0;
  c.on('ignite', e => { if (fired++ === 0) c.exec('stroke', apiBrush(WATER, e.x, Math.max(0, e.y - 10), e.x, Math.max(0, e.y - 10), 4)); });
  c.step(400);
  const hc = c.hash(), rec = c.recording();
  const d = mk({ width: 150, height: 100, seed: 1 });
  const hd = d.replay(rec);
  return { ok: same && hd === hc && fired > 0, info: '订阅前后 ' + (same ? '一致' : '不一致') + '；处理函数里加水后回放 ' + (hd === hc ? '一致' : hd + ' ≠ ' + hc) };
}));

defTest('API：区域规则——保护区笔刷画不进、只许放沙、点火被拒；预算 limit；regionChanged', () => withWorlds(mk => {
  const w = mk({ width: 120, height: 80, seed: 2 });
  w.exec('fillRect', { mat: STONE, x0: 0, y0: 76, x1: 119, y1: 79 });
  const prot = w.addRegion({ tag: 'base', x: 10, y: 50, w: 20, h: 26, rules: { protect: true } });
  const sandOnly = w.addRegion({ tag: 'pit', x: 60, y: 40, w: 30, h: 36, rules: { allow: [SAND] }, track: true });
  const r1 = w.exec('stroke', apiBrush(WOOD, 5, 60, 40, 60, 3));
  const inProt = w.queryRegion(prot).byKey.WOOD || 0;
  const r2 = w.exec('stroke', apiBrush(WATER, 65, 50, 85, 50, 3));
  const r3 = w.exec('stroke', apiBrush(SAND, 65, 50, 85, 50, 3, { limit: 25 }));
  const rej = w.exec('ignite', { x: 15, y: 60 });
  let changed = 0; w.on('regionChanged', e => { if (e.region === sandOnly) changed++; });
  w.step(30);
  const ok = r1.placed > 0 && inProt === 0 && r2.placed === 0 && r3.placed === 25 && rej.rejected === 'protected' && changed > 0
    && w.regionAt(15, 60)[0] === prot;
  return { ok, info: '保护区里木头 ' + inProt + ' 格（区外放了 ' + r1.placed + '），沙坑里放水 ' + r2.placed + ' 格、放沙（预算 25）' + r3.placed + ' 格，点火 ' + JSON.stringify(rej) + '，regionChanged ' + changed + ' 次' };
}));

defTest('API：getCell / getField / queryRegion / materialFirstCreated', () => withWorlds(mk => {
  const w = mk({ width: 100, height: 70, seed: 4 });
  const firsts = [];
  w.on('materialFirstCreated', e => firsts.push(e.material));
  w.exec('fillRect', { mat: SAND, x0: 10, y0: 60, x1: 29, y1: 69 });
  w.exec('stroke', apiBrush(TNT, 50, 66, 52, 66, 2));
  const c = w.getCell(15, 65), f = w.getField('type'), q = w.queryRegion({ x: 10, y: 60, w: 20, h: 10 });
  let reactions = 0; w.on('reaction', e => { reactions += e.count; });
  w.exec('fillRect', { mat: WATER, x0: 60, y0: 50, x1: 80, y1: 69 });
  w.exec('fillRect', { mat: LAVA, x0: 65, y0: 40, x1: 75, y1: 49 });
  w.step(20);
  const ok = reactions > 0 && c.key === 'SAND' && f[15 + 65 * 100] === SAND && q.byKey.SAND === q.cells && q.cells === 200 && firsts.indexOf(SAND) >= 0 && firsts.indexOf(TNT) >= 0
    && w.getCell(-1, 0) === null && w.fieldSize('vapor').w > 0;
  return { ok, info: 'getCell ' + c.name + ' ' + c.temp.toFixed(1) + '°C，区域 ' + q.cells + ' 格沙 ' + q.byKey.SAND + '，首次出现 ' + firsts.length + ' 种，熔岩遇水反应 ' + reactions + ' 次' };
}));

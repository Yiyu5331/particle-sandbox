// C3 的 30 个解谜关卡：参考解法双播三星、空解失败、meta.json 里的备选解法都能通关、文本齐全。
// 随机机器人和抗扰动比较慢，放在 node tools/c3/audit.mjs 里跑，这里不重复。
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { puzzleSession, puzzleVerify } from '../../src/modes/puzzle/session.js';
import { puzzleValidateLevel } from '../../src/modes/puzzle/format.js';

const dir = new URL('../../src/modes/puzzle/levels/c3/', import.meta.url);
const meta = JSON.parse(readFileSync(new URL('meta.json', dir), 'utf8'));
const files = readdirSync(dir).filter(f => /^c3-.*\.json$/.test(f)).sort();

// 按日志回放到结算（不要求恰好停在结算步）。
function play(level, log) {
  const s = puzzleSession(level);
  try {
    const sorted = [...log].sort((a, b) => a.step - b.step);
    let i = 0;
    if (level.type === 'planning') { for (const e of sorted) s.stroke(e.args); s.run(); }
    while (s.phase === 'running') {
      if (level.type === 'realtime') while (sorted[i]?.step === s.elapsed) s.stroke(sorted[i++].args);
      s.advance();
    }
    return { state: s.phase, stars: s.outcome.score };
  } finally { s.dispose(); }
}

test('C3 关卡：30 个文件、6 章各 5 关、与 meta.json 一致，id 不和内置关卡重复', () => {
  assert.equal(files.length, 30);
  assert.deepEqual(files.map(f => f.replace(/\.json$/, '')).sort(), [...meta.order].sort());
  const chapters = new Map();
  for (const id of meta.order) {
    const m = meta.levels[id];
    chapters.set(m.n[0], (chapters.get(m.n[0]) ?? 0) + 1);
    for (const key of ['name', 'desc', 'mechanic']) assert.ok(m[key][0] && m[key][1], `${id} 缺少 ${key} 中英文`);
    assert.equal(m.hints.length, 3, `${id} 要有三级提示`);
    for (const h of m.hints) assert.ok(h[0] && h[1], `${id} 提示缺中英文`);
    assert.ok(m.solutions.length >= 2, `${id} 少于两种解法`);
  }
  assert.deepEqual([...chapters.values()], [5, 5, 5, 5, 5, 5]);
  const builtin = readdirSync(new URL('../', dir)).filter(f => f.endsWith('.json')).map(f => f.replace(/\.json$/, ''));
  for (const id of meta.order) assert.ok(!builtin.includes(id));
});

for (const f of files) {
  test('C3 关卡 ' + f + '：参考解法三星双播一致，空解失败，备选解法通关', () => {
    const level = puzzleValidateLevel(JSON.parse(readFileSync(new URL(f, dir), 'utf8')));
    const m = meta.levels[level.id];
    assert.equal(level.name, m.name[0]); assert.equal(level.hint, m.desc[0]);
    assert.equal(puzzleVerify(level).stars, 3);
    assert.throws(() => puzzleVerify({ ...level, reference: { steps: level.maxSteps, log: [] } }), /未通关/);
    for (const s of m.solutions) assert.equal(play(level, s.log).state, 'won', `解法「${s.name}」没有通关`);
  });
}

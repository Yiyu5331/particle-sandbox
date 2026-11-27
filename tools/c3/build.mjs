// node tools/c3/build.mjs
// 把 tools/c3/levels.src.mjs 写成正式关卡：src/modes/puzzle/levels/c3/<id>.json（格式版本 1，参考解法按实际回放生成），
// 以及 src/modes/puzzle/levels/c3/meta.json（中英文文本、机制、全部解法）。
import { mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { C3_LEVELS } from './levels.src.mjs';
import { C3_CHAPTERS, c3Level, c3Log } from './core.mjs';
import { c3Args } from './lib.mjs';
import { c3LevelWithText } from '../migrate/c3-text.mjs';

const dir = new URL('../../src/modes/puzzle/levels/c3/', import.meta.url);
mkdirSync(dir, { recursive: true });
for (const f of readdirSync(dir)) if (f.endsWith('.json')) rmSync(new URL(f, dir));

const meta = { version: 1, chapters: C3_CHAPTERS, order: [], levels: {} };
for (const def of C3_LEVELS) {
  const level = c3Level(def);
  meta.order.push(level.id);
  meta.levels[level.id] = {
    n: def.n, type: def.type, chapter: C3_CHAPTERS[def.n[0]],
    name: def.text.name, desc: def.text.desc, hints: def.text.hints, mechanic: def.text.mechanic,
    solutions: def.solutions.map((s, k) => ({
      name: s.name, reference: k === 0,
      log: k === 0 ? level.reference.log : c3Log(def, s).map(e => ({ ...e, args: c3Args(level, e.args) })),
    })),
  };
  const localized = c3LevelWithText(level,meta.levels[level.id]);
  writeFileSync(new URL(level.id + '.json', dir), JSON.stringify(localized, null, 2) + '\n');
  console.log('写出', level.id, level.type, '参考', level.reference.steps, '步');
}
writeFileSync(new URL('meta.json', dir), JSON.stringify(meta, null, 2) + '\n');
console.log(`共 ${C3_LEVELS.length} 关`);

// node tools/c3/build.mjs
// 把 tools/c3/levels.src.mjs 写成正式关卡：src/modes/puzzle/levels/c3/<id>.json（格式版本 1，参考解法按实际回放生成），
// 以及 src/modes/puzzle/levels/c3/meta.json（中英文名称、描述、三级提示、机制、全部解法），供以后接入选关目录和英文词表。
import { mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { C3_LEVELS } from './levels.src.mjs';
import { C3_CHAPTERS, c3Level, c3Log } from './core.mjs';
import { c3Args } from './lib.mjs';

const dir = new URL('../../src/modes/puzzle/levels/c3/', import.meta.url);
mkdirSync(dir, { recursive: true });
for (const f of readdirSync(dir)) if (f.endsWith('.json')) rmSync(new URL(f, dir));

const meta = { version: 1, chapters: C3_CHAPTERS, order: [], levels: {} };
for (const def of C3_LEVELS) {
  const level = c3Level(def);
  writeFileSync(new URL(level.id + '.json', dir), JSON.stringify(level, null, 2) + '\n');
  meta.order.push(level.id);
  meta.levels[level.id] = {
    n: def.n, type: def.type, chapter: C3_CHAPTERS[def.n[0]],
    name: def.text.name, desc: def.text.desc, hints: def.text.hints, mechanic: def.text.mechanic,
    solutions: def.solutions.map((s, k) => ({
      name: s.name, reference: k === 0,
      log: k === 0 ? level.reference.log : c3Log(def, s).map(e => ({ ...e, args: c3Args(level, e.args) })),
    })),
  };
  console.log('写出', level.id, level.type, '参考', level.reference.steps, '步');
}
writeFileSync(new URL('meta.json', dir), JSON.stringify(meta, null, 2) + '\n');
console.log(`共 ${C3_LEVELS.length} 关`);

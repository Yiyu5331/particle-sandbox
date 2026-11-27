// node tools/levels.mjs validate [关卡.json ...]
import { readFileSync, readdirSync } from 'node:fs';
import { puzzleVerify } from '../src/modes/puzzle/session.js';
import { puzzleLevels } from '../src/modes/puzzle/catalog.js';

if (process.argv[2] !== 'validate') {
  console.error('用法：node tools/levels.mjs validate [关卡.json ...]'); process.exitCode = 2;
} else {
  const dir = new URL('../src/modes/puzzle/levels/', import.meta.url);
  const named = process.argv.slice(3);
  const files = named.length ? named : readdirSync(dir).filter(f=>f.endsWith('.json')).sort().map(f=>new URL(f,dir));
  const ids = new Set();
  for (const file of files) {
    try {
      const level = JSON.parse(readFileSync(file,'utf8'));
      if (ids.has(level.id)) throw new Error('关卡 id 重复：'+level.id);
      ids.add(level.id);
      const r = puzzleVerify(level);
      console.log(`通过  ${level.id} · ${level.name}：${r.stars} 星，${r.steps} 步，用料 ${r.used} 格，双播哈希 ${r.hash}`);
    } catch (e) { console.error('失败  '+file+'：'+e.message); process.exitCode = 1; }
  }
  const registered = new Set(puzzleLevels.map(l=>l.id));
  if (!named.length && (registered.size !== puzzleLevels.length || ids.size !== registered.size || [...ids].some(id=>!registered.has(id)))) {
    console.error('内置选关目录与 JSON 文件不一致'); process.exitCode = 1;
  }
}

// node tools/levels.mjs validate [关卡.json ...]
import { puzzleVerify } from '../src/modes/puzzle/session.js';
import { puzzleLevelLabel } from '../src/modes/puzzle/format.js';
import { discoverPuzzleLevels, readPuzzleJson } from './puzzle-catalog.mjs';

if (process.argv[2] !== 'validate') {
  console.error('用法：node tools/levels.mjs validate [关卡.json ...]'); process.exitCode = 2;
} else {
  const named = process.argv.slice(3);
  const files = named.length ? named.map(path=>({path})) : discoverPuzzleLevels();
  const ids = new Set();
  for (const {path,level:builtIn} of files) {
    try {
      const level = builtIn ?? readPuzzleJson(path);
      if (ids.has(level.id)) throw new Error('关卡 id 重复：'+level.id);
      ids.add(level.id);
      const r = puzzleVerify(level);
      console.log(`通过  ${level.id} · ${puzzleLevelLabel(level,'name')}：${r.stars} 星，${r.steps} 步，用料 ${r.used} 格，双播哈希 ${r.hash}`);
    } catch (e) { console.error('失败  '+path+'：'+e.message); process.exitCode = 1; }
  }
}

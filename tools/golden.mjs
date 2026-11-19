// 黄金快照：node tools/golden.mjs check [--steps=36000]   比对 tests/golden.json（默认跑满 36000 步）
//           node tools/golden.mjs record                  重新录制（只有模拟行为“有意改变”时才允许，见 AGENTS.md）
import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
globalThis.__SRC_DIR = path.join(ROOT, 'src', 'engine');
const mode = process.argv[2] || 'check';
const args = Object.fromEntries(process.argv.slice(3).map(a => { const m = a.match(/^--([^=]+)(?:=(.*))?$/); return m ? [m[1], m[2] ?? true] : [a, true]; }));
const t0 = performance.now();
if (mode === 'check') {
  const { goldenCompare } = await import('../tests/lib/golden-check.js');
  const g = goldenCompare(+(args.steps || 36000));
  for (const r of g.rows) console.log(r);
  console.log(`\n黄金快照：${g.ok} 个一致，${g.bad} 个不一致（${((performance.now() - t0) / 1000).toFixed(0)}s）`);
  process.exitCode = g.bad ? 1 : 0;
} else if (mode === 'record') {
  const { GOLDEN_SCRIPTS, GOLDEN_W, GOLDEN_H, GOLDEN_STEPS, recordScript, sceneHashes } = await import('../tests/lib/golden-scripts.js');
  const { replay } = await import('../src/engine/commands.js');
  const { SCENES } = await import('../src/engine/scenes.js');
  const out = { note: '固定种子下的 world.hash()。第二部分（C0 重构）不允许让这些值发生任何变化。', grid: [GOLDEN_W, GOLDEN_H], steps: GOLDEN_STEPS, scenes: [], replays: [] };
  for (const [i, sc] of GOLDEN_SCRIPTS.entries()) {
    const file = 'replays/rec-' + (i + 1) + '.json';
    const { rec, hash } = recordScript(sc);
    writeFileSync(path.join(ROOT, 'tests', file), JSON.stringify(rec));
    const replayed = replay(rec);
    out.replays.push({ name: sc.name, file, commands: rec.log.length, steps: rec.steps, hash: replayed });
    console.log('回放', i + 1, sc.name, replayed, hash !== replayed ? '（实时 ' + hash + ' 不一致！）' : '');
  }
  for (let k = 0; k < SCENES.length; k++) {
    const h = sceneHashes(k);
    out.scenes.push({ index: k, name: SCENES[k].name, seed: 1000 + k, hashes: h });
    console.log('场景', k, SCENES[k].name, JSON.stringify(h));
  }
  writeFileSync(path.join(ROOT, 'tests', 'golden.json'), JSON.stringify(out, null, 1));
  console.log('已写入 tests/golden.json');
} else { console.error('用法：node tools/golden.mjs check|record'); process.exitCode = 2; }

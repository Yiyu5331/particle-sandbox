#!/bin/sh
# 录制黄金快照：10 个场景 × 第 0/1000/5000/36000 步的哈希 + 5 段玩家操作回放。写到 ../tests/golden.json
cd "$(dirname "$0")"
{ echo "globalThis.location={search:''};"; cat 10-core.js 20-sim.js 22-struct.js 23-weather.js 25-codec.js 26-state.js 27-scenes.js golden-scripts.js; cat <<'JS'
const fs = require('fs');
const mode = process.argv[2] || 'record';
const out = { note: '固定种子下的 world.hash()。第二部分（C0 重构）不允许让这些值发生任何变化。', grid: [GOLDEN_W, GOLDEN_H], steps: GOLDEN_STEPS, scenes: [], replays: [] };
const t0 = Date.now();
for (const [i, sc] of GOLDEN_SCRIPTS.entries()) {
  const file = 'replays/rec-' + (i + 1) + '.json';
  let rec, hash;
  if (mode === 'record') { ({ rec, hash } = recordScript(sc)); fs.writeFileSync('../tests/' + file, JSON.stringify(rec)); }
  else rec = JSON.parse(fs.readFileSync('../tests/' + file, 'utf8'));
  const replayed = replay(rec);
  out.replays.push({ name: sc.name, file, commands: rec.log.length, steps: rec.steps, hash: replayed });
  console.log('回放', i + 1, sc.name, rec.log.length + ' 条命令', replayed, hash && hash !== replayed ? '（实时 ' + hash + ' 不一致！）' : '');
}
for (let k = 0; k < SCENES.length; k++) {
  const h = sceneHashes(k);
  out.scenes.push({ index: k, name: SCENES[k].name, seed: 1000 + k, hashes: h });
  console.log('场景', k, SCENES[k].name, JSON.stringify(h));
}
console.log('用时', ((Date.now() - t0) / 1000).toFixed(0) + 's');
fs.writeFileSync(mode === 'record' ? '../tests/golden.json' : (process.env.OUT || '../tests/golden-check.json'), JSON.stringify(out, null, 1));
JS
} > "$TMPDIR/psb-golden.js"
node "$TMPDIR/psb-golden.js" "$@"

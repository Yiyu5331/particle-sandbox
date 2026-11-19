// soak 测试：10 个预设各跑 10 分钟模拟时间（默认 36000 步），每 10 秒采样一次；判定最后 2 分钟每种材料趋势 < 2%。
//   node tools/soak.mjs [--from=0] [--to=9] [--steps=36000] [--grid=400x250] [--out=tests/soak-result.json]
import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = Object.fromEntries(process.argv.slice(2).map(a => { const m = a.match(/^--([^=]+)(?:=(.*))?$/); return m ? [m[1], m[2] ?? true] : [a, true]; }));
const { allocGrid } = await import('../src/engine/grid.js');
const { MATERIALS, PLANT, WATER } = await import('../src/engine/materials.js');
const { SCENES } = await import('../src/engine/scenes.js');
const { soakScene, SOAK_MATS } = await import('../tests/lib/harness.js');

const [gw, gh] = String(args.grid || '400x250').split('x').map(Number);
allocGrid(gw, gh);
const steps = +(args.steps || 36000), from = +(args.from || 0), to = +(args.to ?? SCENES.length - 1);
const outFile = path.resolve(ROOT, args.out || 'tests/soak-result.json');
const out = [];
let bad = 0;
for (let k = from; k <= to; k++) {
  const t0 = performance.now();
  const v = soakScene(k, steps);
  const ms = performance.now() - t0;
  const mid = v.samples[v.samples.length >> 1];
  const row = { scene: v.name, steps, wallSec: +(ms / 1000).toFixed(1), msPerStep: +(ms / steps).toFixed(3),
    total: [v.first.total, mid.total, v.last.total], avgT: [+v.first.avgT.toFixed(1), +v.last.avgT.toFixed(1)],
    burnPeak: v.peakBurn, burnLate: +v.lateBurn.toFixed(1), chunksPeak: v.peakChunks, chunksLate: +v.lateChunks.toFixed(1),
    heapGrowthMB: +v.heapGrowth.toFixed(1), growing: v.growing, unstable: v.unstable, drift: v.drift,
    mats: Object.fromEntries(SOAK_MATS.map(t => [MATERIALS[t].name, [v.first.cnt[t], mid.cnt[t], v.last.cnt[t]]]).filter(e => e[1][0] + e[1][1] + e[1][2] > 0)),
    last13: Object.fromEntries(SOAK_MATS.map(t => [MATERIALS[t].name, v.samples.slice(-13).map(x => x.cnt[t])]).filter(e => e[1].some(z => z > 0))),
    series: v.samples.filter((_, i) => i % 6 === 0).map(s => ({ total: s.total, burn: s.burning + s.fire, chunks: s.chunks, plant: s.cnt[PLANT], water: s.cnt[WATER], cloud: +s.cloud.toFixed(1), heap: +s.heap.toFixed(0) })) };
  out.push(row);
  if (row.unstable.length) bad++;
  console.log((row.unstable.length ? '不稳定  ' : '稳定    ') + row.scene + `  ${row.wallSec}s，总量 ${row.total.join('→')}` + (row.unstable.length ? '：' + row.unstable.join('，') : ''));
  writeFileSync(outFile, JSON.stringify(out, null, 1));
}
console.log(`\n${out.length - bad}/${out.length} 个场景稳定；结果写到 ${path.relative(ROOT, outFile)}`);
process.exitCode = bad ? 1 : 0;

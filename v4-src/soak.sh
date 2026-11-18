#!/bin/sh
# soak 测试：10 个预设各跑 10 分钟模拟时间（36000 步），每 10 秒采样一次。结果写到 soak-result.json
cd "$(dirname "$0")"
{ echo "globalThis.location={search:''};"; cat 10-core.js 20-sim.js 22-struct.js 23-weather.js 25-codec.js 26-state.js 27-scenes.js 60-tests.js 62-tests4.js 64-tests41.js; cat <<'JS'
const fs = require('fs');
allocGrid(Number(process.env.GW||400), Number(process.env.GH||250));
const steps = Number(process.env.STEPS||36000), out = [];
const from = Number(process.env.FROM||0), to = Number(process.env.TO||SCENES.length-1);
for (let k = from; k <= to; k++) {
  const t0 = performance.now();
  const v = soakScene(k, steps);
  const ms = performance.now() - t0;
  const row = { scene: v.name, steps, wallSec: +(ms/1000).toFixed(1), msPerStep: +(ms/steps).toFixed(3),
    total: [v.first.total, v.samples[v.samples.length>>1].total, v.last.total],
    avgT: [+v.first.avgT.toFixed(1), +v.last.avgT.toFixed(1)],
    burnPeak: v.peakBurn, burnLate: +v.lateBurn.toFixed(1), chunksPeak: v.peakChunks, chunksLate: +v.lateChunks.toFixed(1),
    heapGrowthMB: +v.heapGrowth.toFixed(1), growing: v.growing, unstable: v.unstable, drift: v.drift,
    mats: Object.fromEntries(SOAK_MATS.map(t => [MATERIALS[t].name, [v.first.cnt[t], v.samples[v.samples.length>>1].cnt[t], v.last.cnt[t]]]).filter(e => e[1][0]+e[1][1]+e[1][2] > 0)),
    last13: Object.fromEntries(SOAK_MATS.map(t => [MATERIALS[t].name, v.samples.slice(-13).map(x => x.cnt[t])]).filter(e => e[1].some(z => z > 0))),
    series: v.samples.filter((_, i) => i % 6 === 0).map(s => ({ total: s.total, burn: s.burning + s.fire, chunks: s.chunks, plant: s.cnt[PLANT], water: s.cnt[WATER], cloud: +s.cloud.toFixed(1), heap: +s.heap.toFixed(0) })) };
  out.push(row);
  console.log(JSON.stringify({ scene: row.scene, wallSec: row.wallSec, total: row.total, burnLate: row.burnLate, chunksLate: row.chunksLate, heap: row.heapGrowthMB, unstable: row.unstable }));
  fs.writeFileSync('soak-result.json', JSON.stringify(out, null, 1));
}
JS
} > "$TMPDIR/psb-soak.js"
node "$TMPDIR/psb-soak.js"

// 水量收支账：指定场景每分钟模拟时间的水存量和各条进出通道（单位：格水；湿度按 100 = 1 格水折算）
//   node tools/ledger.mjs [--scenes=1,5,6,8] [--minutes=10] [--grid=400x250]
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = Object.fromEntries(process.argv.slice(2).map(a => { const m = a.match(/^--([^=]+)(?:=(.*))?$/); return m ? [m[1], m[2] ?? true] : [a, true]; }));
const { allocGrid, type, wet, N } = await import('../src/engine/grid.js');
const G = await import('../src/engine/grid.js');
const { ICE, SALTWATER, SNOW, WATER } = await import('../src/engine/materials.js');
const { LEDGER_KEYS } = await import('../src/engine/env.js');
const E = await import('../src/engine/env.js');
const W8 = await import('../src/engine/weather.js');
const { resetWorld } = await import('../src/engine/commands.js');
const { buildScene, SCENES } = await import('../src/engine/scenes.js');
const { simStep } = await import('../src/engine/step.js');

const [gw, gh] = String(args.grid || '400x250').split('x').map(Number);
allocGrid(gw, gh);
const scenes = String(args.scenes || '1,5,6,8').split(',').map(Number), minutes = +(args.minutes || 10);
const stock = () => {
  let liq = 0, ice = 0, wetS = 0;
  const T = G.type, Wt = G.wet;
  for (let i = 0; i < G.N; i++) { const t = T[i]; if (t === WATER || t === SALTWATER) liq++; else if (t === ICE || t === SNOW) ice++; wetS += Wt[i]; }
  let v = 0, c = 0; for (let q = 0; q < W8.GW * W8.GH; q++) { v += W8.vapor[q]; c += W8.cloud[q]; }
  return { liq, ice, wet: wetS / 100, vapor: v, cloud: c };
};
const keys = ['min', 'liq', 'ice', 'wet', 'vapor', 'cloud', ...LEDGER_KEYS];
for (const k of scenes) {
  resetWorld(1000 + k); buildScene(k);
  let prev = Object.assign({}, E.WL);
  console.log('### ' + SCENES[k].name + '（每分钟，单位：格水）');
  console.log(keys.join('\t'));
  for (let m = 1; m <= minutes; m++) {
    for (let s = 0; s < 3600; s++) simStep();
    const r = Object.assign({ min: m }, stock());
    for (const key of LEDGER_KEYS) r[key] = E.WL[key] - prev[key];
    prev = Object.assign({}, E.WL);
    console.log(keys.map(x => Math.abs(r[x]) >= 100 ? r[x].toFixed(0) : r[x].toFixed(1)).join('\t'));
  }
}

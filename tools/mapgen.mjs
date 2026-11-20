// 全量验收：node tools/mapgen.mjs audit [--seeds=1000] [--workers=4]
// 性能：node tools/mapgen.mjs bench。生成与实际跑物理分别计时。
import { Worker, isMainThread, parentPort, workerData } from 'node:worker_threads';
import { availableParallelism } from 'node:os';
import { generateMap, mapgenBiomes, mapgenPresets } from '../src/gen/index.js';
import { checkDefenseMap, checkMapStability } from '../src/gen/check.js';

const biomes=Object.keys(mapgenBiomes);
function batch(biome, count, size) {
  const result={biome,total:count,passed:0,maxCollapse:0,maxFlow:0,maxDrained:0,failures:[]};
  for (let seed=0;seed<count;seed++) {
    const [width,height]=size ?? (seed%2 ? [96,64] : [112,72]);
    const p={width,height,biome,preset:'defense',relief:(seed%11)/10,villageWidth:6+(seed % (Math.floor(width/3)-5))};
    const map=generateMap(seed,p), geometry=checkDefenseMap(map), physics=checkMapStability(map);
    result.maxCollapse=Math.max(result.maxCollapse,physics.collapse,physics.missingRock);
    result.maxFlow=Math.max(result.maxFlow,physics.peakFlow);
    result.maxDrained=Math.max(result.maxDrained,physics.peakDrained);
    if (!geometry.length && physics.ok) result.passed++;
    else if (result.failures.length<5) result.failures.push({seed,p,geometry,physics});
  }
  return result;
}
function runWorker(biome,count,size) {
  return new Promise((resolve,reject)=>{
    const worker=new Worker(new URL(import.meta.url),{workerData:{biome,count,size}});
    worker.once('message',resolve); worker.once('error',reject);
    worker.once('exit',code=>{ if (code) reject(new Error('验收进程退出：'+code)); });
  });
}
function option(name, fallback) {
  const value=process.argv.slice(3).find(arg=>arg.startsWith('--'+name+'='));
  const n=value ? Number(value.split('=')[1]) : fallback;
  if (!Number.isSafeInteger(n) || n<1) throw new Error('无效参数：'+name);
  return n;
}
if (!isMainThread) parentPort.postMessage(batch(workerData.biome,workerData.count,workerData.size));
else if (process.argv[2]==='audit') {
  const count=option('seeds',1000), concurrency=Math.min(biomes.length,option('workers',Math.min(4,availableParallelism())));
  const sizeArg=process.argv.slice(3).find(arg=>arg.startsWith('--size='));
  const size=sizeArg?.slice(7).split('x').map(Number);
  if (size && size.length!==2) throw new Error('尺寸应为 宽x高');
  const pending=[...biomes], results=[];
  await Promise.all(Array.from({length:concurrency},async()=>{
    while (pending.length) {
      const r=await runWorker(pending.shift(),count,size); results.push(r);
      console.log(JSON.stringify(r));
    }
  }));
  const total=results.reduce((n,r)=>n+r.passed,0);
  console.log('几何 + 300 步稳定性：'+total+'/'+(count*biomes.length));
  if (total!==count*biomes.length) process.exitCode=1;
} else if (process.argv[2]==='bench') {
  const samples=[];
  for (let seed=0;seed<20;seed++) for (const biome of biomes) for (const preset of Object.keys(mapgenPresets)) {
    const start=performance.now(); generateMap(seed,{width:422,height:246,biome,preset}); samples.push(performance.now()-start);
  }
  samples.sort((a,b)=>a-b);
  console.log('422×246，'+samples.length+' 张：中位 '+samples[samples.length>>1].toFixed(2)+' ms，最慢 '+samples.at(-1).toFixed(2)+' ms');
  if (samples.at(-1)>=200) process.exitCode=1;
} else { console.error('用法：node tools/mapgen.mjs audit | bench'); process.exitCode=2; }

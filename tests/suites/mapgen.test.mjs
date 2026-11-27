import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { EMPTY,STONE,WATER,SALTWATER,SAND,SOIL,LAVA,SNOW,SEED,PLANT,WOOD,createWorld } from '../../src/engine/index.js';
import { generateMap,mapgenBiomes,mapgenPresets,mapgenRaster } from '../../src/gen/index.js';
import { mapgenHash32,mapgenNoise,mapgenRandom } from '../../src/gen/noise.js';
import { checkDefenseMap,checkMapStability } from '../../src/gen/check.js';
import { mapgenFixtureText,mapgenExpectedSHA,mapgenTextChecksum,mapgenExpectedChecksum,mapgenFixtureWorld,mapgenExpectedWorld } from '../lib/mapgen-cases.js';

test('地图生成：生成模块的确定性运算扫描',()=>{
  const dir=new URL('../../src/gen/',import.meta.url);
  for (const file of readdirSync(dir).filter(f=>f.endsWith('.js'))) {
    const code=readFileSync(new URL(file,dir),'utf8').replace(/\/\/[^\n]*|\/\*[\s\S]*?\*\//g,'');
    assert.doesNotMatch(code,/\b(Math\.(?:random|sin|cos|tan|asin|acos|atan2?|exp|pow|log\w*|sinh|cosh|tanh)|Date|performance|crypto)\b/,file);
  }
});

test('地图生成：晶格端点、负坐标、独立随机序列与种子归一化',()=>{
  const a=mapgenRandom(0), b=mapgenRandom(0);
  const series=Array.from({length:12},()=>a(4000));
  assert.deepEqual(series,Array.from({length:12},()=>b(4000)));
  assert.ok(new Set(series).size>1);
  for (const k of [-2,-1,0,1,2]) assert.equal(mapgenNoise(8,k*16,16,2),(mapgenHash32(8,k,2)&511)-256);
  assert.deepEqual(generateMap(-1),generateMap(4294967295));
  for (const opts of [{width:63},{height:0},{villageWidth:1000},{temperature:NaN},{biome:'unknown'},{relief:1.1},{preset:'other'}]) {
    assert.throws(()=>generateMap(0,opts),RangeError);
  }
});

test('地图生成：Node 与浏览器共用的 24 份完整输出指纹',()=>{
  const text=mapgenFixtureText();
  assert.equal(createHash('sha256').update(text).digest('hex'),mapgenExpectedSHA);
  assert.equal(mapgenTextChecksum(text),mapgenExpectedChecksum);
  assert.equal(mapgenFixtureWorld(createWorld),mapgenExpectedWorld);
});

test('地图生成：纯 JSON 命令可录制回放，缩略图的格子等于真实引擎',()=>{
  const map=generateMap(16,{biome:'forest'}), {width,height,seed}=map.meta;
  assert.deepEqual(JSON.parse(JSON.stringify(map)),map);
  const w=createWorld({width,height,seed}), copy=createWorld({width,height,seed:1});
  try {
    for (const cmd of map.commands) w.exec(cmd);
    assert.deepEqual(w.getField('type'),mapgenRaster(map));
    w.addRegion(map.regions.village); w.step(30);
    const rec=w.recording();
    assert.equal(rec.log.length,map.commands.length); assert.equal(copy.replay(rec),w.hash());
    assert.deepEqual(copy.regionAt(map.regions.village.x,map.regions.village.y),[1]);
  } finally { w.dispose(); copy.dispose(); }
});

test('地图生成：分层、洞穴、河床下降、植被和海水、温度雪线与预设',()=>{
  const terrains=new Set();
  for (const biome of Object.keys(mapgenBiomes)) {
    const m=generateMap(19,{biome,width:256,height:144}), {width:w,height:h,river,caves}=m.meta;
    const cells=mapgenRaster(m); terrains.add(createHash('sha256').update(cells).digest('hex'));
    assert.ok(cells.subarray(w*(h-4)).every(t=>t===STONE));
    assert.ok(cells.includes(SOIL) && cells.includes(SAND) && cells.includes(WATER),biome);
    assert.ok(caves.some(c=>cells[c.y*w+c.x]===EMPTY));
    let previous=-1;
    for (let x=river.from;x<=river.to;x++) {
      let y=0; while (y<h && cells[y*w+x]!==WATER) y++;
      assert.ok(y<h && y>previous); previous=y;
    }
    if (['coast','archipelago'].includes(biome)) assert.ok(cells.includes(SALTWATER));
    if (biome==='volcano') assert.ok(cells.includes(LAVA));
    if (biome==='forest') assert.ok(cells.includes(WOOD) && cells.includes(PLANT));
    if (biome==='tundra') assert.ok(cells.includes(SNOW));
  }
  assert.equal(terrains.size,Object.keys(mapgenBiomes).length);
  const warm=mapgenRaster(generateMap(1,{biome:'tundra',temperature:45}));
  assert.ok(!warm.includes(SNOW));
  const signatures=Object.keys(mapgenPresets).map(preset=>createHash('sha256').update(mapgenRaster(generateMap(4,{preset}))).digest('hex'));
  assert.equal(new Set(signatures).size,3);
});

test('地图生成：守护边界尺寸、最大村宽以及每个实测流路',()=>{
  for (const [width,height] of [[64,48],[64,512],[1024,48],[422,246]]) for (const relief of [0,1]) {
    for (const biome of Object.keys(mapgenBiomes)) {
      const villageWidth=Math.floor(width/3);
      const m=generateMap(42,{width,height,relief,biome,villageWidth});
      assert.ok(m.regions.village.w>=villageWidth); assert.deepEqual(checkDefenseMap(m),[]);
    }
  }
  const map=generateMap(1,{width:422,height:246}), v=map.regions.village;
  for (const dir of Object.keys(map.regions.spawns)) for (const [hazard,mat] of [['flood',WATER],['lava',LAVA]]) {
    const s=map.regions.spawns[dir][hazard], w=createWorld({width:422,height:246,seed:1});
    try {
      for (const c of map.commands) w.exec(c);
      let reached=false;
      for (let tick=0;tick<600 && !reached;tick++) {
        if (tick%3===0) w.exec('stroke',{tool:mat,x0:s.x,x1:s.x,y0:s.y,y1:s.y,size:2,shape:'square',replace:false});
        w.step(); reached=w.queryRegion(v).counts[mat]>0;
      }
      assert.ok(reached,dir+' '+hazard);
    } finally { w.dispose(); }
  }
});

test('地图生成：破坏平地、淡水、洪水坡道或熔岩出口都被拒绝',()=>{
  const m=generateMap(42),v=m.regions.village,{width:w}=m.meta;
  const check=fn=>{ const cells=mapgenRaster(m); fn(cells); assert.ok(checkDefenseMap(m,cells).length); };
  check(c=>{c[v.y*w+v.x]=WATER;});
  check(c=>{c[(v.y+v.h)*w+v.x]=EMPTY;});
  check(c=>{const s=m.regions.sources[0];for(let y=s.y;y<s.y+s.h;y++) c.fill(STONE,y*w+s.x,y*w+s.x+s.w);});
  for (const d of ['left','right','top']) for (const h of ['flood','lava']) check(c=>{
    const s=m.regions.spawns[d][h];c[s.y*w+s.x]=STONE;
  });
  check(c=>{
    const s=m.regions.spawns.left.flood;
    for (let y=s.y-1;y<s.y+5;y++) c[y*w+s.x+1]=STONE;
  });
  // 高于实际流路的架空物不挡水。
  const overhead=mapgenRaster(m), start=m.regions.spawns.left.flood;
  overhead[(start.y-3)*w+start.x+1]=STONE;
  assert.deepEqual(checkDefenseMap(m,overhead),[]);
});

test('地图生成：稳定性含物理反例，且各群系默认守护局 300 步通过',()=>{
  for(const biome of Object.keys(mapgenBiomes)) {
    const r=checkMapStability(generateMap(82,{width:112,height:72,biome}));
    assert.ok(r.ok,biome+' '+JSON.stringify(r));
  }
  const m=generateMap(1,{width:96,height:64});
  for (const mat of [STONE,WATER]) {
    const broken={...m,commands:[...m.commands,{command:'fillRect',args:{mat,x0:8,x1:30,y0:2,y1:6}}]};
    const r=checkMapStability(broken);
    assert.ok(!r.ok);
    if (mat===STONE) assert.ok(r.collapse>r.limits.collapse);
    else assert.ok(r.peakFlow>r.limits.flow && r.peakDrained>r.limits.drained);
  }
});

test('地图生成：实际河水从高处汇入山湖，岩床留在原处',()=>{
  const map=generateMap(4,{width:160,height:96}), w=createWorld(map.meta);
  try {
    for (const c of map.commands) w.exec(c);
    const river=map.meta.river, lake=map.regions.sources[0];
    const count=(x,width,mat)=>w.queryRegion({x,y:0,w:width,h:w.height}).counts[mat];
    const length=river.to-river.from+1, before=count(river.from,length,WATER), stored=count(lake.x,lake.w,WATER);
    const rock=count(river.from,length,STONE);
    w.step(45);
    assert.ok(count(river.from,length,WATER)<before);
    assert.ok(count(lake.x,lake.w,WATER)>stored);
    assert.equal(count(river.from,length,STONE),rock);
  } finally {w.dispose();}
});

test('地图生成：最小尺寸的宽村庄仍有洞室、滨岸植被和空出生点',()=>{
  for (const biome of Object.keys(mapgenBiomes)) for(const preset of Object.keys(mapgenPresets)) {
    const m=generateMap(0,{width:64,height:48,villageWidth:21,biome,preset});
    const c=mapgenRaster(m);
    assert.ok(m.meta.caves.length);
    assert.ok(c.includes(PLANT) || c.includes(SEED));
    for (const side of Object.values(m.regions.spawns)) for (const s of Object.values(side)) assert.equal(c[s.y*64+s.x],EMPTY);
  }
});

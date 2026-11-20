import { EMPTY, STONE, SOIL, SAND, WATER, SALTWATER, SEED, WOOD, PLANT, ICE, SNOW, LAVA } from '../engine/index.js';
import { checkDefenseMap } from './layout.js';
export { mapgenRaster } from './layout.js';
import { mapgenHash32, mapgenNoise, mapgenRandom } from './noise.js';

// 深度、温度和生长密度是群系基线。海岸与岛链分别具有连续岸线和周期性陆桥。
export const mapgenBiomes = Object.freeze({
  grassland: {name:'草原', temp:19, soil:5, trees:2, cover:44},
  forest: {name:'森林', temp:16, soil:7, trees:29, cover:68},
  desert: {name:'沙漠', temp:34, soil:7, trees:0, cover:3},
  tundra: {name:'雪原', temp:-9, soil:3, trees:3, cover:12},
  volcano: {name:'火山', temp:28, soil:2, trees:0, cover:5},
  coast: {name:'海岸', temp:22, soil:4, trees:8, cover:30},
  archipelago: {name:'群岛', temp:25, soil:4, trees:14, cover:36},
  canyon: {name:'峡谷', temp:25, soil:3, trees:1, cover:13},
});
Object.values(mapgenBiomes).forEach(Object.freeze);
export const mapgenPresets = Object.freeze({defense:'守护', civ:'文明', eco:'生态'});

function mapgenInt(n, lo, hi, label) {
  if (!Number.isInteger(n) || n < lo || n > hi) throw new RangeError(label+' 应为 '+lo+'～'+hi+' 的整数');
  return n;
}
function mapgenClamp(n, lo, hi) { return Math.min(hi, Math.max(lo,n)); }
function mapgenRegion(tag,x,y,w,h) { return {tag,x,y,w,h}; }

// 所有地貌先在局部栅格上合成。将最终材料的纵向游程编码成公开命令，避免输出被覆盖的中间层。
function mapgenEncode(grid, width, height) {
  const commands = [];
  let previous = new Map();
  for (let x=0;x<width;x++) {
    const next = new Map();
    let y=0;
    while (y<height) {
      const y0=y, mat=grid[y*width+x];
      do { y++; } while (y<height && grid[y*width+x]===mat);
      if (mat === EMPTY) continue;
      const key = (mat*height+y0)*(height+1)+y;
      let span = previous.get(key);
      if (span) span.x1=x;
      else {
        span = {mat,x0:x,x1:x,y0,y1:y-1};
        commands.push({command:'fillRect',args:span});
      }
      next.set(key,span);
    }
    previous=next;
  }
  return commands;
}

export function generateMap(seed, params = {}) {
  const key = mapgenInt(seed,-2147483648,4294967295,'种子') >>> 0;
  const {width=160,height=96,biome='grassland',preset='defense',relief=0.65} = params;
  mapgenInt(width,64,1024,'宽度'); mapgenInt(height,48,512,'高度');
  if (typeof biome!=='string' || typeof preset!=='string' || !Object.hasOwn(mapgenBiomes,biome) || !Object.hasOwn(mapgenPresets,preset)) throw new RangeError('未知群系或用途');
  if (!Number.isFinite(relief) || relief<0 || relief>1) throw new RangeError('起伏应在 0～1 之间');
  const climate = mapgenBiomes[biome], rugged = Math.round(relief*1000);
  const wild = preset === 'eco';
  const villageWidth = mapgenInt(params.villageWidth ?? Math.max(8,Math.floor(width/(preset==='civ'?7:11))),6,Math.floor(width/3),'村庄宽度');
  const temperature = mapgenInt(params.temperature ?? climate.temp,-40,50,'气温');
  const random = mapgenRandom(mapgenHash32(key,17));
  const noise = (x,p,ch) => mapgenNoise(key,x,Math.max(2,p|0),ch);
  const grid = new Uint8Array(width*height), ground = new Int16Array(width);
  const marine = biome==='coast' || biome==='archipelago';
  const base = Math.floor(height*(marine?0.60:0.54)), sea = Math.floor(height*0.61);
  const center = Math.floor(width*(marine?0.43:0.51)) + random(Math.max(2,width>>4)) - (width>>5);
  const west = Math.max(17,center-(villageWidth>>1)), east = west+villageWidth-1;
  const floor = Math.floor(height*0.64)+random(Math.max(2,height>>4));
  const run = Math.max(5,Math.min(width>>3,height>>1,west-11));
  const left = west-run, right = east+Math.max(5,Math.min(width>>3,height>>1,width-east-6));
  const rise = Math.max(2,Math.floor(run*(350+rugged/3)/1000));
  const rightRise = Math.max(2,Math.floor((right-east)*(350+rugged/3)/1000));
  const rim = floor-rise;
  const poolWidth = Math.min(left-6,Math.max(5,width>>4));
  const poolEnd = left-2, poolStart = poolEnd-poolWidth+1;
  const riverStart = Math.max(1,poolStart-Math.max(3,Math.min(12,width>>5)));
  const waterY = rim+3, depth = Math.max(4,Math.min(height>>3,Math.floor(height*0.85)-waterY));
  const landPhase = random(width);
  for (let x=0;x<width;x++) {
    const broad = noise(x,width/4,1), fine = noise(x,width/13,2);
    let profile = broad + (fine>>2);
    if (biome==='grassland') profile = profile>>1;
    if (biome==='desert') profile = Math.abs(broad+fine/3)-110;
    if (biome==='tundra') profile = broad-Math.abs(fine)/2;
    if (biome==='canyon') {
      const gorge = Math.abs(x-Math.floor(width*0.79)-Math.floor(width*broad/4096));
      profile = Math.floor(profile/5)+(gorge<width*0.065 ? 430 : gorge<width*0.13 ? 180 : -170);
    }
    if (biome==='volcano') {
      const flank = Math.abs(x-Math.floor(width*0.80));
      profile = Math.floor(profile/4)+120-Math.max(0,460-Math.floor(flank*1800/width));
    }
    if (biome==='coast') profile = Math.floor(profile/3)+Math.floor((x-width*0.52)*850/width);
    if (biome==='archipelago') {
      const period = Math.max(7,Math.floor(width/6)), u = (x+landPhase)%period;
      const t=Math.floor(Math.abs(2*u-period)*256/period);
      const smooth=Math.floor(t*t*(768-2*t)/65536);
      const island=mapgenHash32(key,Math.floor((x+landPhase)/period),8);
      profile=Math.floor(smooth*(560+(island&255))/256)-255+Math.floor(broad/3);
    }
    ground[x] = mapgenClamp(base+Math.round(Math.min(width,height)*profile*(150+rugged)/1250000),8,height-10);
  }

  // 给两侧各留一条没有逆坡的泄流面。生态地形仅整平小片林间空地。
  const slope = (distance,length,drop) => Math.floor(distance*drop/length);
  for (let x=west;x<=east;x++) ground[x]=floor;
  for (let x=left;x<west;x++) ground[x]=floor-slope(west-x,west-left,rise);
  if (!wild) for (let x=east+1;x<=right;x++) ground[x]=floor-slope(x-east,right-east,rightRise);
  // 山腰湖有石质堤肩和自由水面；短小的阶梯河段从上游向湖中落水。
  for (let x=poolStart;x<=poolEnd;x++) {
    const edge = Math.min(x-poolStart,poolEnd-x);
    ground[x]=waterY+Math.min(depth,3+edge*2);
  }
  ground[poolEnd+1]=rim;
  for (let x=riverStart;x<poolStart;x++) ground[x]=waterY+1-(poolStart-x);
  ground[riverStart-1]=ground[riverStart]-2;
  const seaStart = right+2;
  if (marine && seaStart<width) {
    ground[seaStart-1]=Math.min(sea-2,ground[seaStart-1]);
    const shelfDepth=Math.max(4,Math.min(height>>3,width>>3));
    for (let x=seaStart;x<width;x++) ground[x]=Math.min(ground[x],sea+shelfDepth);
  }
  // 软土仅覆盖能受到相邻岩石支撑的部分；陡壁自动露出基岩。
  for (let x=0;x<width;x++) {
    const y0 = ground[x], rockBank = x>=riverStart-1 && x<west || !wild && x>east && x<=right+1;
    const beach = marine && x>=seaStart && y0>=sea-2;
    const sediment = biome==='desert' || beach ? SAND : SOIL;
    const skin = rockBank || beach && y0>=sea || biome==='volcano' && y0<base ? 0 :
      climate.soil+(preset==='civ'?2:0)+(noise(x,7,4)>90?2:0);
    const steep = Math.max(ground[Math.max(0,x-1)],ground[Math.min(width-1,x+1)])-y0;
    const thick = steep>1 ? 0 : skin;
    for (let y=y0;y<height;y++) {
      let mat=STONE;
      if (y<height-4 && y<y0+thick && !(marine && x>=seaStart-1 && y>=sea-1)) {
        mat=sediment;
        // 沙丘下的旧土层和土层下的沉积沙带，均埋在地表之下。
        if (thick>=3 && y===y0+thick-1) mat=sediment===SAND ? SOIL : SAND;
      }
      grid[y*width+x]=mat;
    }
    if (x>=riverStart && x<=poolEnd) {
      const top = x<poolStart ? y0-1 : waterY;
      for (let y=top;y<y0;y++) grid[y*width+x]=WATER;
    } else if (marine && x>=seaStart) {
      for (let y=sea;y<y0;y++) grid[y*width+x]=SALTWATER;
    }
  }

  const caves = [];
  // 在厚岩层中开出沿层面弯曲的洞室。随机宽高、间距和埋深，不挖穿海岸或基岩。
  let start=2+random(Math.max(3,width>>5));
  while (start<width-8) {
    const rx=3+random(Math.max(3,Math.min(19,width>>4))), cx=start+rx;
    start+=2*rx+5+random(Math.max(4,width>>4));
    if (cx+rx>=width-2) break;
    let roof=0;
    for (let x=cx-rx-2;x<=cx+rx+2;x++) roof=Math.max(roof,ground[x]+climate.soil+6);
    const room=height-5-roof;
    if (room<5) continue;
    const ry=Math.min(2+random(Math.max(2,rx>>1)),Math.max(1,(room-2)>>2));
    const cy=roof+1+ry+random(Math.max(1,room-2*ry-2));
    for (let dx=-rx;dx<=rx;dx++) {
      const bend=noise(cx+dx,Math.max(4,rx),9)>>7;
      for (let dy=-ry;dy<=ry;dy++) {
        if (dx*dx*ry*ry+dy*dy*rx*rx<=rx*rx*ry*ry) grid[(cy+dy+bend)*width+cx+dx]=EMPTY;
      }
    }
    caves.push({x:cx,y:cy+(noise(cx,Math.max(4,rx),9)>>7),rx,ry});
  }
  if (!caves.length) {
    // 在最小尺寸、宽村台的组合下仍保留一间深部洞室，岩壳与连续基岩相连。
    const cx=west+(villageWidth>>1), cy=height-8, rx=Math.min(4,(villageWidth-2)>>1);
    for (let dy=-2;dy<=2;dy++) for (let dx=-rx-1;dx<=rx+1;dx++) {
      grid[(cy+dy)*width+cx+dx]=Math.abs(dx)<=rx && (dy===0 || Math.abs(dy)===1 && Math.abs(dx)<rx) ? EMPTY : STONE;
    }
    caves.push({x:cx,y:cy,rx,ry:1});
  }
  // 热区的封闭岩浆室在最低处预先找平，初始没有悬空的熔岩。
  if (biome==='volcano' && caves.length) {
    const c=caves[caves.length-1];
    for (let y=c.y;y<=Math.min(height-5,c.y+c.ry+3);y++) for (let x=c.x-c.rx;x<=c.x+c.rx;x++) {
      if (grid[y*width+x]===EMPTY) grid[y*width+x]=LAVA;
    }
  }
  let lastTree=-8;
  for (let x=2;x<width-2;x++) {
    const y=ground[x];
    if (Math.abs(x-right)<=2 || x>=riverStart-2 && x<=(wild?east:right)+2 || grid[(y-1)*width+x]!==EMPTY) continue;
    const localTemp = temperature + Math.floor((y-base)*22/height) + (noise(x,width/9,7)>>6);
    if (localTemp<=0 && Math.abs(ground[x-1]-y)<=1 && Math.abs(ground[x+1]-y)<=1) {
      // 雪被下铺冻土冰层，避免暖启动的岩土在几步之内融掉整片积雪。
      grid[y*width+x]=ICE; grid[(y+1)*width+x]=ICE;
      grid[(y-1)*width+x]=SNOW; continue;
    }
    if (climate.trees && x-lastTree>=5 && random(100)<climate.trees+(wild?8:0) && grid[y*width+x]===SOIL) {
      const h=3+random(Math.max(2,Math.min(9,height>>4)));
      for (let k=1;k<=h;k++) grid[(y-k)*width+x]=WOOD;
      for (let dx=-2;dx<=2;dx++) for (let dy=-2;dy<=1;dy++) {
        const i=(y-h+dy)*width+x+dx;
        if (Math.abs(dx)+Math.abs(dy)<=3 && i>=0 && grid[i]===EMPTY) grid[i]=PLANT;
      }
      lastTree=x;
    } else if (random(100)<climate.cover && grid[y*width+x]!==STONE) {
      grid[(y-1)*width+x]=random(4) ? PLANT : SEED;
    }
  }
  // 极小地图上即使两岸都很陡，淡水上游也留有一丛滨岸植被。
  const bank=riverStart-1, bankY=ground[bank];
  if (biome==='forest' && !grid.includes(WOOD)) {
    grid[(bankY-1)*width+bank]=WOOD;
    grid[(bankY-2)*width+bank]=PLANT;
  } else if (!grid.includes(PLANT) && !grid.includes(SEED)) grid[(bankY-1)*width+bank]=PLANT;
  const village=mapgenRegion('village',west,floor-4,villageWidth,4);
  const spawn=(tag,x,y)=>mapgenRegion(tag,x,y,1,1);
  // 水源可从山脊来；热流的出露口靠近坡脚，以免小股熔岩在途中完全冷凝。
  function sideSources(dir,ridge,vent) {
    function exposed(tag,x) {
      let y=ground[x]-2;
      while (y>0 && grid[y*width+x]!==EMPTY) y--;
      return spawn(tag,x,y);
    }
    return {flood:exposed(dir+'-flood',ridge),lava:exposed(dir+'-lava',vent)};
  }
  const spawns={
    left:sideSources('left',left,Math.max(left,west-7)),
    right:sideSources('right',right,Math.min(right,east+7)),
    top:{flood:spawn('top-flood',west+(villageWidth>>1),2),lava:spawn('top-lava',west+(villageWidth>>1),2)},
  };
  const sources=[mapgenRegion('spring',poolStart,waterY,poolWidth,2)];
  const commands=[
    {command:'clear',args:{}}, {command:'setGravity',args:{dir:'down'}},
    {command:'setWeather',args:{key:'clear'}}, {command:'setEnv',args:{key:'temp',value:temperature}},
    {command:'setEnv',args:{key:'structure',value:true}}, ...mapgenEncode(grid,width,height),
  ];
  const map={commands, regions:{village,spawns,sources}, meta:{version:1,seed:key,width,height,biome,preset,
    relief:rugged/1000,temperature,villageWidth,waterReach:Math.ceil(width/5)+4,
    river:{from:riverStart,to:poolStart-1},caves}};
  if (preset==='defense') {
    const issues=checkDefenseMap(map,grid);
    if (issues.length) throw new Error('守护地图约束失败：'+issues.join('；'));
  }
  return map;
}

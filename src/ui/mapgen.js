import { EMPTY, STONE, SOIL, SAND, ICE, SNOW, WATER, SALTWATER, MATERIALS } from '../engine/index.js';
import { generateMap, mapgenBiomes, mapgenPresets, mapgenRaster } from '../gen/index.js';
import { mapgenHash32 } from '../gen/noise.js';
import { checkDefenseMap, mapgenStabilitySteps } from '../gen/check.js';

// 这里只渲染命令重建的初始状态；颜色取自游戏材料表。
function mapgenPaint(canvas,map,markers) {
  const {width,height,seed}=map.meta, grid=mapgenRaster(map);
  canvas.width=width; canvas.height=height;
  const g=canvas.getContext('2d'), image=g.createImageData(width,height);
  const palettes=MATERIALS.map(m=>m.palette.map(color=>parseInt(color.slice(1),16)));
  for (let x=0;x<width;x++) {
    let underground=false;
    for (let y=0;y<height;y++) {
      const i=y*width+x, t=grid[i], at=i*4;
      let r,gc,b;
      if (t===EMPTY) {
        const k=underground ? 0 : Math.floor(30*y/height);
        r=underground?17:18+k; gc=underground?16:28+k; b=underground?27:46+k;
      } else {
        const palette=palettes[t], rgb=palette[mapgenHash32(seed,x,y)%palette.length];
        const light=!underground && y>0 && grid[i-width]===EMPTY ? 14 : 0;
        r=(rgb>>16)+light; gc=(rgb>>8&255)+light; b=(rgb&255)+light;
        if (t===STONE || t===SOIL || t===SAND || t===ICE || t===SNOW || t===WATER || t===SALTWATER) underground=true;
      }
      image.data[at]=r; image.data[at+1]=gc; image.data[at+2]=b; image.data[at+3]=255;
    }
  }
  g.putImageData(image,0,0);
  if (!markers) return;
  function box(region,color) {
    g.strokeStyle=color; g.lineWidth=1;
    g.strokeRect(region.x+.5,region.y+.5,Math.max(1,region.w-1),Math.max(1,region.h-1));
  }
  box(map.regions.village,'#ffdb89');
  map.regions.sources.forEach(s=>box(s,'#7af2e7'));
  for (const entry of Object.values(map.regions.spawns)) {
    for (const [kind,s] of Object.entries(entry)) {
      g.fillStyle=kind==='flood'?'#8bb8ff':'#ff9979';
      g.fillRect(s.x-1,s.y-1,3,2);
      if (kind==='lava' && s.x===entry.flood.x && s.y===entry.flood.y) g.fillRect(s.x,s.y+1,1,1);
    }
  }
}

export function openMapgenPage() {
  document.body.dataset.page='mapgen'; document.title='地图生成器 · 粒子沙盘';
  const root=document.createElement('main'); root.id='mapgen';
  root.innerHTML=`<header><h1>地图生成器</h1><a href="?">返回沙盘</a></header>
    <form class="mg-controls">
      <label>群系<select name="biome"><option value="all">全部群系</option></select></label>
      <label>用途<select name="preset"></select></label>
      <label>地图尺寸<select name="size"><option>96×64</option><option selected>160×96</option><option>256×144</option><option>422×246</option></select></label>
      <label>地形起伏<input type="range" name="relief" min="0" max="100" value="65"><output>65%</output></label>
      <label>村庄最小宽度<input name="villageWidth" type="number" min="6" step="1" placeholder="自动"></label>
      <label>气温 °C<input name="temperature" type="number" min="-40" max="50" step="1" placeholder="群系默认"></label>
      <label>起始种子<input name="seed" type="number" min="0" max="4294967295" step="1" value="0" required></label>
      <button type="submit">生成图册</button><button type="button" data-next>下一组种子</button>
    </form>
    <div class="mg-work"><section><h2>种子图册</h2><div class="mg-grid"></div></section>
      <section class="mg-detail"><h2>地形剖面</h2><canvas aria-label="选中地图的地形剖面"></canvas>
        <h3></h3><p class="mg-info"></p>
        <label class="mg-mark"><input type="checkbox" checked>显示区域</label>
        <ul class="mg-legend"><li>村庄</li><li>淡水源</li><li>洪水起点</li><li>熔岩起点</li></ul>
        <button type="button" data-check>验证 300 步稳定性</button><p role="status"></p>
      </section></div>`;
  document.body.append(root);
  const form=root.querySelector('form'), el=name=>form.elements.namedItem(name);
  function options(name,values) {
    for (const [key,text] of Object.entries(values)) {
      const o=document.createElement('option'); o.value=key; o.textContent=text; el(name).append(o);
    }
  }
  options('biome',Object.fromEntries(Object.entries(mapgenBiomes).map(([k,v])=>[k,v.name])));
  options('preset',mapgenPresets);
  const grid=root.querySelector('.mg-grid'), preview=root.querySelector('.mg-detail canvas'), mark=root.querySelector('.mg-mark input');
  const status=root.querySelector('[role=status]'), check=root.querySelector('[data-check]');
  let selected, activeButton, generation=0;
  function choose(map,button) {
    selected=map; generation++; check.disabled=false;
    activeButton?.setAttribute('aria-pressed','false'); activeButton=button; button.setAttribute('aria-pressed','true');
    mapgenPaint(preview,map,mark.checked);
    const m=map.meta;
    root.querySelector('h3').textContent=mapgenBiomes[m.biome].name+' · 种子 '+m.seed;
    root.querySelector('.mg-info').textContent=m.width+'×'+m.height+' 格 · '+m.temperature+'°C · '+map.commands.length+' 条命令';
    const issues=m.preset==='defense'?checkDefenseMap(map):[];
    status.textContent=m.preset==='defense'?(issues.length?issues.join('；'):'守护地形约束通过。'):'已生成'+mapgenPresets[m.preset]+'地图。';
  }
  function render() {
    const [width,height]=el('size').value.split('×').map(Number);
    el('villageWidth').max=String(Math.floor(width/3));
    if (!form.reportValidity()) return;
    const params={width,height,preset:el('preset').value,relief:el('relief').value/100};
    for (const key of ['temperature','villageWidth']) if (el(key).value!=='') params[key]=Number(el(key).value);
    const kinds=Object.keys(mapgenBiomes), biome=el('biome').value, seed=Number(el('seed').value);
    const count=biome==='all'?kinds.length*2:12;
    const fragment=document.createDocumentFragment(); let first;
    for (let n=0;n<count;n++) {
      const id=biome==='all'?kinds[n%kinds.length]:biome;
      const map=generateMap((seed+n)>>>0,{...params,biome:id});
      const button=document.createElement('button'), canvas=document.createElement('canvas'), caption=document.createElement('span');
      button.type='button'; button.setAttribute('aria-pressed','false');
      caption.textContent=mapgenBiomes[id].name+' · '+map.meta.seed;
      canvas.setAttribute('aria-hidden','true'); mapgenPaint(canvas,map,false);
      button.append(canvas,caption); fragment.append(button); button.onclick=()=>choose(map,button);
      if (n===0) first=[map,button];
    }
    grid.replaceChildren(fragment); choose(...first);
  }
  mark.onchange=()=>mapgenPaint(preview,selected,mark.checked);
  form.onsubmit=e=>{e.preventDefault();render();};
  form.onchange=render;
  el('relief').oninput=()=>{form.querySelector('output').value=el('relief').value+'%';};
  root.querySelector('[data-next]').onclick=()=>{
    el('seed').value=(Number(el('seed').value)+grid.childElementCount)>>>0;render();
  };
  check.onclick=async()=>{
    const job=generation, simulation=mapgenStabilitySteps(selected);
    check.disabled=true;
    try {
      for (;;) {
        await new Promise(done=>setTimeout(done,0));
        if (job!==generation) return;
        const step=simulation.next();
        if (step.done) {
          const r=step.value;
          status.textContent=(r.ok?'通过':'未通过')+' 300 步检查 · 坍塌 '+r.collapse+' 格 · 单步流动峰值 '+r.peakFlow+' · 原液面腾空峰值 '+r.peakDrained+' 格'+(r.settledIssues.length?' · '+r.settledIssues.join('；'):'');
          break;
        }
        status.textContent='稳定性检查 '+step.value+' / 300 步';
      }
    } finally { simulation.return(); if (job===generation) check.disabled=false; }
  };
  render();
}

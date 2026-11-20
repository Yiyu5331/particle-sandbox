import { EMPTY, STONE, SOIL, SAND, WATER, M_STATE, S_SOLID, S_POWDER, VOID, CLONE } from '../engine/index.js';

// 缩略图和静态校验都从实际命令重建，避免调试图与引擎收到的地图不一致。
export function mapgenRaster(map) {
  const {width,height}=map.meta, cells=new Uint8Array(width*height);
  for (const {command,args:a} of map.commands) {
    if (command==='clear') cells.fill(EMPTY);
    else if (command==='fillRect') {
      for (let y=a.y0;y<=a.y1;y++) cells.fill(a.mat,y*width+a.x0,y*width+a.x1+1);
    }
  }
  return cells;
}

// 从真实的格子检查地面、净空及逐列流路；格子坐标的 y 向下增加。
export function checkDefenseMap(map, cells = mapgenRaster(map)) {
  const {width:w,height:h,villageWidth,waterReach}=map.meta;
  const {village:v,spawns,sources}=map.regions;
  const issues=[];
  function inside(r) {
    return r && [r.x,r.y,r.w,r.h].every(Number.isInteger) && r.w>0 && r.h>0 &&
      r.x>=0 && r.y>=0 && r.x+r.w<=w && r.y+r.h<=h;
  }
  if (!inside(v) || v.w<villageWidth || v.y+v.h>=h) return ['村庄尺寸或位置无效'];
  const groundY=v.y+v.h;
  for (let x=v.x;x<v.x+v.w;x++) {
    if (![STONE,SAND,SOIL].includes(cells[groundY*w+x])) { issues.push('村庄缺少平整地面'); break; }
    for (let y=0;y<groundY;y++) if (cells[y*w+x]!==EMPTY) { issues.push('村庄上方有水或障碍'); break; }
  }
  const near = sources.some(s => {
    if (!inside(s)) return false;
    for (let y=s.y;y<s.y+s.h;y++) for (let x=s.x;x<s.x+s.w;x++) {
      const dx=Math.max(v.x-x,0,x-(v.x+v.w-1)), dy=Math.max(v.y-y,0,y-(groundY-1));
      if (dx*dx+dy*dy<=waterReach*waterReach && cells[y*w+x]===WATER) return true;
    }
    return false;
  });
  if (!near) issues.push('村庄附近没有淡水');
  for (const dir of ['left','right','top']) for (const hazard of ['flood','lava']) {
    const s=spawns[dir]?.[hazard];
    if (!inside(s) || cells[s.y*w+s.x]!==EMPTY) { issues.push(dir+' 出生点无效'); continue; }
    if (dir==='top') {
      if (s.x<v.x || s.x>=v.x+v.w || s.y>=v.y) issues.push('上方出生点未对准村庄');
      continue;
    }
    const dx=dir==='left'?1:-1, end=dx===1?v.x:v.x+v.w-1;
    if ((end-s.x)*dx<=0) { issues.push(dir+' 出生点方向错误'); continue; }
    let previous=-1, first=-1, flat=0, airY=s.y;
    for (let x=s.x;;x+=dx) {
      // 从上列的液面横移一格再顺重力落下，不允许跳墙、爬坡或从树冠上传送。
      if (cells[airY*w+x]!==EMPTY) { issues.push(dir+' 通道出现逆坡'); break; }
      let y=airY;
      while (y<h && cells[y*w+x]===EMPTY) y++;
      const bed=cells[y*w+x];
      if (y===h || (M_STATE[bed]!==S_SOLID && M_STATE[bed]!==S_POWDER) || bed===VOID || bed===CLONE) {
        issues.push(dir+' 缺少可承流的坡面'); break;
      }
      airY=y-1;
      if (first<0) first=y;
      flat=y===previous ? flat+1 : 0;
      if (hazard==='lava' && flat>4) { issues.push(dir+' 平段过长，熔岩不能顺坡'); break; }
      previous=y;
      if (x===end) {
        if (y!==groundY || y<=first) issues.push(dir+' 未下坡到达村庄');
        break;
      }
    }
  }
  return [...new Set(issues)];
}

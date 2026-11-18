'use strict';
import { st } from './env.js';
import { DX4, DY4, H, N, W, charge, chargeE, temp, type, wake } from './grid.js';
import { METAL, M_ELEC, M_FLAM, STEEL } from './materials.js';

/* ---------------------------------------------------------------------
 * 2.9 电：带电格子列表逐帧向相邻导体传导（金属几乎无损，水每格衰减 6/255 ≈ 传 40 格）
 * ------------------------------------------------------------------- */
export let elecCur = null, elecNext = null, elecCount = 0;

export function addCharge(j, e) {
  if (charge[j] !== 0) return;
  if (elecCur === null || elecCur.length !== N) { elecCur = new Int32Array(N); elecNext = new Int32Array(N); elecCount = 0; }
  charge[j] = 6; chargeE[j] = e;
  elecCur[elecCount++] = j;
}

export function stepElectric() {
  const cnt = elecCount;
  if (cnt === 0) return;
  let nn = 0;
  const cur = elecCur, next = elecNext;
  for (let q = 0; q < cnt; q++) {
    const i = cur[q];
    let c = charge[i];
    if (c === 0) continue;
    const t = type[i];
    if (!M_ELEC[t]) { charge[i] = 0; continue; }
    const x = i % W, y = (i / W) | 0;
    wake(x, y);
    if (c === 6) {                           // 刚带上电：这一帧向四周传
      st.elec++;
      const e = chargeE[i], loss = t === METAL || t === STEEL ? 1 : 6;
      for (let k = 0; k < 4; k++) {
        const nx = x + DX4[k], ny = y + DY4[k];
        if (nx < 0 || nx >= W || ny < 0 || ny >= H) continue;
        const j = nx + ny * W, o = type[j];
        if (o === 0) continue;
        if (M_ELEC[o]) {
          if (e > loss && charge[j] === 0) {                 // 导体里必定导通；水里每格损耗大，传四十格左右就没了
            charge[j] = 6; chargeE[j] = e - loss; next[nn++] = j;
          }
        } else if (M_FLAM[o] > 0) { temp[j] += 300; wake(nx, ny); }
      }
    }
    c--;
    charge[i] = c;
    if (c > 0) next[nn++] = i;               // 余下几帧是不应期，防止电往回传
  }
  elecCur = next; elecNext = cur; elecCount = nn;
}

/* ---- 本模块的全部可变状态（多世界切换、读档用；由迁移脚本生成，新增 let 状态时记得加进来） ---- */
export function electricSave() { return { elecCur, elecNext, elecCount }; }
export function electricLoad(s) { ({ elecCur, elecNext, elecCount } = s); }
export function electricSet(name, v) {
  switch (name) {
    case 'elecCur': elecCur = v; break;
    case 'elecNext': elecNext = v; break;
    case 'elecCount': elecCount = v; break;
    default: throw new Error('electric.js 没有可写的状态 ' + name);
  }
}

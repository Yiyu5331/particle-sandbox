'use strict';


// xorshift32：模拟里只用它，不用 Math.random。初始种子固定，由宿主（页面 / 测试）显式设置
export let _rs = 0x2545f491;
export function rngState() { return _rs; }
export function setRngState(s) { _rs = (s | 0) || 1; }
export function rnd() {
  _rs ^= _rs << 13; _rs ^= _rs >>> 17; _rs ^= _rs << 5;
  return (_rs >>> 0) * 2.3283064365386963e-10;
}
export function rndi(n) { return (rnd() * n) | 0; }
export function seedRng(s) { _rs = (s | 0) || 1; }

/* ---- 本模块的全部可变状态（多世界切换、读档用；由迁移脚本生成，新增 let 状态时记得加进来） ---- */
export function rngSave() { return { _rs }; }
export function rngLoad(s) { ({ _rs } = s); }
export function rngSet(name, v) {
  switch (name) {
    case '_rs': _rs = v; break;
    default: throw new Error('rng.js 没有可写的状态 ' + name);
  }
}

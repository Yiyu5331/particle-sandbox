'use strict';
import { AMBIENT } from './materials.js';

/* ---------------------------------------------------------------------
 * 1.4 环境（天气、昼夜）与全局统计
 * ------------------------------------------------------------------- */
export const DAY_STEPS = 36000;   // 时间流速 1x 时，一昼夜 = 10 分钟模拟时间
export let env = {
  structure: true,         // 结构力学开关
  plantAging: 1,           // 植物、花、种子的衰老速度倍数（1 = 正常）
  dayNight: true,          // 关掉后恒为正午、气温恒为 env.temp（自测用）
  time: 0.8,               // 0 = 午夜，0.25 = 日出，0.5 = 正午，0.75 = 日落
  timeScale: 1,            // 0 / 1 / 10 / 60
  wind: 0.2,               // 风向与相对强度：-1（向左）.. 1（向右）
  windPower: 0.3,          // 风力 0..1
  moistPerMin: 0,          // 天气预设每分钟最多注入多少格水汽（外部输入）
  atmosCap: 0,             // 每个粗格列的大气含水容量，大气里的水汽 + 云到了这个量就停止注入
  atmos: 0,                // 当前大气里的水汽 + 云（每 4 步更新一次）
  cloudFade: 0,            // 晴天时云的消散速率（外部输出）
  temp: AMBIENT,           // 全局气温
  weather: 'clear', storm: 0,
  sun: 1, el: 1, ambient: AMBIENT,
  // 水量账本（单位：格水）
  waterIn: 0, waterOut: 0, waterSink: 0,
  rainCount: 0, snowCount: 0, strikes: 0, charge: 0,
};
// 水量收支明细（单位：格水），只用来诊断，不参与模拟
export const LEDGER_KEYS = ['weatherIn', 'cloneIn', 'precip', 'voidOut', 'evapSurface', 'evapWet', 'steamToVapor', 'transpire', 'plantUse', 'seep', 'decayOut', 'sublimate', 'cloudFade', 'condense', 'cloudEvap', 'wallCondense'];
export let WL = {};
export function ledgerReset() { for (const k of LEDGER_KEYS) WL[k] = 0; }
ledgerReset();

// 每步统计，供音效和调试面板使用
export let st = { powder: 0, liquid: 0, fire: 0, hiss: 0, elec: 0, boom: 0, boil: 0, rain: 0, crash: 0 };
// 模拟 → 表现层的回调（爆炸闪光、震动、音效）
export let onBoom = null, onThunder = null, onCrash = null;

/* ---------------------------------------------------------------------
 * 命令：所有改变世界的玩家操作都走 execCmd，按 {step, command, args} 记下来
 * ------------------------------------------------------------------- */
export const ENV_DEFAULTS = JSON.parse(JSON.stringify(env));     // 开局时的环境（resetWorld 恢复成这样，回放才对得上）

/* ---- 本模块的全部可变状态（多世界切换、读档用；由迁移脚本生成，新增 let 状态时记得加进来） ---- */
export function envSave() { return { env, WL, st, onBoom, onThunder, onCrash }; }
export function envLoad(s) { ({ env, WL, st, onBoom, onThunder, onCrash } = s); }
export function envSet(name, v) {
  switch (name) {
    case 'env': env = v; break;
    case 'WL': WL = v; break;
    case 'st': st = v; break;
    case 'onBoom': onBoom = v; break;
    case 'onThunder': onThunder = v; break;
    case 'onCrash': onCrash = v; break;
    default: throw new Error('env.js 没有可写的状态 ' + name);
  }
}

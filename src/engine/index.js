'use strict';
/* =====================================================================
 * 引擎公开入口。模式、UI、渲染、音频、实体、game 只从这里取引擎的东西（docs/API.md）。
 * 其它 src/engine/*.js 是引擎内部，随时可能改。tools/migrate/imports.py 会检查这一点。
 * ===================================================================== */
export { createWorld, activateHostWorld, activeWorld, HOST_WORLD, EVENT_TYPES, FIELDS, cloneState } from './world.js';
// 静态数据（只读）：材料 id、材料属性表、状态名
export * from './materials.js';
export { RULES } from './rules.js';
export { SCENES } from './scenes.js';
export { WEATHER_PRESETS, RAIN_THR, thunderDelay } from './weather.js';
export { COMMANDS } from './commands.js';
export { ENV_DEFAULTS, LEDGER_KEYS } from './env.js';
// 常量：格子标志位、分块、模拟频率、池子上限
export { F_PAR, F_BURN, F_SCORCH, F_TIP, F_BODY, F_PIN, F_FALL, CHUNK, SIM_HZ } from './grid.js';
export { FP_MAX } from './particles.js';
export { BODY_MAX } from './structure.js';
// 存档编码工具（纯函数）
export { bytesToB64, b64ToBytes } from './serialize.js';

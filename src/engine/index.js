'use strict';
import { COMMANDS } from './commands.js';
import { EMPTY, MATERIALS, NT, STATE_NAMES, TOOL_ERASE } from './materials.js';
import { SCENES } from './scenes.js';
import { WEATHER_PRESETS } from './weather.js';
import { EVENT_TYPES, FIELDS, activateHostWorld, createWorld } from './world.js';
/* =====================================================================
 * 引擎公开入口。模式、UI、渲染、实体、工具只从这里取东西（docs/API.md）。
 * 其它 src/engine/*.js 是引擎内部，随时可能改。
 * ===================================================================== */
export { createWorld, activateHostWorld, EVENT_TYPES, FIELDS } from './world.js';
export { MATERIALS, NT, EMPTY, TOOL_ERASE, STATE_NAMES } from './materials.js';
export { SCENES } from './scenes.js';
export { WEATHER_PRESETS } from './weather.js';
export { COMMANDS } from './commands.js';

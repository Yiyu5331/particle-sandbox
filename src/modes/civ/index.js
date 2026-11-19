'use strict';
import { placeholderMode } from '../../game/mode.js';
/* 文明模式（开发中）：能从主菜单进出，画面上显示「开发中」。
 * 设想：小人在沙盘里采集、建造、躲避灾害，玩家用天气和地形引导文明发展。
 * 实现时请只用公开世界 API（src/engine/index.js）和 src/game/ 的工具，见 docs/API.md、AGENTS.md。 */

export const civModeDef = placeholderMode('civ', '文明', '小人在沙盘里采集、建造、躲避灾害，玩家用天气和地形引导文明发展');

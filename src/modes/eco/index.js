'use strict';
import { placeholderMode } from '../../game/mode.js';
/* 生态模式（开发中）：能从主菜单进出，画面上显示「开发中」。
 * 设想：维持一个封闭生态：植物、水循环、昼夜和季节，观察种群长期是否稳定。
 * 实现时请只用公开世界 API（src/engine/index.js）和 src/game/ 的工具，见 docs/API.md、AGENTS.md。 */

export const ecoModeDef = placeholderMode('eco', '生态', '维持一个封闭生态：植物、水循环、昼夜和季节，观察种群长期是否稳定');

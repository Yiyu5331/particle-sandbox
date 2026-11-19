'use strict';
import { placeholderMode } from '../../game/mode.js';
/* 塔防模式（开发中）：能从主菜单进出，画面上显示「开发中」。
 * 设想：用材料和物理搭防线：敌人沿路线来袭，靠火、水、爆炸、塌方挡住它们。
 * 实现时请只用公开世界 API（src/engine/index.js）和 src/game/ 的工具，见 docs/API.md、AGENTS.md。 */

export const defenseModeDef = placeholderMode('defense', '塔防', '用材料和物理搭防线：敌人沿路线来袭，靠火、水、爆炸、塌方挡住它们');

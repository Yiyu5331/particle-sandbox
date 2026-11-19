'use strict';
import { placeholderMode } from '../../game/mode.js';
/* 解谜模式（开发中）：能从主菜单进出，画面上显示「开发中」。
 * 设想：每关给定材料预算和目标区域：用最少的材料让水流到指定位置、点燃目标、救出被困物。
 * 实现时请只用公开世界 API（src/engine/index.js）和 src/game/ 的工具，见 docs/API.md、AGENTS.md。 */

export const puzzleModeDef = placeholderMode('puzzle', '解谜', '每关给定材料预算和目标区域：用最少的材料让水流到指定位置、点燃目标、救出被困物');

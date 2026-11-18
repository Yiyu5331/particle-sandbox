'use strict';


/* ---------------------------------------------------------------------
 * 1.1b 确定性数学：模拟里禁止用 Math.sin / cos / exp / pow / log / hypot
 *      （不同 JS 引擎的结果在最后几位可能不同）。这里只用 + - * / 和 Math.floor / sqrt / abs，
 *      这些在 IEEE 754 下每个引擎结果都一样。精度约 1e-7，模拟够用。渲染层不受这条限制。
 * ------------------------------------------------------------------- */
export const TAU = 6.283185307179586, HALF_PI = 1.5707963267948966;
export function dsin(x) {
  x -= Math.floor(x / TAU + 0.5) * TAU;              // 归到 [-π, π]
  if (x > HALF_PI) x = 3.141592653589793 - x;         // 再折到 [-π/2, π/2]
  else if (x < -HALF_PI) x = -3.141592653589793 - x;
  const x2 = x * x;
  return x * (1 + x2 * (-1 / 6 + x2 * (1 / 120 + x2 * (-1 / 5040 + x2 * (1 / 362880 + x2 * (-1 / 39916800))))));
}
export function dcos(x) { return dsin(x + HALF_PI); }

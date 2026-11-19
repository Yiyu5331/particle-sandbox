'use strict';
/* 页面级的小工具：地址栏参数、像素比例、取元素、提示条、下载 */
export const QS = new URLSearchParams(location.search);
export let CELL = 3;              // 每格的 CSS 像素边长，可在设置里切 2 / 3 / 4
export function setCell(v) { CELL = v; }
export const $ = id => document.getElementById(id);

let toastTimer = 0;
export function toast(msg) {
  const el = $('toast');
  el.textContent = msg; el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 2200);
}

export let downloadHook = null;     // 测试用：截住下载
export function setDownloadHook(fn) { downloadHook = fn; }
export function downloadBlob(blob, name) {
  if (downloadHook) { downloadHook(blob, name); return; }
  const url = URL.createObjectURL(blob), a = document.createElement('a');
  a.href = url; a.download = name;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

export function stampName(ext) {
  const d = new Date(), p = n => String(n).padStart(2, '0');
  return 'sandbox-' + d.getFullYear() + p(d.getMonth() + 1) + p(d.getDate()) + '-' + p(d.getHours()) + p(d.getMinutes()) + p(d.getSeconds()) + '.' + ext;
}

// 让出主线程一下（MessageChannel 不受后台定时器节流影响）
const yieldCh = new MessageChannel();
export const yieldTask = () => new Promise(r => { yieldCh.port1.onmessage = () => r(); yieldCh.port2.postMessage(0); });

import { uiEnglish } from './catalog.js';

let uiLocale = 'zh-CN';
const uiLanguageListeners = new Set();
export function uiLanguage() { return uiLocale; }
export function uiT(key, values = {}) {
  const text = uiLocale === 'en' && Object.hasOwn(uiEnglish, key) ? uiEnglish[key] : key;
  return String(text ?? '').replace(/\{(\w+)\}/g, (match, name) => Object.hasOwn(values, name) ? String(values[name]) : match);
}
export function uiOnLanguage(fn) {
  uiLanguageListeners.add(fn);
  return () => uiLanguageListeners.delete(fn);
}
export function uiSetLanguage(locale) {
  if (!['zh-CN', 'en'].includes(locale)) throw new RangeError('不支持的语言');
  uiLocale = locale;
  document.documentElement.lang = locale;
  for (const fn of uiLanguageListeners) fn();
}

// 只绑定页面模板原有的文本和属性。用户命名、文件名和输入值保持原文。
export function uiLocalizeTemplate(root) {
  const bindings = [];
  function walk(node) {
    if (node.nodeType === 3) {
      const key = node.data.trim();
      if (Object.hasOwn(uiEnglish, key)) {
        const raw = node.data;
        bindings.push(() => { node.data = raw.replace(key, () => uiT(key)); });
      }
    } else if (node.nodeType === 1) {
      if (['SCRIPT', 'STYLE', 'SVG'].includes(node.tagName.toUpperCase())) return;
      for (const attr of ['title', 'placeholder', 'aria-label', 'alt']) {
        const key = node.getAttribute(attr);
        if (key && Object.hasOwn(uiEnglish, key)) bindings.push(() => node.setAttribute(attr, uiT(key)));
      }
      for (const child of node.childNodes) walk(child);
    }
  }
  walk(root);
  const refresh = () => bindings.forEach(fn => fn());
  refresh();
  return uiOnLanguage(refresh);
}

import { uiButton, uiElement, uiProgress } from './components.js';
import { uiT } from './i18n.js';

// 用稳定 id 复用节点，模式每次刷新 HUD 时按钮仍保有键盘焦点。
export function uiHudRenderer(host) {
  const rows = new Map();
  let last = null;
  function render(data) {
    last = data;
    const line = typeof data === 'string' ? data : data?.text;
    const items = typeof line === 'string' ? [{ id:'text', type:'hint', label:line }] : data?.items || [];
    const active = new Set();
    for (const item of items) {
      if (!item.id || active.has(item.id) || !['value','progress','countdown','hint','button'].includes(item.type)) continue;
      active.add(item.id);
      let row = rows.get(item.id);
      if (!row || row.type !== item.type) {
        row?.el.remove();
        row = { type:item.type, el:uiElement('div','ui-hud-item'), label:uiElement('span'), value:uiElement('b') };
        if (item.type === 'button') {
          row.control = uiButton('', () => row.action?.()); row.el.append(row.control);
        } else {
          row.el.append(row.label, row.value);
          if (item.type === 'progress') { row.control = uiProgress('',0); row.el.append(row.control); }
        }
        rows.set(item.id,row);
      }
      const label = uiT(item.label, item.params);
      if (item.type === 'button') {
        row.control.firstChild.textContent = label;
        row.control.disabled = !!item.disabled; row.action = item.onClick;
      } else {
        row.label.textContent = label;
        if (item.type === 'countdown') {
          const seconds = Math.max(0, Math.ceil(item.seconds || 0));
          row.value.textContent = Math.floor(seconds / 60) + ':' + String(seconds % 60).padStart(2,'0');
        } else if (item.type === 'progress') {
          row.control.max = item.max > 0 ? item.max : 1;
          row.control.value = item.value || 0; row.control.setAttribute('aria-label',label);
          row.value.textContent = row.control.value + '/' + row.control.max;
        } else row.value.textContent = item.value ?? '';
      }
      const at = host.children[active.size - 1];
      if (at !== row.el) host.insertBefore(row.el, at || null);
    }
    for (const [id,row] of rows) if (!active.has(id)) { row.el.remove(); rows.delete(id); }
    host.hidden = !active.size;
  }
  return { render, refresh: () => render(last) };
}

// 注册时适配 C0 的 getHUD() → string|null 约定，仍由管理器控制刷新节奏。
export function uiHudMode(def, hud) {
  return { ...def, create() {
    const mode = def.create(), read = mode.getHUD;
    if (read) mode.getHUD = () => {
      hud.render(read.call(mode));
      return null;
    };
    return mode;
  } };
}

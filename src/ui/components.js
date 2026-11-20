// 组件只创建原生节点。文字由调用方翻译，回调随节点一起释放。
let uiControlId = 0;
export function uiElement(tag, className, text) {
  const el = document.createElement(tag);
  if (className) el.className = className;
  if (text !== undefined) el.textContent = text;
  return el;
}
const uiIconPaths = {
  sandbox: 'M3 16l9 5 9-5M3 12l9 5 9-5M3 8l9-5 9 5-9 5z',
  defense: 'M12 3l8 3v6c0 5-5 8-8 10-3-2-8-5-8-10V6zM8 12l3 3 5-6',
  puzzle: 'M3 5h6a3 3 0 1 1 6 0h5v6a3 3 0 1 0 0 6v4h-6a3 3 0 1 0-6 0H3z',
  civ: 'M2 21h20M4 21V9l5-4 5 4v12M14 12l6-3v12M7 12h3M7 16h3',
  eco: 'M4 20C2 10 9 4 21 3c-1 11-6 17-14 15M3 22L16 9',
  book: 'M12 6c-3-2-6-3-10-2v15c4-1 7 0 10 2 3-2 6-3 10-2V4c-4-1-7 0-10 2v15',
  settings: 'M3 6h7m5 0h6M3 12h12m4 0h2M3 18h3m5 0h10M11 3v6m5 0v6m-8 0v6',
  back: 'M19 12H5m7-7-7 7 7 7', play: 'M7 4l14 8-14 8z',
  pause: 'M8 5v14M16 5v14', restart: 'M4 9a8 8 0 1 1 0 6M3 3v7h7',
  home: 'M2 11l10-9 10 9M5 10v11h14V10', victory: 'M7 3h10v5c0 7-10 7-10 0zM7 5H3v3c0 3 2 4 5 4m9-7h4v3c0 3-2 4-5 4m-4 2v6m-5 1h10',
};
export function uiIcon(name) {
  if (!Object.hasOwn(uiIconPaths, name)) throw new RangeError('未知图标');
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg'), path = document.createElementNS(ns, 'path');
  for (const [k,v] of Object.entries({viewBox:'0 0 24 24', width:'20',height:'20',fill:'none',stroke:'currentColor','stroke-width':'1.6','stroke-linecap':'round','stroke-linejoin':'round','aria-hidden':'true',focusable:'false'})) svg.setAttribute(k,v);
  path.setAttribute('d', uiIconPaths[name]); svg.append(path); return svg;
}
export function uiButton(label, action, icon) {
  const el = uiElement('button', 'ui-button'); el.type = 'button';
  if (icon) el.append(uiIcon(icon));
  el.append(uiElement('span', '', label)); el.addEventListener('click', action); return el;
}
export function uiPanel(title, ...contents) {
  const el = uiElement('section', 'ui-panel'), heading = uiElement('h2', '', title);
  heading.id = 'ui-heading-' + ++uiControlId;
  el.setAttribute('aria-labelledby', heading.id); el.append(heading, ...contents); return el;
}
export function uiModal(title, content, back, background = []) {
  const el = uiElement('section', 'ui-modal');
  el.tabIndex = -1; el.setAttribute('role', 'dialog'); el.setAttribute('aria-modal','true'); el.setAttribute('aria-label', title);
  el.append(content);
  let previous, inertState;
  const controls = () => [...el.querySelectorAll('button, input, select, [tabindex]')].filter(n => !n.disabled && n.tabIndex >= 0 && !n.closest('[hidden]'));
  el.addEventListener('keydown', e => {
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); back(); }
    if (e.key !== 'Tab') return;
    const a = controls(), first = a[0] || el, last = a.at(-1) || el;
    if (e.shiftKey && (document.activeElement === first || document.activeElement === el)) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  });
  return {
    el,
    open(host, focus) {
      previous = document.activeElement; inertState = background.map(n => n.inert);
      background.forEach(n => { n.inert = true; }); host.append(el);
      (focus || controls()[0] || el).focus();
    },
    close() {
      el.remove();
      background.forEach((n,i) => { n.inert = inertState[i]; });
      if (previous?.isConnected) previous.focus();
    },
  };
}
export function uiTabs(items, selected = 0, label = '') {
  const el = uiElement('div', 'ui-tabs'), bar = uiElement('div', 'ui-tablist');
  bar.setAttribute('role','tablist'); if (label) bar.setAttribute('aria-label',label); el.append(bar);
  function select(i) {
    [...bar.children].forEach((b,j) => {
      b.setAttribute('aria-selected', String(i === j)); b.tabIndex = i === j ? 0 : -1;
      items[j].panel.hidden = i !== j;
    });
  }
  items.forEach(({label,panel}, i) => {
    const b = uiButton(label, () => select(i)), id = 'ui-tab-' + ++uiControlId;
    b.setAttribute('role','tab'); b.id = id; panel.id = id + '-panel'; panel.setAttribute('role','tabpanel');
    panel.setAttribute('aria-labelledby',id); b.setAttribute('aria-controls',panel.id);
    bar.append(b); el.append(panel);
    b.addEventListener('keydown', e => {
      const next = { ArrowRight:(i+1)%items.length, ArrowLeft:(i+items.length-1)%items.length, Home:0, End:items.length-1 }[e.key];
      if (next === undefined) return;
      e.preventDefault(); select(next); bar.children[next].focus();
    });
  });
  select(selected); return el;
}
export function uiField(label, input) {
  const row = uiElement('label','ui-field'), caption = uiElement('span','',label);
  caption.id = 'ui-label-' + ++uiControlId; input.setAttribute('aria-labelledby',caption.id);
  row.append(caption,input); return row;
}
export function uiSlider(label, min, max, value, change) {
  const input = uiElement('input'); input.type = 'range'; input.min = min; input.max = max; input.value = value;
  const out = uiElement('output','',value), row = uiField(label,input);
  out.setAttribute('aria-hidden','true'); row.append(out);
  input.addEventListener('input', () => { out.value = input.value; change(+input.value); }); return row;
}
export function uiToggle(label, checked, change) {
  const input = uiElement('input'); input.type = 'checkbox'; input.checked = checked;
  input.addEventListener('change', () => change(input.checked)); return uiField(label,input);
}
export function uiSelect(label, options, value, change) {
  const input = uiElement('select');
  for (const [v,name] of options) { const o = uiElement('option','',name); o.value = String(v); input.append(o); }
  input.value = String(value); input.addEventListener('change', () => change(input.value)); return uiField(label,input);
}
export function uiTooltip(anchor, text) {
  const tip = uiElement('span','ui-tooltip',text); tip.id = 'ui-tip-' + ++uiControlId; tip.hidden = true;
  tip.setAttribute('role','tooltip');
  anchor.setAttribute('aria-describedby',[anchor.getAttribute('aria-describedby'),tip.id].filter(Boolean).join(' '));
  let focused = false, hovered = false;
  function update() { tip.hidden = !focused && !hovered; }
  anchor.addEventListener('focus', () => { focused = true; update(); });
  anchor.addEventListener('blur', () => { focused = false; update(); });
  anchor.addEventListener('mouseenter', () => { hovered = true; update(); });
  anchor.addEventListener('mouseleave', () => { hovered = false; update(); });
  anchor.addEventListener('keydown', e => { if (e.key === 'Escape' && !tip.hidden) { e.stopPropagation(); tip.hidden = true; } });
  return tip;
}
export function uiToast(host, text, delay = 2200) {
  host.setAttribute('role','status'); host.setAttribute('aria-live','polite');
  host.textContent = text; host.classList.add('show'); clearTimeout(host.uiToastTimer);
  host.uiToastTimer = setTimeout(() => { host.classList.remove('show'); host.textContent = ''; }, delay);
}
export function uiProgress(label, value, max = 100) {
  const el = uiElement('progress','ui-progress'); el.max = max; el.value = value; el.setAttribute('aria-label',label); return el;
}
export function uiList(items, grid = false) {
  const list = uiElement('ul',grid ? 'ui-card-grid' : 'ui-list');
  for (const item of items) { const li = uiElement('li'); li.append(item); list.append(li); }
  return list;
}
export function uiCardGrid(items) { return uiList(items, true); }

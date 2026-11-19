'use strict';
/* 游戏层事件总线（和引擎的世界事件不同：这里是模式之间、模式和界面之间的消息）。
 * 约定的消息：
 *   'mode:enter' {id}  'mode:exit' {id}  'pause' {paused}
 *   'world:<type>' 引擎事件原样转发（reaction、explosion……，见 docs/API.md）
 *   'outcome' {state, score, detail}  模式胜负出现时
 *   'budget' {material, left}  预算变化 */
export function createBus() {
  const map = new Map();
  return {
    on(type, fn) { if (!map.has(type)) map.set(type, []); map.get(type).push(fn); return () => this.off(type, fn); },
    off(type, fn) { const a = map.get(type); if (!a) return; const i = a.indexOf(fn); if (i >= 0) a.splice(i, 1); },
    emit(type, data) {
      const a = map.get(type); if (!a) return;
      for (const fn of a.slice()) { try { fn(data); } catch (e) { console.error('总线处理函数出错', type, e); } }
    },
    clear() { map.clear(); },
  };
}

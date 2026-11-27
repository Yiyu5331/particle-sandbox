'use strict';
/**
 * 模式接口（docs/ARCHITECTURE.md「模式」）。每个模式是一个对象，管理器按这个顺序调用：
 *
 *   init(ctx, params)        进入模式：用 ctx.createWorld(...) 建自己的世界，搭界面
 *   每帧：preFrame?(now, dt) → [每个模拟步：beforeStep?() → world.step(1) → onEvent(e)… → update(step)] → 渲染 → renderOverlay?(g, view) → postFrame?(now)
 *   getHUD() → string | null；X4 在注册时适配结构化数据（见 docs/UI.md）
 *   checkOutcome() → {state:'playing'|'won'|'lost', score, detail}   每 30 步问一次；不是 playing 就暂停并广播 'outcome'
 *   serialize() → 可 JSON 的对象；deserialize(o)
 *   dispose()                离开模式：拆界面、释放世界
 *
 * ctx（init 时给）：{ game, bus, createWorld(opts), setWorld(w), toast, QS, renderer: {invalidate, resize}, overlay: () => CanvasRenderingContext2D }
 * 规则：事件处理（onEvent）不能改变本步结果——它在一步跑完之后才被调用，里面 world.exec 的命令从下一步起生效。
 */
export const OUTCOME_PLAYING = Object.freeze({ state: 'playing', score: 0, detail: '' });

/** 空模式（开发中）的工厂：能从菜单进出，画面上显示“开发中” */
export function placeholderMode(id, name, desc) {
  return {
    id, name, desc, placeholder: true,
    create() {
      let world = null, ctx = null;
      return {
        id, name,
        init(c) {
          ctx = c;
          world = c.createWorld({ width: 160, height: 100, seed: 1 });
          c.setWorld(world);
          c.showPlaceholder(name, desc);
        },
        update() {},
        onEvent() {},
        renderOverlay() {},
        getHUD() { return name + ' · 开发中'; },
        checkOutcome() { return OUTCOME_PLAYING; },
        serialize() { return { world: world.serialize() }; },
        deserialize(o) { if (o && o.world) world.deserialize(o.world); },
        dispose() { ctx.hidePlaceholder(); world.dispose(); world = null; },
      };
    },
  };
}

import { createWorld } from '../engine/index.js';
import { OUTCOME_PLAYING } from '../game/mode.js';

// 演示复用同一个渲染器和模拟时钟，有自己的种子、世界和生命周期。
export const uiDemoMode = {
  id:'home', name:'主菜单', desc:'',
  create() {
    let world;
    return {
      init(ctx) {
        world = createWorld({width:208, height:112, seed:412});
        world.exec('loadScene', {index:0});
        world.step(75);
        ctx.setWorld(world);
      },
      update() {}, getHUD: () => null, checkOutcome: () => OUTCOME_PLAYING,
      dispose() { world.dispose(); },
    };
  },
};

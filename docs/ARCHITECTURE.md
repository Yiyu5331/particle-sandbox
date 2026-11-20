# 架构

粒子沙盘是一个确定性的格子物理模拟（落沙类），外面套了一层「模式」：沙盘是其中一种，以后的塔防、解谜、文明、生态都建在同一个引擎上。

## 目录

```
src/
  engine/      纯模拟：不碰 DOM / Canvas / Audio / 时钟，能在 Node 里跑（禁止 Codex 修改）
    index.js     公开入口（唯一允许外部 import 的文件），index.d.ts 是类型声明
    world.js     公开世界 API：createWorld、多世界切换、事件派发、区域、快照、回放
    grid.js      网格数组、分块唤醒、put/morph、重力方向
    materials.js 材料表和派生的属性数组 M_*
    rules.js     接触反应规则表
    cells.js     逐格更新（每步扫描清醒的分块）
    fluids.js combustion.js plants.js temperature.js slow.js   各类物理
    particles.js 飞行粒子池（溅起、爆炸碎片）
    explosion.js 爆炸波；electric.js 电；structure.js 结构支撑、刚体、倒塌
    weather.js   粗网格天气：风、水汽、云、降水、昼夜、闪电
    step.js      一步的流水线 simStep()
    events.js    事件计数（只计数，不影响模拟）
    paint.js commands.js   写操作和命令表、录制、回放
    serialize.js 哈希、存档编码
    scenes.js    10 个预设场景
    env.js rng.js dmath.js 环境参数、xorshift32、确定性三角函数
  render/      WebGL2 渲染器（Canvas2D 退路）：每帧从世界取一次只读状态（禁止 Codex 修改）
  audio/       WebAudio 程序合成的声床和音效
  game/        模式管理器（主菜单、切换、暂停、主循环、事件分发）、总线、预算、区域辅助、热身
  modes/
    sandbox/     沙盘模式：v4 的全部界面（ui.js）+ 模式接口（index.js）
    defense/ puzzle/ civ/ eco/   空模式（开发中）
  entities/    实体接口说明（只有接口，见 docs/ENTITIES.md）
  meta/        跨模式的元系统接口（成就、解锁、统计；只有接口）
  ui/          页面级小工具（$、toast、下载、地址栏参数、格子像素大小）
  index.html   页面模板（构建时把脚本塞进 /*BUNDLE*/）
  main.js      启动
tests/
  lib/         测试工具（harness、黄金快照脚本和比对）
  suites/      Node 和浏览器都跑的模拟用例：v3.js v4.js v41.js api.js
  browser/     只在浏览器跑的：像素 / 音效 / 导入导出用例、黄金快照、?test ?soak ?bench ?golden ?coldboom 入口
  golden.json  黄金快照；replays/ 5 段录制
tools/
  build.mjs    打包成 dist/particle-sandbox.html（不入库，CI 构建）
  test.mjs     纯净扫描 + 依赖方向 + 全部模拟用例 + 黄金快照
  soak.mjs     10 个场景长跑稳定性
  bench.mjs    性能基准（稳态、冷启动）
  golden.mjs   黄金快照 check / record
  migrate/     C0 迁移用过的脚本；imports.py 至今用来重新生成 import
docs/          API.md ARCHITECTURE.md ENTITIES.md API_REQUESTS.md
v4-src/        重构前的 v4.1 分块源码（冻结，只作性能和行为的对照基线）
```

## 分层和依赖方向

```
main.js ─→ game/ ─→ modes/* ─→ engine/index.js
              │         │
              ├→ render/ ┤ (渲染器、音频只读世界状态)
              └→ audio/ ─┘
engine/ 不依赖任何外部目录
```

- 引擎只依赖引擎自己。
- 引擎外面只能 import `src/engine/index.js`（`tools/test.mjs` 的「依赖方向」检查）。
- 测试（`tests/`）可以直接用引擎内部函数，因为它们要测内部行为。

## 引擎内部：模块级状态

引擎延续了 v4 单文件的写法：每个模块的状态是顶层 `let` 变量（`type`、`temp`、`W`、`tick`……），函数直接读写，热循环里没有对象间接访问，这是性能的来源。拆成 ES 模块后：

- 模块之间读状态靠 ES 模块的**活绑定**：`grid.js` 里 `allocGrid` 给 `type` 重新赋值，`cells.js` 读到的就是新数组。
- 跨模块**写**必须调用所属模块的 setter：每个有状态的模块都有生成好的 `xxxSave() / xxxLoad(s) / xxxSet(name, v)`（比如 `gridSet('tick', 0)`）。
- 新增顶层 `let` 状态时，必须同时加进这个模块的 `Save/Load/Set`。否则多世界切换时它会在世界之间串。

### 多世界

`world.js` 的 `MODULES` 列出全部有状态的模块。`activate(w)` 先把台上世界的全部模块状态收起来（`xxxSave()` 返回的只是引用，不复制），再把 `w` 的装上去（`xxxLoad`）。新世界从模块刚加载时的状态（`PRISTINE`）深拷贝一份开始。世界的每个公开方法开头都先 `activate(this)`。

「宿主默认世界」就是没用 `createWorld` 时的模块状态，`tests/` 的用例和 Node 工具都在它上面跑。

## 一步的流水线（`step.js` 的 `simStep`）

```
advanceTick → 分块唤醒计时 → 场景脚本 → 天气（风、水汽、云、降水、昼夜、闪电）
→ 爆炸 → 电 → 结构（支撑检测、刚体）→ 逐格更新（清醒的分块，交替扫描方向）
→ 温度扩散 → 飞行粒子 → 慢过程（蒸发、植物、渗水，按 1/8 轮转）
```

`world.step()` 在外面包了一层：`simStep()` → 扫描新出现的材料 → `eventsCollect()` 按固定顺序汇总事件 → 区域变化检测 → 派发给订阅者。事件计数（`events.js` 的 `noteXxx`）散在引擎各处，只做计数，不影响模拟，也不进哈希。

## 确定性

- 随机数只用 `rng.js` 的 xorshift32（状态进哈希、进存档）。
- 没有 `Math.random`、时钟、超越函数；三角函数用 `dmath.js` 的多项式，开方用 `Math.sqrt`（IEEE 规定精确舍入）。
- 遍历顺序、池分配、事件顺序固定；池子回收时把槽位清零（死槽位不会让哈希漂）。
- 输入全部是命令，录成 `{step, command, args}`；回放从同一种子开始。
- `tests/golden.json` 是行为基线：C0 重构前后逐位一致。任何改动模拟行为的修改都必须说明理由并重录（`node tools/golden.mjs record`），纯重构不允许让它变。

## 模式

模式管理器（`src/game/manager.js`）负责主菜单（顶栏「菜单」按钮或 M 键）、切换、暂停、主循环和事件分发。模式接口：

```js
{
  id, name,
  init(ctx, params),       // 用 ctx.createWorld 建自己的世界，ctx.setWorld 交给渲染器 / 声音 / 事件分发
  update(step),            // 每个模拟步之后
  onEvent(e),              // 引擎事件（同时会以 'world:<type>' 转发到 game.bus）
  renderOverlay(g, view),  // 2D 叠加层（设置 wantsOverlay: true 才会调用）
  getHUD(),                // 状态栏里的一行字
  checkOutcome(),          // {state:'playing'|'won'|'lost', score, detail}，每 30 步问一次
  serialize(), deserialize(o), dispose(),
  // 可选：preFrame(now, dt)、beforeStep()、postRender(now)、postFrame(now, dt)、frameTiming(dt)
}
```

模式定义（注册到管理器的）是 `{id, name, desc, create() → 模式实例}`。空模式用 `placeholderMode(id, name, desc)` 生成。沙盘离开时不销毁世界，回来接着玩。

主循环：固定 60Hz 模拟步长，和渲染帧率解耦；跟不上就丢步，不追帧。`game.busy` 为真时（浏览器自测进行中）主循环不碰模式和它的世界。

## 渲染

`src/render/renderer.js`：每帧开头 `syncState()` 从当前世界取一次 `renderState()`（活引用，存在 `$W $type $temp …` 这些模块变量里），然后：

```
状态打包（只重写清醒的分块）→ 场景着色（底色 + 自发光双输出）→ 辉光时间累积
→ 5 级降采样 / 升采样（bloom + 大范围光照）→ 光照合成 → 后处理（震动、冲击波、色差、闪白、色调映射、暗角、颗粒）
```

`gridEpoch` 变了（清空、读档、换尺寸）就整屏重画。渲染器只读世界，唯一的「写」是统计用的 `chunkCount` 和 `perf` 计时字段，都不进哈希。

## 构建

`node tools/build.mjs` → `dist/particle-sandbox.html`，单文件、零依赖，可以直接双击打开。`dist/` 不入库：CI（`.github/workflows/ci.yml`）每次构建并把它作为 `particle-sandbox` 产物上传。

选纯 Node 而不是 esbuild：引擎模块之间大量依赖活绑定，最省事也最贴近 v4 的做法，是按 ES 模块的求值顺序把各模块的顶层代码拼进同一个作用域。活绑定天然成立，生成的代码就是源代码本身（浏览器里调试直接对得上），也不用装任何依赖。代价是**所有模块的顶层名字必须全局唯一**，构建脚本会检查，重名就报错。

`src/index.html` 只是模板，不能直接打开；改完代码先构建，再开 `dist/particle-sandbox.html`。

## 设置的唯一数据来源

玩家设置（画质、格子大小、音量、语言、按键……）只有一份：**玩家档案（`src/meta/profile`，X2）里的 `settings`**。

- 设置界面（X4）和沙盘自己的控件（`src/modes/sandbox/ui.js` 里的开关、滑块）都只读写档案的 `settings`，不各自往 `localStorage` 或别的地方存。
- 读：启动时从档案取一次，之后订阅档案的变化来更新界面和渲染器；写：改档案，由档案负责持久化并通知订阅者。
- 新增设置项时在档案的 settings 结构里加字段（带默认值和版本迁移），再在界面里接上。不要在模式或界面里新建第二个存储位置。
- 模拟状态（世界、录制）不属于设置，照旧走 `world.serialize()` / 录制。

## 测试

| 命令 | 内容 |
|---|---|
| `node tools/test.mjs` | 引擎纯净扫描、依赖方向、全部模拟用例（v3 + v4 + v4.1 + API）、黄金快照到第 5000 步，然后自动发现并逐个独立进程运行 `tests/suites/*.test.{js,mjs}` 和 `tests/dom/*.test.{js,mjs}`（DOM 用例前先构建临时单文件，路径在 `PARTICLE_TEST_HTML`）。`--golden=full` 跑满 36000 步，`--only=关键字`，`--grid=宽x高`，`--no-dom`，`--dom-only` |
| `node tools/soak.mjs` | 10 个场景各 36000 步，最后 2 分钟每种材料趋势 < 2% |
| `node tools/bench.mjs` | 稳态每步耗时：ES 模块引擎 vs 公开 API vs v4.1 单文件；`--cold` 冷启动第一次大爆炸 |
| `node tools/golden.mjs check` | 完整黄金快照 |
| 浏览器 `?test=1` | 全部用例 + 渲染像素 / 音效 / 导入导出 + 黄金快照到 5000 步 + 性能 |
| 浏览器 `?soak=1` `?bench=1` `?golden=1` `?coldboom=1` | 同名工具的浏览器版（加 `&nowarm=1` 不热身） |

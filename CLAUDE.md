@AGENTS.md

# 引擎维护者补充（Claude）

AGENTS.md 里「禁止修改 src/engine/ 和 src/render/」是给做模式的协作者的。维护引擎的一方（Claude）可以改，但要守下面这些约定。

## 模块级状态

- 每个引擎模块的状态是顶层 `let`。别的模块靠 ES 模块活绑定读它；**写必须走所属模块的 setter**：`gridSet('tick', 0)`、`structureSet('structCooldown', 0)`、`envSet('onBoom', fn)`……直接给别的模块导出的 `let` 赋值在 ES 模块里是运行时错误。
- 新增顶层 `let` 时，同时把它加进本模块末尾的 `xxxSave / xxxLoad / xxxSet`（迁移脚本生成的，之后手工维护）。漏了的话多世界切换时它会在世界之间串，`tests/suites/api.js` 的交错用例不一定能发现。
- 新增有状态的模块时，把它的 Save/Load 加进 `src/engine/world.js` 的 `MODULES`。
- 进哈希的状态在 `serialize.js` 的 `stateScalars / stateArrays / bodyState`；进存档的在 `serializeWorld / deserializeWorld`。新状态如果影响模拟，两边都要加。
- 池子（飞行粒子、爆炸）回收时把槽位清零：死槽位的残留值会进哈希。

## import

- import 由脚本生成：改完代码跑 `python3 tools/migrate/imports.py src/engine`（或别的目录），它按实际用到的名字重写每个文件的 import。引擎文件只会从引擎里 import；引擎外的文件只会从 `src/engine/index.js` import，名字不在 index 里会打印「非公开」。
- 要给外面用的新东西，加进 `src/engine/index.js` 和 `index.d.ts`，并更新 `docs/API.md`。
- `tools/migrate/run.sh` 已经禁用：它会从 `v4-src` 重新生成 `src/engine`，覆盖之后的全部手工修改。

## 事件

- 计数点散在引擎里：`noteRule`（`cells.js` applyRule）、`noteMat`（`grid.js` put / morph）、`noteIgnite`（`combustion.js` ignite、`explosion.js` 两处直接点燃）、`noteExtinguish`（`combustion.js` 熄灭两处）、`noteBoom`（`startExplosion`）、`noteCollapse`（`structure.js` makeBody）、`noteBolt`（`weather.js` lightning）。
- 计数只能读模拟状态、不能改；`events.js` 的状态不进哈希。`eventsCollect` 读完即清；宿主直接调 `simStep()` 时列表有上限（4096），不会无限长。

## 隐蔽的耦合

- 特效钩子（`env.onBoom / onThunder / onCrash`）在 `simStep` 中途被调用。钩子里如果调用了任何世界方法，会把别的世界换上台，模拟中途换状态，后果严重。文档里写了禁止，代码没有拦。
- 渲染器会写 `chunkCount`（Canvas2D 退路里统计粒子数）和 `perf.pack/draw/post`，都不进哈希。
- `resetWorld` 是手写的（不是生成的），负责把一局开头需要归零的状态都归零：环境、场景状态、重力、网格、步数、慢过程相位、结构状态、事件、随机数、录制。新增「一局内累积」的状态要在这里清。
- 两个旧用例对网格尺寸（随机序列）很敏感，C0 时已改稳（冰块加大、休止角三堆取平均）。新写的统计类用例尽量用大样本或多次取平均。

## 黄金快照

- `tests/golden.json`：10 个场景（种子 1000+k，网格 240×150）在第 0/1000/5000/36000 步的哈希 + 5 段录制回放。Node（`node tools/golden.mjs check`）和浏览器（`?golden=1`）都必须逐位一致。
- 纯重构不允许让它变。**有意**改变模拟行为时：先说明原因，跑 `node tools/golden.mjs record` 重录，`node tools/soak.mjs` 确认 10 个场景仍然稳定，在提交说明里写清楚哪些哈希变了、为什么。

## 性能

- 基线是 `v4-src/` 拼接的 v4.1 单文件引擎：`node tools/bench.mjs` 会同时跑它、ES 模块引擎和公开 API 三种，打印相对差异。重构类改动要求稳态每步耗时差异在 5% 以内。
- 浏览器预览面板被隐藏时页面是低优先级，计时数字不可信（固定负载对照会从 0.03ms 涨到 0.3ms 以上）。冷启动这类数字用 Node（`bench.mjs --cold`）。

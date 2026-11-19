# 粒子沙盘：给 AI 协作者的说明

一个确定性的格子物理沙盘（沙、水、火、熔岩、爆炸、结构倒塌、天气），浏览器里运行，构建成一个零依赖的单文件 HTML。外层是「模式」框架：现在有完整的沙盘模式和 4 个空模式（塔防、解谜、文明、生态），新玩法都做成模式。

先读这三份：`docs/ARCHITECTURE.md`（结构）、`docs/API.md`（引擎公开接口）、`docs/ENTITIES.md`（实体接口）。

## 目录速览

| 目录 | 内容 | 能不能改 |
|---|---|---|
| `src/engine/` | 纯模拟（Node 可跑），公开入口 `index.js`，类型 `index.d.ts` | **禁止修改** |
| `src/render/` | WebGL2 渲染器 | **禁止修改** |
| `src/audio/` | 程序合成的声音 | 改之前先在 API_REQUESTS 里说明 |
| `src/game/` | 模式管理器、主菜单、总线、预算、区域辅助 | 可以改，保持模式接口不变 |
| `src/modes/<id>/` | 各个模式 | 可以改（自己负责的模式） |
| `src/entities/` `src/meta/` | 实体、元系统（目前只有接口） | 可以实现 |
| `src/ui/` | 页面小工具 | 可以改 |
| `src/index.html` | 页面模板 | 可以改（加自己模式的 DOM） |
| `tests/` | 用例和黄金快照 | 可以加用例；**不能改** `tests/golden.json` 和 `tests/replays/` |
| `tools/` | 构建和测试脚本 | 尽量别改 |
| `v4-src/` | 重构前的源码，只作对照 | 不要改 |

## 常用命令

```bash
node tools/test.mjs                 # 必跑：纯净扫描 + 依赖方向 + 全部模拟用例 + 黄金快照（约 1 分钟）
node tools/build.mjs                # 构建 dist/particle-sandbox.html
node tools/test.mjs --only=关键字    # 只跑名字里带关键字的用例
node tools/golden.mjs check         # 完整黄金快照（36000 步，约 1 分钟）
node tools/soak.mjs                 # 10 个场景长跑稳定性（十几分钟）
node tools/bench.mjs                # 性能基准
```

浏览器：构建后用任意静态服务器打开 `dist/particle-sandbox.html`，加 `?test=1` 跑浏览器全量自测，`?golden=1` 完整黄金快照，`?mode=puzzle` 直接进某个模式。

## 硬规则

1. **禁止修改 `src/engine/` 和 `src/render/`。** 缺接口就在 `docs/API_REQUESTS.md` 里按模板提需求，交接时说明。
2. **引擎外面只能 import `src/engine/index.js`。** 不要 import `src/engine/grid.js` 之类的内部文件（`node tools/test.mjs` 会检查）。
3. **改世界只用 `world.exec(命令)`。** `getField` / `view` 返回的数组只能读。
4. **确定性**：模式和实体里影响世界的逻辑不能用 `Math.random`、`Date`、`performance.now`；需要随机数就自己实现一个用种子初始化的 xorshift。画面、声音这类不影响世界的代码不受限。
5. **事件处理不能改变本步结果**（引擎保证了这一点），但处理函数里 `exec` 的命令会在下一步生效并进录制，回放时一致。
6. **顶层名字全局唯一**：构建会把所有模块拼进同一个作用域，任何两个模块的顶层 `function / const / let` 不能重名（构建会报错）。给自己模式的顶层名字加前缀，比如 `puzzleLevels`、`defenseSpawn`。
7. 黄金快照必须保持不变。你的改动让 `node tools/test.mjs` 的黄金快照失败，说明你碰到了模拟行为，停下来，不要重录。
8. 代码注释和界面文字用中文。

## 做一个新模式

1. 在 `src/modes/<id>/index.js` 里导出模式定义 `{ id, name, desc, create() }`，`create()` 返回实现了模式接口的对象（见 `docs/ARCHITECTURE.md`「模式」和 `src/game/mode.js`）。空模式现在用的是 `placeholderMode(...)`，直接替换掉。
2. `init(ctx, params)` 里用 `ctx.createWorld({width, height, seed})` 建世界、`ctx.setWorld(w)` 交给渲染器，用 `w.exec('loadScene', …)` 或 `fillRect` 等命令搭关卡，用 `w.addRegion` 设保护区 / 目标区。
3. 胜负写在 `checkOutcome()`，HUD 写在 `getHUD()`，叠加层设 `wantsOverlay: true` 后在 `renderOverlay(g, view)` 里画。
4. 预算用 `src/game/budget.js` 的 `createBudget({[材料id]: 格数})`，玩家落笔走 `budget.brushStroke(world, args)`。
5. 在 `tests/suites/` 加你的模式的 Node 用例（不依赖 DOM：直接 `createWorld` 跑逻辑），在 `tools/test.mjs` 里 import 它。
6. `dispose()` 里拆掉自己加的 DOM 和监听，释放世界。

## 分支和交接

- 分支名：`codex/<模式或模块>-<简短描述>`，例如 `codex/puzzle-level-format`。从 `main` 拉，一个分支只做一件事。
- 提交前必须：`node tools/test.mjs` 全部通过，`node tools/build.mjs` 成功；改了界面的话在浏览器里打开 `?test=1` 确认全部通过。
- 交接写在项目根目录的 `HANDOFF.md`（当前目标、已完成、决策和原因、未完成、建议下一步、日期和更新者）。代码状态以 `git status` / `git diff` 为准。
- 不要提交 `dist/` 以外的构建产物；不要推送、不要改远程设置，除非用户要求。

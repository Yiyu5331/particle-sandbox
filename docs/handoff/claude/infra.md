# claude/infra：协作基础设施

2026-11-21，Claude Code。从 main（0f4bd8e）拉出，目的是先修掉第 1 批合并冲突的根源，合进 main 后 Codex 的 4 个分支再 rebase。

## 已完成

- **dist/ 不入库**：`git rm --cached dist/particle-sandbox.html`，`dist/` 进 `.gitignore`。CI 构建并上传 `particle-sandbox` 产物。AGENTS.md 的规则改成「不提交任何构建产物」。
- **交接按分支拆开**：`docs/handoff/<分支名>.md`（`/` 是子目录），根目录不放 `HANDOFF.md`。说明见 `docs/handoff/README.md`。
- **统一 package.json**：开发依赖 `acorn 8.19.0`、`fake-indexeddb 6.2.4`、`happy-dom 21.0.4`（版本取自 codex/x2-meta、codex/x4-ui），scripts：`test build golden levels mapgen`，`package-lock.json` 一起提交。
- **统一 CI**：`.github/workflows/ci.yml`，一个 job 依次：npm ci → 构建（上传产物）→ `node tools/test.mjs --no-dom` → `node tools/golden.mjs check` → DOM 测试 → `node tools/levels.mjs validate` → `node tools/mapgen.mjs audit`。后三步在目录或脚本不存在时打印「跳过」。
- **tools/test.mjs 自动发现用例**：`tests/suites/*.test.{js,mjs}`（node:test，每个文件独立进程）和 `tests/dom/*.test.{js,mjs}`（先构建临时单文件，路径在 `PARTICLE_TEST_HTML`，兼容旧名 `PARTICLE_UI_TEST_HTML`）。新增 `--no-dom`、`--dom-only`。以后加用例不用改 test.mjs。
- **设置唯一来源**：docs/ARCHITECTURE.md 新增一节：玩家档案（`src/meta/profile`）的 `settings` 是唯一来源，设置界面和沙盘控件只读写档案。
- **AGENTS.md「共享文件」**：`src/modes/sandbox/ui.js`、`src/main.js`、`src/index.html`、`tools/test.mjs`，改动尽量小、新功能放新文件。
- **220×139 的两条旧用例**：
  - 「水下落有加速度，水面能静止并休眠」：**测试问题**。水面会被慢过程偶尔蒸掉一格，补水时唤醒一两个块几百步；原来只在第 600 步取一个瞬间，网格尺寸改变随机序列后碰巧赶上。改成之后 1200 步里统计：全休眠 ≥ 70% 且最多 4 个活跃块。7 种网格尺寸全部通过。
  - 「刚体里的炸药……被火点着」：**引擎 bug**。大块刚体摔碎（`fractureBody` 的分裂分支）时，正在烧的炸药落在裂缝上有一半概率被换成烟尘，引信丢失；不在裂缝上的格子剩余引信被清零。修成：裂缝上点着的炸药当场引爆（和小块分支、`debrisCell` 一致），其余格子保留剩余引信（和 `freezeBody` 一致）。随机数消耗顺序不变。
- **电火花重力测试**（复核 codex/x5-puzzle 的改动）：30 个种子 × 4 个方向统计分叉火花的平均位移，沿重力分量平均 < 1.5 格；同时保留「最初那一格 70 步里类型和 seed 不变」。实测四个方向平均 −0.24 / −0.19 / +0.59 / −0.06，单种子标准差约 2.2，**火花不随重力漂移，不是引擎 bug**；原来单种子 `|位移| < 4` 的判据会因为随机波动失败。
- **mapgen 写进世界的耗时**：tools/mapgen.mjs 只在 codex/x8-mapgen 上，所以单独做在 `claude/x8-mapgen-bench`（基于 codex/x8-mapgen，一个提交）：bench 增加第二个指标 createWorld + 逐条 exec。实测生成中位 0.32ms / 最慢 4.52ms，写进世界中位 1.48ms / 最慢 8.61ms。

## 黄金快照

重录了 3 个哈希：爆破拆除第 1000 / 5000 / 36000 步（原因：上面的刚体炸药修复，这个场景里导爆索在烧的楼塌下来摔碎）。其余 42 个不变，5 段回放文件逐字节不变。Node `golden.mjs check` 45/45，浏览器 `?golden=1` 45/45，`soak` 爆破拆除稳定。

浏览器 `?test=1` 131/131（面板可见）。性能用例在同样的 276×212 网格上和 main 对照：最慢一帧 6.7ms vs 6.8ms；这一局的爆炸从 91 次变成 668 次，说明修复前 TNT 连爆里大量点着的引信在刚体摔碎时丢了。面板隐藏时跑的一次全量自测出现过 16.9ms 的单帧（485 帧里 1 帧），复测不复现，属于后台页面计时抖动。

## Codex rebase 时要做的

- 删掉各自分支里的 `dist/particle-sandbox.html` 改动、根目录 `HANDOFF.md`（挪到 `docs/handoff/codex/<分支>.md`）、各自的 `package.json` / `package-lock.json`、各自的 workflow（`ci.yml`、`puzzle-levels.yml`、`mapgen-ci.yml`）。
- `tools/test.mjs` 末尾各自追加的子进程调用全部删掉：用例文件放在 `tests/suites/*.test.mjs` 会被自动发现。X4 的 UI 用例挪到 `tests/dom/`，用 `PARTICLE_TEST_HTML`；`check-i18n.mjs` 在用例里自己调用。
- X5：`tests/suites/v4.js` 的电火花改动丢弃，用 main 上的新版本。
- X8：合并时一起合 `claude/x8-mapgen-bench`（或 cherry-pick 它的一个提交）。
- 黄金快照：main 上爆破拆除的 3 个哈希变了，各分支 rebase 后用 main 的 `tests/golden.json`，不要重录。

## 未完成 / 注意

- `~/.agents/memory/handoff-convention.md`（Claude 与 Codex 共用的全局记忆）还写着根目录 `HANDOFF.md`；项目规则以 AGENTS.md 为准，要不要同步改全局记忆等用户决定。

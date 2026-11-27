# 第 1 批集成

2026-11-28，Codex。分支 `codex/batch1-integration` 从 main 的 0f4bd8e 建立，快进到 X8 的 44158e6 后按共同基线整合 X2、X4、X5 的本地工作树内容。三个功能工作树及 C2 开发工作树保留原有状态。

## 完成项

- 2026-11-28，第 1 批已通过 [PR #3](https://github.com/Yiyu5331/particle-sandbox/pull/3) 合并到 main（合并提交 `ea17830`）。`codex/x2-meta`、`codex/x4-ui`、`codex/x5-puzzle`、`codex/x8-mapgen` 四个分支均已由 batch1 取代，可以弃用。

- X5 选关复用 X4 面板和卡片，玩法与编辑表单使用共享按钮、字段、选择器和标签页。X4 包装按管理器节奏渲染 HUD，解谜显示材料用量、倒计时和剩余库存。官方标题、章节、规则、验证提示和结算支持中英文；玩家的标题与草稿保留原文。
- 模式卡片、星级、解锁统一读取 X2 已提交档案的进度摘要。仅内置关卡的有效胜局写入最高星。首胜提交成功后才展示正常胜利结果，失败时可直接重试保存。自制关、编辑器录制及主页演示与官方进度隔离。
- X3 图鉴入口保留占位页。地图生成器从 `?dev=1` 的开发者子菜单打开；直达也须携带 dev 参数。
- [接口清单](../../API_REQUESTS.md) 合并了重复需求。X5 已接入 X4 HUD 包装。C2 合并时由 Claude 接入正式 HUD、移除包装，并复验完整读档与细分热身。
- PR 完全沿用 main 的 ci.yml。它执行构建、产物上传、无头测试、完整黄金快照、DOM、关卡校验及地图扫描。浏览器自测与 Playwright 端到端测试在本机另行验证。

## 验证与复现

- `npm ci --ignore-scripts`、`node tools/build.mjs`、`node tools/test.mjs`、`node tools/golden.mjs check`。
- `npx playwright install chromium` 后运行 `npx playwright test`；本机 Chrome 可用 `PLAYWRIGHT_CHROMIUM_CHANNEL=chrome npx playwright test`。
- 四条浏览器端到端测试使用独立上下文。首关从零进度开始，实际画入 12 格沙、点击运行，胜局后刷新，确认三星与第二关解锁。另覆盖同名自制关、编辑器草稿语言切换、开发者门禁和配额失败后的重试。
- Node 模拟 125 项、档案／解谜／地图 53 项、DOM 10 项（含中英文扫描）、黄金 45 项；浏览器全量自测 133 项。引擎、渲染器、黄金文件与回放均与 main 一致。

## Rebase 交接

基线为 origin/main 的 63b338c。保留 main 的电火花 30 种子检验、黄金基线、设置唯一数据源和测试自动发现。X2/X5/X8 的 node:test 由 tests/suites 加载，X4 的 UI 和中英文检查由 tests/dom 加载。main 的开发依赖之外只补充了用于本地端到端测试的 @playwright/test 并重新生成锁文件。按 infra 交接并入 X8 的写入世界计时（0d7af78）。本分支包含整个第 1 批。

# 第 1 批集成

2026-11-21，Codex。分支 `codex/batch1-integration` 从 main 的 0f4bd8e 建立，快进到 X8 的 44158e6 后按共同基线整合 X2、X4、X5 的本地工作树内容。三个功能工作树及 C2 开发工作树保留原有状态。

## 完成项

- X5 选关复用 X4 面板和卡片，玩法与编辑表单使用共享按钮、字段、选择器和标签页。管理器统一分发 HUD，解谜显示材料用量、倒计时和剩余库存。官方标题、章节、规则、验证提示和结算支持中英文；玩家的标题与草稿保留原文。
- 模式卡片、星级、解锁统一读取 X2 已提交档案的进度摘要。仅内置关卡的有效胜局写入最高星。首胜提交成功后才展示正常胜利结果，失败时可直接重试保存。自制关、编辑器录制及主页演示与官方进度隔离。
- X3 图鉴入口保留占位页。地图生成器从 `?dev=1` 的开发者子菜单打开；直达也须携带 dev 参数。
- [接口清单](../../API_REQUESTS.md) 合并了重复需求。结构化 HUD 已接入；完整读档与细分热身留给 Claude 随 C2 合入并复验。
- PR 工作流统一执行构建、关卡验证、全量测试、Playwright、完整黄金检查与产物上传，另保留地图种子扫描。dist 由源码生成。

## 验证与复现

- `npm ci --ignore-scripts`、`node tools/build.mjs`、`node tools/test.mjs`、`node tools/golden.mjs check`。
- `npx playwright install chromium` 后运行 `npx playwright test`；本机 Chrome 可用 `PLAYWRIGHT_CHROMIUM_CHANNEL=chrome npx playwright test`。
- 四条浏览器端到端测试使用独立上下文。首关从零进度开始，实际画入 12 格沙、点击运行，胜局后刷新，确认三星与第二关解锁。另覆盖同名自制关、编辑器草稿语言切换、开发者门禁和配额失败后的重试。
- Node 模拟 125 项、档案／解谜／地图 53 项、DOM 9 项、黄金 45 项；浏览器全量自测 133 项。引擎、渲染器、黄金文件与回放均与 main 一致。

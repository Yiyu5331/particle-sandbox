# 接口需求

以本集成分支的公开实现为准。模式与界面只从 `src/engine/index.js` 调用引擎。

## 待 Claude 处理

| 需求 | 当前行为与接入方式 | 验收 |
|---|---|---|
| 完整读档命令恢复种子与区域（X2、X5） | C2 工作树已有实现，待 Claude 合入后验证并移除 X5 的区域补建。当前 C0 的 `exec('restoreFull',{json})` 恢复物理状态，但对 `kind:'world'` 仍沿用目标世界的 seed、regions、nextRegion。X2 保存完整文本，X5 校验种子并用公开接口重建区域。 | 恢复世界封装时同时恢复这三项，保持旧 `kind:'full'` 兼容，验证保护规则、回放与黄金快照。 |
| 可报告内部进度的引擎热身（X4） | C2 工作树已提供 `warmUpEngineStages()`，待 Claude 合入并验证。当前 `warmUp()` 同步执行。加载页按四个实际启动阶段更新。 | 支持分阶段异步热身，提供 completed / total / phase 并允许浏览器绘制；仅操作临时世界。 |

## 已完成

- **结构化 HUD（第 1 批集成）**：管理器采样 `getHUD()` 并发送 `hud` 事件，X4 渲染文字或结构化元素，X5 已接入。[HUD 格式](UI.md)
- **笔刷预算（C0）**：`stroke.limit` 限制放置，返回实际 placed / removed。X5 同时使用材料余量与总预算。
- **区域规则（C0）**：`addRegion` 支持保护、材料白名单、遮罩和区域变化追踪。[引擎接口](API.md)

# src/meta

`profile/` 实现玩家设置、跨模式进度、世界槽位和档案备份。存储优先使用 IndexedDB，后备使用 localStorage。接口、格式和迁移流程见[玩家档案与存档](../../docs/META.md)。

图鉴和反应发现订阅 `game.bus` 的世界事件。元系统读取世界快照，模拟写操作由模式负责。成就和累计统计仍在 `types.js` 中保留接口约定。

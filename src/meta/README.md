# src/meta

跨模式的元系统：成就、解锁、玩家统计、存档目录。目前只有接口（`types.js`），没有实现。

约定：
- 元系统只听 `game.bus` 上的消息（`mode:enter`、`mode:exit`、`outcome`、`world:<事件>`），不直接碰世界。
- 数据存在浏览器本地（localStorage），键名以 `particle-sandbox-meta-` 开头；读写都要 try/catch，读不到就当作新玩家。
- 不能影响模拟：元系统里没有任何会进录制的操作。

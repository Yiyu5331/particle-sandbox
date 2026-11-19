# src/entities

实体系统的位置（塔防敌人、文明小人、生态动物……）。目前只有接口，见 `docs/ENTITIES.md` 和 `types.js`。

实现时：只 import `src/engine/index.js`，对世界的改动全部走 `world.exec`，随机数用自己的确定性生成器。

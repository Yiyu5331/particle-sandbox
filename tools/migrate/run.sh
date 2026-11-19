#!/bin/sh
# 一次性迁移流水线（C0 第一步用过）：拆分 v4-src → src/engine。
# 迁移之后 src/engine 已经手工改过（事件、world.js、resetWorld……），再跑会把这些全部覆盖，所以这里直接拒绝。
echo "迁移已经完成，不要再运行（会覆盖 src/engine 的手工修改）。只需要重新生成 import 时用：python3 tools/migrate/imports.py <目录>" >&2
exit 1

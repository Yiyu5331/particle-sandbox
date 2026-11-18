#!/bin/sh
# 迁移流水线：拆分 → 修正跨模块写操作 → 生成各模块的状态函数 → 检查
cd "$(dirname "$0")/../.."
rm -rf src/engine
python3 tools/migrate/split.py && python3 tools/migrate/fixups.py && python3 tools/migrate/statefns.py >/dev/null && python3 tools/migrate/xwrites.py
python3 tools/migrate/imports.py src/engine

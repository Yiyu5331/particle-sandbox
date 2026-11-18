#!/bin/sh
# 在 Node 里跑模拟类用例（不含渲染/UI）
cd "$(dirname "$0")"
{ echo "globalThis.location={search:''};globalThis.__SRC_DIR=process.cwd();"; cat 10-core.js 20-sim.js 22-struct.js 23-weather.js 25-codec.js 26-state.js 27-scenes.js 60-tests.js 62-tests4.js 64-tests41.js; cat <<'JS'
allocGrid(Number(process.env.GW||220), Number(process.env.GH||140));
const only = process.env.ONLY;
if (only) { for (let i = TESTS.length - 1; i >= 0; i--) if (!TESTS[i].name.includes(only)) TESTS.splice(i, 1); }
const t0 = performance.now();
const r = runSimTestsSync(s => { if (!process.env.QUIET || s.startsWith('失败')) console.log(s); });
console.log(`\n${r.pass}/${r.total} 通过，用时 ${((performance.now()-t0)/1000).toFixed(1)}s`);
JS
} > "$TMPDIR/psb-test.js" 2>/dev/null || true
node "$TMPDIR/psb-test.js"

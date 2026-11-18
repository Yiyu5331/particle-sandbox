#!/bin/sh
# 把分块源码拼成单文件 particle-sandbox.html
cd "$(dirname "$0")"
# 把 tests/golden.json 和回放录制嵌进页面，浏览器端用它做跨引擎确定性检查
node -e "const fs=require('fs');const g=JSON.parse(fs.readFileSync('../tests/golden.json','utf8'));g.recs={};for(const r of g.replays)g.recs[r.file]=JSON.parse(fs.readFileSync('../tests/'+r.file,'utf8'));fs.writeFileSync(process.env.TMPDIR+'/63-golden-data.js','\\nconst GOLDEN_DATA = '+JSON.stringify(g)+';\\n');"
cat 00-head.html 10-core.js 20-sim.js 22-struct.js 23-weather.js 25-codec.js 26-state.js 27-scenes.js golden-scripts.js "$TMPDIR/63-golden-data.js" 30-render.js 40-audio.js 50-ui.js 60-tests.js 62-tests4.js 64-tests41.js 65-tests-gl.js 66-tests-golden.js 70-main.js 99-tail.html > ../particle-sandbox.html
cat 10-core.js 20-sim.js 22-struct.js 23-weather.js 25-codec.js 26-state.js 27-scenes.js golden-scripts.js "$TMPDIR/63-golden-data.js" 30-render.js 40-audio.js 50-ui.js 60-tests.js 62-tests4.js 64-tests41.js 65-tests-gl.js 66-tests-golden.js 70-main.js > "$TMPDIR/psb-all.js" && node --check "$TMPDIR/psb-all.js" && echo "syntax ok: $(wc -l < ../particle-sandbox.html) lines, $(wc -c < ../particle-sandbox.html) bytes"

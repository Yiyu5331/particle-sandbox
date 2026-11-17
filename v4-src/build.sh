#!/bin/sh
# 把分块源码拼成单文件 particle-sandbox.html
cd "$(dirname "$0")"
cat 00-head.html 10-core.js 20-sim.js 22-struct.js 23-weather.js 25-codec.js 27-scenes.js 30-render.js 40-audio.js 50-ui.js 60-tests.js 62-tests4.js 65-tests-gl.js 70-main.js 99-tail.html > ../particle-sandbox.html
cat 10-core.js 20-sim.js 22-struct.js 23-weather.js 25-codec.js 27-scenes.js 30-render.js 40-audio.js 50-ui.js 60-tests.js 62-tests4.js 65-tests-gl.js 70-main.js > "$TMPDIR/psb-all.js" && node --check "$TMPDIR/psb-all.js" && echo "syntax ok: $(wc -l < ../particle-sandbox.html) lines, $(wc -c < ../particle-sandbox.html) bytes"

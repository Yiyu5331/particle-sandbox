
/* =====================================================================
 * 6f. 黄金快照：浏览器里算出的哈希必须和 Node 录下来的逐位一致（跨引擎确定性）
 *     ?test=1 里跑每个场景的第 0 / 1000 / 5000 步和 5 段回放；?golden=1 跑完整的 36000 步
 * ===================================================================== */
function goldenCheck(maxStep) {
  const keepW = W, keepH = H;
  const rows = [];
  let ok = 0, bad = 0;
  for (const r of GOLDEN_DATA.replays) {
    const h = replay(GOLDEN_DATA.recs[r.file]);
    if (h === r.hash) ok++; else bad++;
    rows.push((h === r.hash ? '✓ ' : '✗ ') + r.name + ' ' + h);
  }
  for (const sc of GOLDEN_DATA.scenes) {
    allocGrid(GOLDEN_W, GOLDEN_H);
    resetWorld(sc.seed);
    const keepRec = cmdRecording; cmdRecording = false;
    buildScene(sc.index);
    cmdRecording = keepRec;
    let s = 0;
    for (const target of GOLDEN_STEPS) {
      if (target > maxStep) break;
      while (s < target) { simStep(); s++; }
      const h = worldHash();
      if (h === sc.hashes[target]) ok++; else { bad++; rows.push('✗ ' + sc.name + ' 第 ' + target + ' 步：' + h + ' ≠ ' + sc.hashes[target]); }
    }
  }
  allocGrid(keepW, keepH);
  if (typeof resizeRenderer === 'function' && canvas) resizeRenderer();
  return { ok, bad, rows };
}

if (typeof document !== 'undefined') {
  defBrowserTest('跨引擎确定性：浏览器算出的哈希和 Node 录的黄金快照逐位一致', () => {
    const r = goldenCheck(5000);
    return { ok: r.bad === 0 && r.ok === GOLDEN_DATA.replays.length + GOLDEN_DATA.scenes.length * 3,
             info: r.ok + ' 个一致，' + r.bad + ' 个不一致（10 个场景 × 第 0 / 1000 / 5000 步 + 5 段回放；完整 36000 步用 ?golden=1）' + (r.bad ? '：' + r.rows.filter(x => x[0] === '✗').join('；') : '') };
  });
}

// 由 meta.json 和验证报告生成 docs/puzzle-levels.md。手写说明在这里改，数据部分每次 audit 重新生成。

// 客观难度分（0–100）：随机越难过、参考解法笔数越多、用料越多，分数越高。
//   随机项 = 1 − min(随机通关率 / 5%, 1)，权重 0.4
//   笔数项 = min(三星笔数 / 6, 1)，权重 0.3
//   用料项 = min(log2(三星用料 + 1) / log2(129), 1)，权重 0.3
export function c3Score(row) {
  const rand = 1 - Math.min(row.bot.rate / 0.05, 1);
  const ops = Math.min(row.reference.strokes / 6, 1);
  const cells = Math.min(Math.log2(row.reference.used + 1) / Math.log2(129), 1);
  return Math.round(100 * (0.4 * rand + 0.3 * ops + 0.3 * cells));
}

const pct = r => (r * 100).toFixed(1) + '%';
const typeName = t => t === 'planning' ? '规划' : '实时';
const strokeText = e => {
  const a = e.args, len = Math.max(Math.abs(a.x1 - a.x0), Math.abs(a.y1 - a.y0));
  const where = a.x0 === a.x1 && a.y0 === a.y1 ? `(${a.x0},${a.y0})` : `(${a.x0},${a.y0})→(${a.x1},${a.y1})`;
  return `${e.step ? `第 ${e.step} 步 ` : ''}${a.tool} ${where}${len || a.size > 1 ? ` 粗 ${a.size}` : ''}${a.shape ? ' ' + a.shape : ''}`;
};

export function c3RenderDoc(meta, report) {
  const rows = report.levels;
  const out = [];
  out.push(`# C3 物理解谜关卡（30 关）

6 章 × 5 关，每章按「教学 → 练习 → 变化 → 组合 → 挑战」排列。规划关 ${rows.filter(r => r.type === 'planning').length} 个、实时关 ${rows.filter(r => r.type === 'realtime').length} 个。

## 文件

| 路径 | 内容 |
|---|---|
| \`src/modes/puzzle/levels/c3/c3-*.json\` | 30 个正式关卡，格式版本 1，参考解法由回放生成 |
| \`src/modes/puzzle/levels/c3/meta.json\` | 中英文关名、描述、三级提示、机制，以及每关全部解法的笔画日志 |
| \`tools/c3/levels.src.mjs\` | 关卡源定义（改关卡改这里，再跑构建） |
| \`tools/c3/build.mjs\` | 源定义 → 关卡 JSON 和 meta.json |
| \`tools/c3/audit.mjs\` | 全量验证，写出 \`docs/puzzle-levels-report.json\` 并重新生成本文档 |
| \`tools/c3/try.mjs\` | 设计时用：打印某关某解法的字符画和检查结果 |
| \`tools/c3/shots.mjs\` | 用真实页面给每关拍初始画面和通关画面，存进 \`docs/puzzle-levels/\` |
| \`tests/suites/c3-levels.test.mjs\` | node:test：每关参考解法三星、双播一致、空解失败、备选解法通关 |

\`\`\`sh
node tools/c3/build.mjs          # 重新生成关卡
node tools/c3/audit.mjs          # 全量验证（随机 200 次、扰动 50 次，约几分钟）
node tools/levels.mjs validate src/modes/puzzle/levels/c3/c3-*.json
node --test tests/suites/c3-levels.test.mjs
\`\`\`

关卡放在 \`levels/c3/\` 子目录而不是 \`levels/\` 根下：\`tools/levels.mjs validate\`（CI 也跑）会要求 \`levels/\` 根下的文件和 \`catalog.js\` 的注册表一一对应，而这个分支不允许改 \`catalog.js\`。接入时把文件挪上去并注册，英文文本从 meta.json 合进 \`src/ui/catalog.js\`，见交接文件。

关卡 JSON 的 \`hint\` 字段放的是一句话目标（中文），选关卡片和游戏里显示的就是它。格式只有一个 \`hint\` 字符串，没有英文字段、也没有分级提示，所以英文和三级提示放在 meta.json。

## 验证方法

- **参考解法**：\`puzzleVerify\` 在两个独立世界回放，必须三星、哈希一致。
- **备选解法**：meta.json 里每关至少两种解法，都要能通关（星级可以低）。
- **空解**：什么都不放必须失败。
- **随机机器人**：每次随机 1–6 笔，材料、起点、方向、长度（≤12）、粗细（1–4）、形状（圆、方、喷雾）都随机，受白名单和预算限制；实时关每笔再随机选一个时刻（前 60% 时限内）。每关 ${report.bot} 次，通关率要 < 5%。随机数用 xorshift，种子由关卡 id 派生，结果可复现。
- **抗扰动**（只对规划关）：参考解法每一笔整体随机平移 −1/0/+1 格（x、y 独立），${report.jitter} 次，通关率要 ≥ 80%。
- **实时关的时机检查**：把参考解法的每一笔都提前到第 0 步，记录是否仍能通关；失败说明这关确实考时机。

## 总表
`);
  out.push('| 编号 | 关卡 | 类型 | 教的机制 | 三星解法 | 随机通关 | 扰动通过 | 难度分 |');
  out.push('|---|---|---|---|---|---:|---:|---:|');
  for (const r of rows) {
    out.push(`| ${r.n} | ${r.name[0]} | ${typeName(r.type)} | ${r.mechanic[0]} | ${r.reference.strokes} 笔 · ${r.reference.used} 格 · ${r.reference.steps} 步 | ${r.bot.wins}/${r.bot.n}（${pct(r.bot.rate)}） | ${r.jitter ? `${r.jitter.wins}/${r.jitter.n}（${pct(r.jitter.rate)}）` : `—（提前到第 0 步${r.early.state === 'won' ? '仍通关' : '失败'}）`} | ${c3Score(r)} |`);
  }

  // 难度曲线
  out.push(`
## 难度曲线

难度分只用客观数据：随机机器人通关率（权重 0.4，0% 记满分，≥5% 记 0）、三星解法的笔数（0.3，6 笔封顶）和用料（0.3，按对数，128 格封顶）。设计难度（JSON 的 \`difficulty\`，1–5）单独列出作对照。
`);
  out.push('```');
  for (const r of rows) out.push(`${r.n}  ${String(c3Score(r)).padStart(3)} ${'█'.repeat(Math.round(c3Score(r) / 4))}`);
  out.push('```');
  out.push('');
  out.push('| 章 | 第 1 关 | 第 2 关 | 第 3 关 | 第 4 关 | 第 5 关 | 章平均 | 设计难度 |');
  out.push('|---|---:|---:|---:|---:|---:|---:|---|');
  const means = [];
  for (let c = 1; c <= 6; c++) {
    const ch = rows.filter(r => r.n[0] === String(c));
    const sc = ch.map(c3Score), mean = sc.reduce((a, b) => a + b, 0) / (sc.length || 1);
    means.push(mean);
    out.push(`| ${meta.chapters[c][0]} | ${sc.join(' | ')} | ${mean.toFixed(1)} | ${ch.map(r => r.difficulty).join(' ')} |`);
  }
  const chapterUp = means.every((m, i) => i === 0 || m >= means[i - 1] - 3);
  const endsUp = [1, 2, 3, 4, 5, 6].filter(c => { const ch = rows.filter(r => r.n[0] === String(c)).map(c3Score); return ch.length === 5 && ch[4] >= ch[0]; }).length;
  const first = rows.slice(0, 15).map(c3Score), last = rows.slice(15).map(c3Score);
  const avg = a => a.reduce((x, y) => x + y, 0) / a.length;
  out.push(`
- 每章第 5 关（挑战）的难度分不低于第 1 关（教学）的章数：${endsUp}/6。
- 前 15 关平均 ${avg(first).toFixed(1)}，后 15 关平均 ${avg(last).toFixed(1)}。
- 章平均${chapterUp ? '基本逐章上升（允许 3 分以内的回落）' : '没有做到逐章上升'}：${means.map(m => m.toFixed(1)).join(' → ')}。

**结论：按这三项客观指标，30 关的难度没有做到递增。** 原因分两类：

1. 指标本身的偏差。随机通关率在 0–5% 之间，大多数关是 0%，拉不开差距；笔数和用料衡量的是「要放多少东西」，而后期的实时关（2-5、6-4、6-5）难在时机，参考解法只有 1–2 笔、几格料，分数反而最低；1-4 用 12 道一格细线逐行填坑，笔数把分数抬得很高。
2. 关卡本身。第一章的 1-4、1-5 确实偏重（要按容积精确用料）；第六章的电路关机制清楚、用料少，玩起来也偏轻松。每章第 1 关是新机制的教学关，本来就会比上一章的挑战关简单，所以即使指标合理，曲线也会是锯齿形。

要真正检验难度曲线，需要能反映「想到解法有多难」的数据，比如试玩的首次通关时间和尝试次数；或者在指标里加入时机窗口宽度（实时关的可行放置时段占整关时限的比例）。按现有数据，建议优先调整：把 1-4 的解法改成更少笔数的版本或降低精度要求，给 6-4、6-5 收窄可行时段。
`);

  // 逐关说明
  out.push('## 逐关说明\n');
  for (const r of rows) {
    const m = meta.levels[r.id];
    out.push(`### ${r.n} ${m.name[0]}（${m.name[1]}）\n`);
    out.push(`- **id**：\`${r.id}\`，${typeName(r.type)}关，设计难度 ${r.difficulty}，时限 ${r.maxSteps} 步，总预算 ${r.budget} 格`);
    out.push(`- **目标**：${m.desc[0]}`);
    out.push(`- **英文**：${m.desc[1]}`);
    out.push(`- **教的机制**：${m.mechanic[0]}（${m.mechanic[1]}）`);
    out.push(`- **星级门槛**：二星 用料 ≤ ${r.stars.two.maxUsed}、步数 ≤ ${r.stars.two.maxSteps}；三星 用料 ≤ ${r.stars.three.maxUsed}、步数 ≤ ${r.stars.three.maxSteps}`);
    for (const [k, s] of r.solutions.entries()) {
      const log = m.solutions[k].log;
      out.push(`- **${s.reference ? '预期解法' : '备选解法'}「${s.name}」**：${s.state === 'won' ? `${s.stars} 星` : '未通关'}，${s.strokes} 笔、用料 ${s.used} 格、${s.steps} 步结算。笔画：${log.map(strokeText).join('；')}`);
    }
    out.push(`- **提示**：① ${m.hints[0][0]} ② ${m.hints[1][0]} ③ ${m.hints[2][0]}`);
    out.push(`- **难度指标**：随机通关 ${r.bot.wins}/${r.bot.n}（${pct(r.bot.rate)}，随机通关中三星 ${r.bot.stars[3]} 次）；${r.jitter ? `扰动通过 ${r.jitter.wins}/${r.jitter.n}，其中三星 ${r.jitter.three}` : `参考解法提前到第 0 步：${r.early.state === 'won' ? '仍通关' : '失败'}`}；空解${r.nothing === 'won' ? '通关（问题）' : '失败'}；难度分 ${c3Score(r)}`);
    out.push(`- **截图**：![初始](puzzle-levels/${r.id}-start.png) ![通关](puzzle-levels/${r.id}-won.png)`);
    out.push('');
  }
  out.push(`---\n\n数据由 \`node tools/c3/audit.mjs\` 于 ${report.generated} 生成，原始结果见 [puzzle-levels-report.json](puzzle-levels-report.json)。\n`);
  return out.join('\n');
}

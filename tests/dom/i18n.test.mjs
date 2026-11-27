// 通过统一 DOM 入口检查源码词表和当前构建产物的英文界面。
import test from 'node:test';
import { execFileSync } from 'node:child_process';

test('UI 中英文词条与运行时 DOM 完整', () => {
  execFileSync(process.execPath, ['tools/check-i18n.mjs'], { stdio: 'inherit' });
});

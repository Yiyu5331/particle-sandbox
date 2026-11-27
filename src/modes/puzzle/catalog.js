import { discoverPuzzleLevels } from '../../../tools/puzzle-catalog.mjs';

// Node 工具直接读目录，单文件构建把同一份结果内联。
export const puzzleLevels = discoverPuzzleLevels().map(({level})=>level);

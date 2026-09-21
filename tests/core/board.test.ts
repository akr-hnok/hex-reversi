import { describe, expect, it } from 'vitest';
import {
  INITIAL_STONE_CELLS,
  Board,
  createBoard,
  createEmptyBoard,
  placeGimmicks,
  setupInitialStones,
} from '../../src/core/board';
import { hexKey, rotate120 } from '../../src/core/hex';

function countTypes(board: Board): Map<string, number> {
  const counts = new Map<string, number>();
  for (const cell of board.cells.values()) {
    counts.set(cell.type, (counts.get(cell.type) ?? 0) + 1);
  }
  return counts;
}

describe('createEmptyBoard', () => {
  it('指定半径のマス数だけ生成され、初期状態は全て空の通常マス', () => {
    const board = createEmptyBoard(4);
    expect(board.cells.size).toBe(61);
    for (const cell of board.cells.values()) {
      expect(cell.stone).toBe(-1);
      expect(cell.type).toBe('normal');
    }
  });
});

describe('setupInitialStones', () => {
  it('初期配置9個(各プレイヤー3個)が置かれ、中心は空', () => {
    const board = createEmptyBoard(4);
    setupInitialStones(board);
    expect(board.cells.get(hexKey(0, 0))!.stone).toBe(-1);
    for (const [q, r, color] of INITIAL_STONE_CELLS) {
      expect(board.cells.get(hexKey(q, r))!.stone).toBe(color);
    }
    const stones = [...board.cells.values()].filter((c) => c.stone !== -1);
    expect(stones).toHaveLength(9);
    for (const color of [0, 1, 2]) {
      expect(stones.filter((c) => c.stone === color)).toHaveLength(3);
    }
  });

  it('半径1の盤では距離2オービットをスキップして6個', () => {
    const board = createEmptyBoard(1);
    setupInitialStones(board);
    const stones = [...board.cells.values()].filter((c) => c.stone !== -1);
    expect(stones).toHaveLength(6);
  });

  it('120°回転 + 色巡回(0→1→2)で不変(3人対称)', () => {
    const board = createEmptyBoard(4);
    setupInitialStones(board);
    for (const cell of board.cells.values()) {
      if (cell.stone === -1) continue;
      const rotated = rotate120(cell);
      const rc = board.cells.get(hexKey(rotated.q, rotated.r))!;
      expect(rc.stone).toBe((cell.stone + 1) % 3);
    }
  });
});

describe('placeGimmicks', () => {
  it('指定組数×3マスが配置され、120°対称を保つ', () => {
    const board = createEmptyBoard(4);
    placeGimmicks(board, { double: 1, triple: 1, blackhole: 1, bomb: 1 }, 42);

    const counts = countTypes(board);
    expect(counts.get('double')).toBe(3);
    expect(counts.get('triple')).toBe(3);
    expect(counts.get('blackhole')).toBe(3);
    expect(counts.get('bomb')).toBe(3);
    expect(counts.get('normal')).toBe(61 - 12);

    // 全ギミックマスについて、120°回転先も同じ種別
    for (const cell of board.cells.values()) {
      if (cell.type === 'normal') continue;
      const rotated = rotate120(cell);
      const rc = board.cells.get(hexKey(rotated.q, rotated.r))!;
      expect(rc.type).toBe(cell.type);
    }

    // 中心と初期配置マスにはギミックが来ない
    expect(board.cells.get(hexKey(0, 0))!.type).toBe('normal');
    for (const [q, r] of INITIAL_STONE_CELLS) {
      expect(board.cells.get(hexKey(q, r))!.type).toBe('normal');
    }
  });

  it('同じシードなら同じ配置、違うシードなら(ほぼ)違う配置', () => {
    const a = createEmptyBoard(5);
    const b = createEmptyBoard(5);
    const c = createEmptyBoard(5);
    placeGimmicks(a, { double: 2, triple: 1, blackhole: 1, bomb: 1 }, 7);
    placeGimmicks(b, { double: 2, triple: 1, blackhole: 1, bomb: 1 }, 7);
    placeGimmicks(c, { double: 2, triple: 1, blackhole: 1, bomb: 1 }, 8);
    const layout = (board: Board) =>
      [...board.cells.values()].map((cell) => cell.type).join(',');
    expect(layout(a)).toBe(layout(b));
    expect(layout(a)).not.toBe(layout(c));
  });

  it('利用可能マスを超える組数はエラー', () => {
    // R=2 (19マス): 除外7マス(中心+初期6) → 12マス = 4オービット
    const board = createEmptyBoard(2);
    expect(() =>
      placeGimmicks(board, { double: 2, triple: 1, blackhole: 1, bomb: 1 }, 1),
    ).toThrow();
  });
});

describe('createBoard', () => {
  it('ギミックなし: 全マス通常で初期石のみ', () => {
    const board = createBoard({ radius: 4, gimmicks: false });
    expect(countTypes(board).get('normal')).toBe(61);
    const stones = [...board.cells.values()].filter((c) => c.stone !== -1);
    expect(stones).toHaveLength(9);
  });

  it('ギミックあり: 特殊マスと初期石が共存', () => {
    const board = createBoard({
      radius: 4,
      gimmicks: true,
      gimmickCounts: { double: 1, triple: 0, blackhole: 1, bomb: 0 },
      seed: 99,
    });
    const counts = countTypes(board);
    expect(counts.get('double')).toBe(3);
    expect(counts.get('blackhole')).toBe(3);
    // 初期石は9個で、ブラックホール上にない
    const stones = [...board.cells.values()].filter((c) => c.stone !== -1);
    expect(stones).toHaveLength(9);
    for (const s of stones) expect(s.type).toBe('normal');
  });
});

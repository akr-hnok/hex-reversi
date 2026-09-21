import {
  hexDistance,
  hexKey,
  hexesInRadius,
  parseKey,
  rotate120Orbit,
} from './hex';
import type { BombEffect, CellStone, CellType, StoneColor } from './types';

export interface Cell {
  q: number;
  r: number;
  type: CellType;
  stone: CellStone;
}

export interface Board {
  radius: number;
  cells: Map<string, Cell>;
  bombEffect: BombEffect;
}

/**
 * 各特殊マスの「組数」。1組 = 120°回転対称の3マス。
 * 3プレイヤー間の公平性のためオービット(3マス)単位で配置する。
 */
export interface GimmickCounts {
  double: number;
  triple: number;
  blackhole: number;
  bomb: number;
}

export interface BoardConfig {
  radius: number;
  gimmicks: boolean;
  gimmickCounts?: GimmickCounts;
  bombEffect?: BombEffect;
  seed?: number;
}

export function createEmptyBoard(radius: number, bombEffect: BombEffect = 'flip'): Board {
  const cells = new Map<string, Cell>();
  for (const { q, r } of hexesInRadius(radius)) {
    cells.set(hexKey(q, r), { q, r, type: 'normal', stone: -1 });
  }
  return { radius, cells, bombEffect };
}

export function cloneBoard(board: Board): Board {
  const cells = new Map<string, Cell>();
  for (const [key, cell] of board.cells) {
    cells.set(key, { ...cell });
  }
  return { radius: board.radius, cells, bombEffect: board.bombEffect };
}

export function cellAt(board: Board, q: number, r: number): Cell | undefined {
  return board.cells.get(hexKey(q, r));
}

export function setCellType(board: Board, q: number, r: number, type: CellType): void {
  const cell = cellAt(board, q, r);
  if (!cell) throw new Error(`no cell at ${q},${r}`);
  cell.type = type;
}

export function setStone(board: Board, q: number, r: number, stone: CellStone): void {
  const cell = cellAt(board, q, r);
  if (!cell) throw new Error(`no cell at ${q},${r}`);
  cell.stone = stone;
}

/**
 * 初期石の配置。1オービット(120°回転対象)ごとに色 0,1,2 を順に割り当て、
 * 「120°回転 + 色巡回(0→1→2)」で不変(3プレイヤー間で完全対称)。
 * 距離1リング6マス(各2個) + 距離2オービット3マス(各1個) = 計9個。
 * 半径1の盤では距離2オービットは存在しないためスキップされる。
 */
export const INITIAL_STONE_CELLS: ReadonlyArray<readonly [number, number, StoneColor]> = [
  [1, 0, 0],
  [-1, 1, 1],
  [0, -1, 2],
  [1, -1, 0],
  [0, 1, 1],
  [-1, 0, 2],
  [2, 0, 0],
  [-2, 2, 1],
  [0, -2, 2],
];

export function setupInitialStones(board: Board): void {
  for (const [q, r, color] of INITIAL_STONE_CELLS) {
    if (hexDistance(q, r) > board.radius) continue;
    setStone(board, q, r, color);
  }
}

export function createRng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffled<T>(items: readonly T[], rng: () => number): T[] {
  const arr = [...items];
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

/**
 * ギミックマスを 120°回転オービット単位でランダム配置する。
 * ブラックホールは中心マスと初期配置マスを除外する(全ギミック共通で除外)。
 */
export function placeGimmicks(board: Board, counts: GimmickCounts, seed: number): void {
  const excluded = new Set<string>([
    hexKey(0, 0),
    ...INITIAL_STONE_CELLS.map(([q, r]) => hexKey(q, r)),
  ]);

  const claimed = new Set<string>();
  const orbits: string[][] = [];
  for (const key of board.cells.keys()) {
    if (excluded.has(key) || claimed.has(key)) continue;
    const orbit = rotate120Orbit(parseKey(key)).map(({ q, r }) => hexKey(q, r));
    for (const k of orbit) claimed.add(k);
    orbits.push(orbit);
  }

  const rng = createRng(seed);
  const pool = shuffled(orbits, rng);
  const plan: Array<readonly [CellType, number]> = [
    ['double', counts.double],
    ['triple', counts.triple],
    ['blackhole', counts.blackhole],
    ['bomb', counts.bomb],
  ];

  let cursor = 0;
  for (const [type, orbitCount] of plan) {
    for (let i = 0; i < orbitCount; i++) {
      if (cursor >= pool.length) {
        throw new Error('gimmick counts exceed available cells');
      }
      for (const key of pool[cursor++]) {
        const cell = board.cells.get(key);
        if (cell) cell.type = type;
      }
    }
  }
}

export function createBoard(config: BoardConfig): Board {
  const board = createEmptyBoard(config.radius, config.bombEffect ?? 'flip');
  if (config.gimmicks && config.gimmickCounts) {
    placeGimmicks(board, config.gimmickCounts, config.seed ?? 1);
  }
  setupInitialStones(board);
  return board;
}

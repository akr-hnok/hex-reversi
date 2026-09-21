import { Board, cloneBoard } from './board';
import { hexDistance, hexKey } from './hex';
import { Move, legalMoves } from './rules';
import { StoneColor, nextColor } from './types';

export type EngineLevel = 'easy' | 'normal' | 'hard';

/** 位置重み: 外周リングの石は挟まれにくく価値が高い。 */
function positionalWeight(board: Board, q: number, r: number): number {
  const d = hexDistance(q, r);
  if (d === board.radius) return 4;
  if (d === board.radius - 1) return 1;
  return 0;
}

/**
 * 通常手(挟み・ボム)の数を返す。自由配置のみの場合は 0 扱い。
 * 自由配置は「困ったときの救済」であり機動力ではないため、評価には含めない。
 */
function normalMoveCount(board: Board, color: StoneColor): number {
  return legalMoves(board, color).filter((m) => !m.free).length;
}

/**
 * 盤面を color 視点で評価する。大きいほど有利。
 * 石数(倍点マスは重み付き) + 位置重み + 自分の通常手数 − 相手の通常手数。
 */
export function evaluate(board: Board, color: StoneColor): number {
  let score = 0;
  for (const cell of board.cells.values()) {
    if (cell.stone === -1) continue;
    const w =
      1 +
      positionalWeight(board, cell.q, cell.r) +
      (cell.type === 'double' ? 1 : cell.type === 'triple' ? 2 : 0);
    if (cell.stone === color) score += w;
    else score -= w;
  }
  score += normalMoveCount(board, color) * 0.5;
  for (const c of [0, 1, 2] as StoneColor[]) {
    if (c === color) continue;
    score -= normalMoveCount(board, c) * 0.25;
  }
  return score;
}

/** 着手を適用した盤面の複製を返す(進行判定は行わない)。探索用。 */
function simulate(board: Board, move: Move, color: StoneColor): Board {
  const next = cloneBoard(board);
  const cell = next.cells.get(hexKey(move.q, move.r));
  if (!cell) throw new Error(`no cell at ${move.q},${move.r}`);
  cell.stone = color;
  for (const key of move.flips) {
    const c = next.cells.get(key);
    if (c) c.stone = color;
  }
  return next;
}

/** 1手読みの最善手。なければ null。 */
function best1Ply(board: Board, color: StoneColor): { move: Move; value: number } | null {
  let best: { move: Move; value: number } | null = null;
  for (const move of legalMoves(board, color)) {
    const value = evaluate(simulate(board, move, color), color);
    if (!best || value > best.value) best = { move, value };
  }
  return best;
}

/**
 * COM の着手を決める。
 * - easy: ランダム
 * - normal: 1手読みの評価最大化
 * - hard: normal + 次の2プレイヤーの最善応答(各1手読み)を仮定して評価
 * nextSeats に次の2席を与えると、その順で応答を仮定する(手番ローテーション対応)。
 */
export function chooseMove(
  board: Board,
  color: StoneColor,
  level: EngineLevel,
  rng: () => number = Math.random,
  nextSeats?: readonly [StoneColor, StoneColor],
): Move | null {
  const moves = legalMoves(board, color);
  if (moves.length === 0) return null;

  if (level === 'easy') {
    return moves[Math.floor(rng() * moves.length)];
  }

  const seats: readonly [StoneColor, StoneColor] = nextSeats ?? [
    nextColor(color),
    nextColor(nextColor(color)),
  ];

  let best: Move | null = null;
  let bestValue = -Infinity;
  for (const move of moves) {
    const b1 = simulate(board, move, color);
    let value = evaluate(b1, color);
    if (level === 'hard') {
      const [o1, o2] = seats;
      const r1 = best1Ply(b1, o1);
      const b2 = r1 ? simulate(b1, r1.move, o1) : b1;
      const r2 = best1Ply(b2, o2);
      const b3 = r2 ? simulate(b2, r2.move, o2) : b2;
      value = evaluate(b3, color);
    }
    value += rng() * 0.01; // 同値時の揺らぎ
    if (value > bestValue) {
      bestValue = value;
      best = move;
    }
  }
  return best;
}

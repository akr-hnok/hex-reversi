import { Board, cellAt } from './board';
import { HEX_DIRECTIONS, hexKey, neighbors } from './hex';
import { StoneColor } from './types';

export interface Move {
  q: number;
  r: number;
  /** 裏返るマスのキー一覧(配置マス自身は含まない)。 */
  flips: string[];
  /** flips.length。UI・COM の評価に使う。 */
  gained: number;
  /** 自由配置: 挟み手・ボムの通常手が1つもない場合に、どの空マスにも置ける手(裏返しなし)。 */
  free?: boolean;
}

/**
 * 1方向について挟み込みを判定し、裏返るマスのキー列を返す。
 * 自分以外の色が1つ以上連続し、その先に自分の石がある場合のみ有効。
 * 盤外・ブラックホール・空マスで遮断される。
 */
function flipsInDirection(
  board: Board,
  q: number,
  r: number,
  dirIndex: number,
  color: StoneColor,
): string[] {
  const dq = HEX_DIRECTIONS[dirIndex].q;
  const dr = HEX_DIRECTIONS[dirIndex].r;
  const flips: string[] = [];
  let cq = q + dq;
  let cr = r + dr;
  for (;;) {
    const cell = cellAt(board, cq, cr);
    if (!cell || cell.type === 'blackhole' || cell.stone === -1) return [];
    if (cell.stone === color) return flips.length > 0 ? flips : [];
    flips.push(hexKey(cq, cr));
    cq += dq;
    cr += dr;
  }
}

/**
 * (q, r) に color の石を置いたときの裏返り対象マスを返す。
 * 配置不可能な場合は空配列。
 * ボムマスは挟み判定に関わらず常に配置可能で、周囲6マスの石を自色にする。
 */
export function flipsForMove(
  board: Board,
  q: number,
  r: number,
  color: StoneColor,
): string[] {
  const cell = cellAt(board, q, r);
  if (!cell || cell.stone !== -1 || cell.type === 'blackhole') return [];

  // 通常の6方向直線挟み込み
  const all: string[] = [];
  for (let d = 0; d < 6; d++) {
    all.push(...flipsInDirection(board, q, r, d, color));
  }

  // 直線で挟めないマスには置けない(地雷マスも通常マスに完全カモフラージュ)
  if (all.length === 0) return [];

  // 地雷マスに着手した場合
  if (cell.type === 'bomb' && board.bombEffect === 'flip') {
    const flipSet = new Set(all);
    for (const n of neighbors(cell)) {
      const nc = cellAt(board, n.q, n.r);
      if (nc && nc.stone !== -1 && nc.type !== 'blackhole' && nc.stone !== color) {
        flipSet.add(hexKey(n.q, n.r));
      }
    }
    return Array.from(flipSet);
  }

  return all;
}

/** 盤上に color の石が1つでもあるか。 */
function hasStone(board: Board, color: StoneColor): boolean {
  for (const cell of board.cells.values()) {
    if (cell.stone === color) return true;
  }
  return false;
}

export function isLegalMove(
  board: Board,
  q: number,
  r: number,
  color: StoneColor,
): boolean {
  const cell = cellAt(board, q, r);
  if (!cell || cell.stone !== -1 || cell.type === 'blackhole') return false;
  if (flipsForMove(board, q, r, color).length > 0) return true;
  // 全滅時は自由配置で復活可能(通常手が1つもない場合)
  return !hasStone(board, color);
}

export function legalMoves(board: Board, color: StoneColor): Move[] {
  const moves: Move[] = [];
  const wiped = !hasStone(board, color);
  for (const cell of board.cells.values()) {
    if (cell.stone !== -1 || cell.type === 'blackhole') continue;
    const flips = flipsForMove(board, cell.q, cell.r, color);
    if (flips.length > 0) {
      moves.push({ q: cell.q, r: cell.r, flips, gained: flips.length });
    } else if (wiped) {
      // 全滅プレイヤーはどの空マスにも自由配置で復活できる
      moves.push({ q: cell.q, r: cell.r, flips: [], gained: 0, free: true });
    }
  }
  if (moves.length > 0) return moves;

  // 通常手(挟み・ボム)が1つもない → 自由配置で詰みを防ぐ
  const free: Move[] = [];
  for (const cell of board.cells.values()) {
    if (cell.stone !== -1 || cell.type === 'blackhole') continue;
    free.push({ q: cell.q, r: cell.r, flips: [], gained: 0, free: true });
  }
  return free;
}

import { Board, cloneBoard, cellAt } from './board';
import { neighbors } from './hex';
import { Move, legalMoves } from './rules';
import { PLAYER_COUNT, StoneColor } from './types';

export interface GameState {
  board: Board;
  current: StoneColor;
  /** 連続パス数。3(=全プレイヤー)で終了。 */
  consecutivePasses: number;
  /** 経過手数(パス含む)。 */
  turn: number;
  over: boolean;
  /** 勝者。同点の場合は null(共勝)。 */
  winner: StoneColor | null;
  /** 手番順の開始席(0..2)。対局ごとにランダム化する。 */
  seatOffset: number;
  /** 手番順の回転方向(+1/-1 mod 3)。対局ごとにランダム化する。 */
  seatDirection: 1 | 2;
  /** ハンデ: 席2を常に3番手に固定する。 */
  fixThirdSeat: boolean;
}

/**
 * 順列交代方式の手番順列テーブル（全6順列）。
 * - 4手待ちを完全排除し、最大待ち手数を3手に抑える（待たされ感の解消）。
 * - 各順列の末尾と次順列の先頭が異なるため、連続着手は発生しない。
 * - 各プレイヤーが1番手・2番手・3番手を完全に同数（18手ごとに各2回ずつ）担当し公平性を担保。
 */
export const TURN_PERMUTATIONS: readonly (readonly [StoneColor, StoneColor, StoneColor])[] = [
  [0, 1, 2],
  [0, 2, 1],
  [2, 0, 1],
  [2, 1, 0],
  [1, 2, 0],
  [1, 0, 2],
];

/**
 * ターン数(0始まり)から手番プレイヤーの席を返す。
 * - 順列交代方式により、最大待ち手数を3手以下に抑制（4手待ちゼロ）。
 * - 開始席と回転方向を対局ごとにランダム化し、先攻・終盤ボーナスを公平に分散。
 * - fixThirdSeat(ハンデ): 席2を常に3番手(各ラウンドの最終手番)に固定する。
 *   1番手と2番手はラウンドごとに交代し、先攻の固定は避ける。
 */
export function seatForTurn(
  turn: number,
  offset = 0,
  direction: 1 | 2 = 1,
  fixThirdSeat = false,
): StoneColor {
  if (fixThirdSeat) {
    const pos = turn % PLAYER_COUNT;
    const round = Math.floor(turn / PLAYER_COUNT);
    if (pos === 2) return 2 as StoneColor;
    // ラウンド偶数: [0,1,2]、奇数: [1,0,2]
    return ((round + pos) % 2 === 0 ? 0 : 1) as StoneColor;
  }
  const permIdx = Math.floor(turn / PLAYER_COUNT) % TURN_PERMUTATIONS.length;
  const pos = turn % PLAYER_COUNT;
  const base = TURN_PERMUTATIONS[permIdx][pos];
  return ((((offset + direction * base) % PLAYER_COUNT) + PLAYER_COUNT) % PLAYER_COUNT) as StoneColor;
}


export interface CreateGameOptions {
  /** シードから決めるのが一般的(再現性のあるランダム席)。 */
  seatOffset?: number;
  seatDirection?: 1 | 2;
  /** ハンデ: 席2を常に3番手に固定する。 */
  fixThirdSeat?: boolean;
}

/** シードから開始席と回転方向を決定する(クライアント・サーバー共通の運用ルール)。 */
export function seatOptsFromSeed(seed: number): { seatOffset: number; seatDirection: 1 | 2 } {
  return {
    seatOffset: (((seed % 3) + 3) % 3) as number,
    seatDirection: Math.floor(seed / 7) % 2 === 0 ? 1 : 2,
  };
}

export function createGame(board: Board, opts: CreateGameOptions = {}): GameState {
  const seatOffset = ((opts.seatOffset ?? 0) % PLAYER_COUNT + PLAYER_COUNT) % PLAYER_COUNT;
  const seatDirection = opts.seatDirection === 2 ? 2 : 1;
  const fixThirdSeat = opts.fixThirdSeat === true;
  return {
    board,
    current: seatForTurn(0, seatOffset, seatDirection, fixThirdSeat),
    consecutivePasses: 0,
    turn: 0,
    over: false,
    winner: null,
    seatOffset,
    seatDirection,
    fixThirdSeat,
  };
}

export function movesFor(state: GameState, color: StoneColor): Move[] {
  if (state.over) return [];
  return legalMoves(state.board, color);
}

export function applyMove(state: GameState, q: number, r: number): GameState {
  if (state.over) throw new Error('game is over');
  const move = legalMoves(state.board, state.current).find(
    (m) => m.q === q && m.r === r,
  );
  if (!move) throw new Error(`illegal move at ${q},${r}`);

  const board = cloneBoard(state.board);
  const placed = board.cells.get(`${q},${r}`);
  if (!placed) throw new Error(`no cell at ${q},${r}`);

  // 地雷に着手した場合で、破壊モードなら爆心地のみブラックホール化(石は乗らず反転も起きず1手損)
  if (placed.type === 'bomb' && board.bombEffect === 'destroy') {
    placed.stone = -1;
    placed.type = 'blackhole';
  } else {
    placed.stone = state.current;

    // 通常の反転処理
    for (const key of move.flips) {
      const cell = board.cells.get(key);
      if (cell) cell.stone = state.current;
    }
  }

  return advance({
    board,
    current: seatForTurn(state.turn + 1, state.seatOffset, state.seatDirection, state.fixThirdSeat),
    consecutivePasses: 0,
    turn: state.turn + 1,
    over: false,
    winner: null,
    seatOffset: state.seatOffset,
    seatDirection: state.seatDirection,
    fixThirdSeat: state.fixThirdSeat,
  });
}

export function applyPass(state: GameState): GameState {
  if (state.over) throw new Error('game is over');
  if (legalMoves(state.board, state.current).length > 0) {
    throw new Error('cannot pass: legal moves exist');
  }
  return advance({
    ...state,
    current: seatForTurn(state.turn + 1, state.seatOffset, state.seatDirection, state.fixThirdSeat),
    consecutivePasses: state.consecutivePasses + 1,
    turn: state.turn + 1,
  });
}

/**
 * 終了判定と自動パスを処理する。
 * 終了条件: ブラックホール以外の全マスが埋まる、または全プレイヤーが連続でパス。
 * 自由配置ルール(rules.ts)により「通常手がない」場合でも必ず着手可能なため、
 * 実際にパスが発生するのは空きマスが存在しない状況だけであり、
 * 連続パス終了は実質起きない(規定は §3-2 の保険として残す)。
 */
function advance(state: GameState): GameState {
  if (isBoardFull(state.board)) return finish(state);
  if (state.consecutivePasses >= PLAYER_COUNT) return finish(state);
  if (legalMoves(state.board, state.current).length === 0) {
    return applyPass(state);
  }
  return state;
}

export function isBoardFull(board: Board): boolean {
  for (const cell of board.cells.values()) {
    if (cell.type !== 'blackhole' && cell.stone === -1) return false;
  }
  return true;
}

/** 倍点マス込みのスコア。double=×2, triple=×3。 */
export function scores(board: Board): [number, number, number] {
  const result: [number, number, number] = [0, 0, 0];
  for (const cell of board.cells.values()) {
    if (cell.stone === -1) continue;
    const weight = cell.type === 'double' ? 2 : cell.type === 'triple' ? 3 : 1;
    result[cell.stone] += weight;
  }
  return result;
}

function finish(state: GameState): GameState {
  const s = scores(state.board);
  const max = Math.max(...s);
  const holders = s.flatMap((v, i) => (v === max ? [i as StoneColor] : []));
  return { ...state, over: true, winner: holders.length === 1 ? holders[0] : null };
}

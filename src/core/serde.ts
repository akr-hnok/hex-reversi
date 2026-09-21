import { Board, Cell } from './board';
import { GameState } from './game';
import { StoneColor, BombEffect } from './types';

/** WebSocket / ストレージ経送用の GameState 表現。 */
export interface SerializedGame {
  board: { radius: number; bombEffect?: BombEffect; cells: Cell[] };
  current: StoneColor;
  consecutivePasses: number;
  turn: number;
  over: boolean;
  winner: StoneColor | null;
  seatOffset: number;
  seatDirection: 1 | 2;
  fixThirdSeat: boolean;
}

export function serializeGame(state: GameState): SerializedGame {
  return {
    board: {
      radius: state.board.radius,
      bombEffect: state.board.bombEffect,
      cells: [...state.board.cells.values()],
    },
    current: state.current,
    consecutivePasses: state.consecutivePasses,
    turn: state.turn,
    over: state.over,
    winner: state.winner,
    seatOffset: state.seatOffset,
    seatDirection: state.seatDirection,
    fixThirdSeat: state.fixThirdSeat,
  };
}

export function deserializeGame(g: SerializedGame): GameState {
  return {
    board: {
      radius: g.board.radius,
      bombEffect: g.board.bombEffect ?? 'flip',
      cells: new Map(g.board.cells.map((c) => [`${c.q},${c.r}`, { ...c }])),
    },
    current: g.current,
    consecutivePasses: g.consecutivePasses,
    turn: g.turn,
    over: g.over,
    winner: g.winner,
    seatOffset: g.seatOffset,
    seatDirection: g.seatDirection,
    fixThirdSeat: g.fixThirdSeat ?? false,
  };
}

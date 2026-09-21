import { describe, expect, it } from 'vitest';
import { createEmptyBoard, setCellType, setStone } from '../../src/core/board';
import { applyMove, applyPass, createGame, movesFor, scores } from '../../src/core/game';
import { legalMoves } from '../../src/core/rules';
import { StoneColor } from '../../src/core/types';

// R=1 (7マス) の盤。空き(1,0)。A(0,0),A(-1,0), C(1,-1),C(0,-1),C(-1,1),C(0,1)。B は石なし。
// この盤では誰も (1,0) で挟めない → 通常手が存在しない。
function buildBoard() {
  const board = createEmptyBoard(1);
  setStone(board, 0, 0, 0);
  setStone(board, -1, 0, 0);
  setStone(board, 1, -1, 2);
  setStone(board, 0, -1, 2);
  setStone(board, -1, 1, 2);
  setStone(board, 0, 1, 2);
  return board;
}

describe('自由配置(通常手がない場合の救済・詰み防止)', () => {
  it('全滅プレイヤー: どの空マスにも自由配置できる(裏返しなし)', () => {
    const moves = legalMoves(buildBoard(), 1 as StoneColor);
    expect(moves).toHaveLength(1); // 空きは (1,0) のみ
    expect(moves[0].free).toBe(true);
    expect(moves[0].flips).toEqual([]);
  });

  it('石を持つが挟み手がないプレイヤーも自由配置できる(1個残りの詰み解消)', () => {
    // A は石を2つ持つが挟めない → 自由配置
    const moves = legalMoves(buildBoard(), 0 as StoneColor);
    expect(moves).toHaveLength(1);
    expect(moves[0].free).toBe(true);
  });

  it('挟み手があるプレイヤーには自由配置は出ない', () => {
    // C(=2): (1,0) で挟めない → 自由配置になるが…
    // 挟める盤を別に作る: C(0,0), A(1,0) → C は (2,0) で挟める
    const board = createEmptyBoard(2);
    setStone(board, 0, 0, 2);
    setStone(board, 1, 0, 0);
    const moves = legalMoves(board, 2 as StoneColor);
    expect(moves.length).toBeGreaterThan(0);
    expect(moves.every((m) => !m.free)).toBe(true);
  });

  it('自由配置は裏返さない', () => {
    let state = createGame(buildBoard());
    state = { ...state, current: 1 as StoneColor };
    state = applyMove(state, 1, 0); // B が自由配置
    expect(scores(state.board)).toEqual([2, 1, 4]); // 誰の石も変わっていない
  });

  it('全滅プレイヤーは空きマスに自由配置で復活できる', () => {
    // R=2: A(0,0), C(0,1)。B は全滅。
    const board = createEmptyBoard(2);
    setStone(board, 0, 0, 0);
    setStone(board, 0, 1, 2);
    const moves = legalMoves(board, 1 as StoneColor);
    expect(moves.length).toBeGreaterThan(0);
    expect(moves.every((m) => m.free)).toBe(true);
    expect(moves.every((m) => m.flips.length === 0)).toBe(true);
  });

  it('石を持つプレイヤーが挟めない場合: 地雷マスがあっても挟めなければ自由配置になる', () => {
    // buildBoard: 全員が唯一の空き(1,0)で挟めない盤。B は石を3つ持つ(未全滅)。
    const board = buildBoard();
    setCellType(board, 1, 0, 'bomb');
    const moves = legalMoves(board, 1 as StoneColor);
    expect(moves).toHaveLength(1);
    // ステルス地雷は挟めないマスでは通常手として発動しないため、自由配置として提供される
    expect(moves[0].free).toBe(true);
  });

  it('全滅プレイヤーが自由配置で復活できる', () => {
    const board = buildBoard();
    let state = createGame(board);
    state = { ...state, current: 1 as StoneColor };
    const freeMoves = movesFor(state, 1).filter((m) => m.free);
    expect(freeMoves).toHaveLength(1);
    state = applyMove(state, freeMoves[0].q, freeMoves[0].r);
    expect(scores(state.board)[1]).toBe(1);
  });

  it('自由配置があるためパスはできない(対局が詰まない)', () => {
    const state = { ...createGame(buildBoard()), current: 1 as StoneColor };
    expect(() => applyPass(state)).toThrow();
  });
});

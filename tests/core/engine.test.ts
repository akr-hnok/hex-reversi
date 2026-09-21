import { describe, expect, it } from 'vitest';
import { createBoard, createEmptyBoard, createRng, setStone } from '../../src/core/board';
import { chooseMove, evaluate, type EngineLevel } from '../../src/core/engine';
import { applyMove, createGame } from '../../src/core/game';
import { legalMoves } from '../../src/core/rules';

/**
 * 評価の優先度を検査する専用盤(R=3)。
 * A(0,0), B(1,0), C(2,0) → A は (3,0) で2枚挟める(角)。
 * A(0,1), B(1,1)        → A は (2,1) で1枚挟める。
 */
function buildEvalBoard() {
  const board = createEmptyBoard(3);
  setStone(board, 0, 0, 0);
  setStone(board, 1, 0, 1);
  setStone(board, 2, 0, 2);
  setStone(board, 0, 1, 0);
  setStone(board, 1, 1, 1);
  return board;
}

describe('COM エンジン', () => {
  it('chooseMove は常に合法手を返す(全レベル)', () => {
    const board = createBoard({ radius: 2, gimmicks: false });
    const rng = createRng(7);
    for (const level of ['easy', 'normal', 'hard'] as EngineLevel[]) {
      const move = chooseMove(board, 0, level, rng);
      expect(move).not.toBeNull();
      expect(
        legalMoves(board, 0).some((m) => m.q === move!.q && m.r === move!.r),
      ).toBe(true);
    }
  });

  it('ふつう: 裏返りが多い(角の)手を選ぶ', () => {
    const board = buildEvalBoard();
    const move = chooseMove(board, 0, 'normal', createRng(1));
    expect(move).not.toBeNull();
    expect([move!.q, move!.r]).toEqual([3, 0]);
  });

  it('evaluate は石の多い方を高評価する', () => {
    const board = createEmptyBoard(2);
    setStone(board, 0, 0, 0);
    setStone(board, 1, 0, 0);
    const good = evaluate(board, 0);
    const bad = evaluate(board, 1);
    expect(good).toBeGreaterThan(bad);
  });

  it('COM 同士の対局が終局まで進む', () => {
    let state = createGame(createBoard({ radius: 2, gimmicks: false }));
    const rng = createRng(42);
    let guard = 0;
    while (!state.over && guard++ < 500) {
      const move = chooseMove(state.board, state.current, 'normal', rng);
      if (!move) break;
      state = applyMove(state, move.q, move.r);
    }
    expect(state.over).toBe(true);
  });

  it('つよい: 合法手を返し、実用的な時間で完了する', () => {
    const board = createBoard({ radius: 4, gimmicks: false }); // 61マス
    const start = performance.now();
    const move = chooseMove(board, 0, 'hard', createRng(3));
    const elapsed = performance.now() - start;
    expect(move).not.toBeNull();
    expect(elapsed).toBeLessThan(2000);
  });
});

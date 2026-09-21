import { describe, expect, it } from 'vitest';
import { createBoard } from '../../src/core/board';
import { createGame } from '../../src/core/game';
import { chooseLlmMove, decideComMove, parseResponse, buildPrompt, type AiBinding } from '../../src/server/com';

describe('LLM COM (server/com)', () => {
  it('buildPrompt は合法手の番号リストを含む', () => {
    const state = createGame(createBoard({ radius: 2, gimmicks: false }));
    const { prompt, moves } = buildPrompt(state);
    expect(moves.length).toBeGreaterThan(0);
    expect(prompt).toContain('1. (');
    expect(prompt).toContain('ヘクスリバーシ');
  });

  it('parseResponse は番号とコメントを抽出する', () => {
    const moves = [
      { q: 1, r: 0, flips: [], gained: 1 },
      { q: 2, r: 0, flips: [], gained: 2 },
    ];
    expect(parseResponse('2: 角を狙います', moves)).toEqual({ index: 1, comment: '角を狙います' });
    expect(parseResponse(' 3 ', moves)).toBeNull();
    expect(parseResponse('abc', moves)).toBeNull();
  });

  it('chooseLlmMove: AI が妥当な番号を返せばその着手を採用', async () => {
    const state = createGame(createBoard({ radius: 2, gimmicks: false }));
    const { moves } = buildPrompt(state);
    const ai: AiBinding = {
      run: async () => ({ response: `1: いい手です` }),
    };
    const d = await chooseLlmMove(ai, state, 'test-model');
    expect(d).not.toBeNull();
    expect(d!.q).toBe(moves[0].q);
    expect(d!.r).toBe(moves[0].r);
    expect(d!.comment).toBe('いい手です');
  });

  it('chooseLlmMove: 不正回答は再試行し、3回ダメなら null', async () => {
    const state = createGame(createBoard({ radius: 2, gimmicks: false }));
    let calls = 0;
    const ai: AiBinding = {
      run: async () => {
        calls++;
        return { response: 'わかりません' };
      },
    };
    const d = await chooseLlmMove(ai, state, 'test-model');
    expect(d).toBeNull();
    expect(calls).toBe(3);
  });

  it('chooseLlmMove: 合法手が1つだけの場合は LLM を呼ばず null', async () => {
    // radius 2 の初手後は合法手が1つになる局面を作る: 全手を消すわけにいかないため
    // 1手のみの盤を直接組む
    const { createEmptyBoard, setStone } = await import('../../src/core/board');
    const { createGame: cg } = await import('../../src/core/game');
    const board = createEmptyBoard(1);
    setStone(board, -1, 0, 0); // A
    setStone(board, 0, 1, 0);  // A
    setStone(board, 0, 0, 1);  // B
    setStone(board, 0, -1, 1); // B
    setStone(board, -1, 1, 1); // B
    setStone(board, 1, -1, 1); // B
    // 空きマスは (1,0) のみ。Aの手番で(1,0)に置くと(0,0)[B]を挟んで(-1,0)[A]に届く唯一の合法手
    let calls = 0;
    const ai: AiBinding = {
      run: async () => {
        calls++;
        return { response: '1: x' };
      },
    };
    const d = await chooseLlmMove(ai, cg(board), 'test-model');
    expect(d).toBeNull();
    expect(calls).toBe(0);
  });

  it('parseResponse: 番号や「説明:」の残骸はコメントから除かれる', () => {
    const moves = [
      { q: 1, r: 0, flips: [], gained: 1 },
      { q: 2, r: 0, flips: [], gained: 2 },
      { q: 3, r: 0, flips: [], gained: 3 },
      { q: 4, r: 0, flips: [], gained: 4 },
      { q: 5, r: 0, flips: [], gained: 5 },
      { q: 6, r: 0, flips: [], gained: 6 },
      { q: 7, r: 0, flips: [], gained: 7 },
      { q: 8, r: 0, flips: [], gained: 8 },
    ];
    expect(parseResponse('8: 8\n説明: 安全な位置に置く', moves)!.comment).toBe('安全な位置に置く');
    expect(parseResponse('2: 説明: 角を取る', moves)!.comment).toBe('角を取る');
  });

  it('decideComMove: AI 不可時はエンジンにフォールバック', async () => {
    const state = createGame(createBoard({ radius: 2, gimmicks: false }));
    const { move, comment } = await decideComMove(null, state, 'test-model', [1, 2]);
    expect(move).not.toBeNull();
    expect(comment).toBeNull();
  });
});

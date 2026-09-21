import { describe, expect, it } from 'vitest';
import {
  createBoard,
  createEmptyBoard,
  setCellType,
  setStone,
} from '../../src/core/board';
import { hexKey } from '../../src/core/hex';
import { flipsForMove, isLegalMove, legalMoves } from '../../src/core/rules';

// 以下のテストでは半径3(37マス)の盤を使い、
// 東方向を (1,0) 方向(dirIndex=0)として直線を組む。

describe('flipsForMove: 基本の挟み込み', () => {
  it('1枚挟み: 自分の石-相手の石-置く場所', () => {
    const board = createEmptyBoard(3);
    setStone(board, 0, 0, 0);
    setStone(board, 1, 0, 1);
    expect(flipsForMove(board, 2, 0, 0)).toEqual([hexKey(1, 0)]);
  });

  it('ミックス・フリップ: 2色が混ざった直線もすべて裏返る', () => {
    const board = createEmptyBoard(3);
    setStone(board, 0, 0, 0);
    setStone(board, 1, 0, 1);
    setStone(board, 2, 0, 2);
    // 置く場所から見て近い順に収集される
    expect(flipsForMove(board, 3, 0, 0)).toEqual([hexKey(2, 0), hexKey(1, 0)]);
  });

  it('多重フリップ: 2方向同時に裏返る', () => {
    const board = createEmptyBoard(3);
    setStone(board, 2, 0, 0);
    setStone(board, 1, 0, 1); // dir0 側のライン
    setStone(board, 0, 2, 0);
    setStone(board, 0, 1, 2); // dir5 側のライン
    const flips = flipsForMove(board, 0, 0, 0);
    expect(new Set(flips)).toEqual(new Set([hexKey(1, 0), hexKey(0, 1)]));
  });

  it('空マスがあると遮断されて挟みにならない', () => {
    const board = createEmptyBoard(3);
    setStone(board, 0, 0, 0);
    setStone(board, 1, 0, 1);
    // (2,0) が空のまま (3,0) に置いても挟みにならない
    expect(flipsForMove(board, 3, 0, 0)).toEqual([]);
  });

  it('直線の途中に自分の石があると挟みにならない', () => {
    const board = createEmptyBoard(3);
    setStone(board, 0, 0, 0);
    setStone(board, 1, 0, 1);
    setStone(board, 2, 0, 0); // 自分の石が途中にある
    expect(flipsForMove(board, 3, 0, 0)).toEqual([]);
  });
});

describe('flipsForMove: ブラックホール', () => {
  it('ブラックホールで直線が遮断される', () => {
    const board = createEmptyBoard(3);
    setStone(board, 0, 0, 0);
    setStone(board, 1, 0, 1);
    setCellType(board, 2, 0, 'blackhole');
    setStone(board, 3, 0, 0); // 向こう側に自分の石があっても挟めない
    expect(flipsForMove(board, 4, 0, 0)).toEqual([]);
  });

  it('ブラックホールには置けない', () => {
    const board = createEmptyBoard(3);
    setStone(board, 0, 0, 0);
    setStone(board, 2, 0, 1);
    setCellType(board, 1, 0, 'blackhole');
    expect(isLegalMove(board, 1, 0, 0)).toBe(false);
    expect(legalMoves(board, 0).some((m) => m.q === 1 && m.r === 0)).toBe(false);
  });
});

describe('flipsForMove: 地雷(ステルス)', () => {
  it('挟み込みが成立しない地雷マスには配置不可(完全ステルス)', () => {
    const board = createEmptyBoard(3);
    setCellType(board, 0, 0, 'bomb');
    setStone(board, 1, 0, 0);
    setStone(board, -2, 0, 2); // プレイヤー2は石を持つ(未全滅)
    // プレイヤー2は (0,0) で直線挟みが成立しないため置けない
    expect(flipsForMove(board, 0, 0, 2)).toEqual([]);
    expect(isLegalMove(board, 0, 0, 2)).toBe(false);
  });

  it('挟み込みが成立する地雷マス(flipモード): 直線挟み込み＋周囲の自分以外の石が反転対象', () => {
    const board = createEmptyBoard(3);
    board.bombEffect = 'flip';
    setCellType(board, 0, 0, 'bomb');
    // 直線挟み込み: (0,0)にP0が置くと、(1,0)[P1]を挟んで(2,0)[P0]に届く
    setStone(board, 1, 0, 1);
    setStone(board, 2, 0, 0);
    // 周囲に他プレイヤーの石
    setStone(board, 0, -1, 2);
    setStone(board, -1, 1, 1);

    const flips = flipsForMove(board, 0, 0, 0);
    // 直線の(1,0)に加えて、周囲の(0,-1)と(-1,1)が反転対象に含まれる
    expect(new Set(flips)).toEqual(
      new Set([hexKey(1, 0), hexKey(0, -1), hexKey(-1, 1)]),
    );
    expect(isLegalMove(board, 0, 0, 0)).toBe(true);
  });

  it('挟み込みが成立する地雷マス(destroyモード): 直線挟み込みのみがflipsとなり、周囲は消滅破壊(ブラックホール化)される', () => {
    const board = createEmptyBoard(3);
    board.bombEffect = 'destroy';
    setCellType(board, 0, 0, 'bomb');
    // 直線挟み込み: (0,0)にP0が置くと、(1,0)[P1]を挟んで(2,0)[P0]に届く
    setStone(board, 1, 0, 1);
    setStone(board, 2, 0, 0);
    // 周囲に他プレイヤーの石
    setStone(board, 0, -1, 2);

    const flips = flipsForMove(board, 0, 0, 0);
    // destroyモードでは flipsForMove は周囲を含めず直線挟み込みのみを返す
    expect(new Set(flips)).toEqual(new Set([hexKey(1, 0)]));
    expect(isLegalMove(board, 0, 0, 0)).toBe(true);
  });
});

describe('legalMoves', () => {
  it('初期配置(R=2)では全プレイヤーに合法手がある', () => {
    const board = createBoard({ radius: 2, gimmicks: false });
    for (const color of [0, 1, 2] as const) {
      expect(legalMoves(board, color).length).toBeGreaterThan(0);
    }
  });

  it('既に石があるマスには置けない', () => {
    const board = createEmptyBoard(3);
    setStone(board, 0, 0, 0);
    setStone(board, 1, 0, 1);
    expect(isLegalMove(board, 0, 0, 2)).toBe(false);
  });
});

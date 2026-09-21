import { describe, expect, it } from 'vitest';
import {
  createBoard,
  createEmptyBoard,
  createRng,
  setCellType,
  setStone,
} from '../../src/core/board';
import {
  GameState,
  applyMove,
  applyPass,
  createGame,
  isBoardFull,
  movesFor,
  scores,
  seatForTurn,
} from '../../src/core/game';
import { StoneColor } from '../../src/core/types';

/** 全員が (1,0) 以外の6マスで挟めない状況を作る専用ボード(R=1)。 */
function buildNoMoveBoard() {
  const board = createEmptyBoard(1);
  // 空き: (1,0)。配置: A(0,0),A(-1,0), B(0,-1),B(0,1),B(-1,1), C(1,-1)
  setStone(board, 0, 0, 0);
  setStone(board, -1, 0, 0);
  setStone(board, 0, -1, 1);
  setStone(board, 0, 1, 1);
  setStone(board, -1, 1, 1);
  setStone(board, 1, -1, 2);
  return board;
}

describe('createGame + applyMove', () => {
  it('初期配置(R=2)で手番が回り、石が置かれて裏返る', () => {
    let state = createGame(createBoard({ radius: 2, gimmicks: false }));
    expect(state.current).toBe(0);
    const moves = movesFor(state, 0);
    expect(moves.length).toBeGreaterThan(0);

    const move = moves[0];
    state = applyMove(state, move.q, move.r);
    expect(state.turn).toBe(1);
    expect(state.current).toBe(1);
    const placed = state.board.cells.get(`${move.q},${move.r}`)!;
    expect(placed.stone).toBe(0);
    for (const key of move.flips) {
      expect(state.board.cells.get(key)!.stone).toBe(0);
    }
  });

  it('手番順はラウンドごとにローテーションする(0,1,2 → 1,2,0 → …)', () => {
    // seatForTurn(t) = (t + floor(t/3)) % 3
    expect([0, 1, 2, 3, 4, 5, 6].map((t) => seatForTurn(t))).toEqual([0, 1, 2, 1, 2, 0, 2]);

    let state = createGame(createBoard({ radius: 2, gimmicks: false }));
    const seats = [state.current];
    for (let i = 0; i < 6; i++) {
      const m = movesFor(state, state.current)[0];
      state = applyMove(state, m.q, m.r);
      seats.push(state.current);
    }
    expect(seats).toEqual([0, 1, 2, 1, 2, 0, 2]);
  });

  it('開始席と回転方向を指定できる(対局ごとのランダム化用)', () => {
    const board = createBoard({ radius: 2, gimmicks: false });
    const s1 = createGame(board, { seatOffset: 1, seatDirection: 1 });
    expect(s1.current).toBe(1);
    expect(s1.seatOffset).toBe(1);
    // 逆回転: t=1 は開始席の1つ前の席
    expect(seatForTurn(1, 0, 2)).toBe(2);
    expect(seatForTurn(4, 0, 2)).toBe(1);
  });

  it('ハンデ: 席2を3番手に固定すると毎ラウンド最終手番になる(1番手と2番手は交代)', () => {
    // t=0..8 の席: [0,1,2] → [1,0,2] → [0,1,2]
    expect([0, 1, 2, 3, 4, 5, 6, 7, 8].map((t) => seatForTurn(t, 0, 1, true))).toEqual([
      0, 1, 2, 1, 0, 2, 0, 1, 2,
    ]);

    let state = createGame(createBoard({ radius: 2, gimmicks: false }), { fixThirdSeat: true });
    expect(state.current).toBe(0);
    const seats = [state.current];
    for (let i = 0; i < 5; i++) {
      const m = movesFor(state, state.current)[0];
      state = applyMove(state, m.q, m.r);
      seats.push(state.current);
    }
    expect(seats).toEqual([0, 1, 2, 1, 0, 2]); // 席2は常に3番手
    expect(state.fixThirdSeat).toBe(true);
  });


  it('合法手でない場所への着手はエラー', () => {
    const state = createGame(createBoard({ radius: 2, gimmicks: false }));
    expect(() => applyMove(state, 0, 0)).toThrow();
  });
});

describe('終了条件: パスと自由配置', () => {
  it('通常手がないプレイヤーは自由配置でき、満盤で終了', () => {
    // buildNoMoveBoard 上では全員が (1,0) で挟めない → 自由配置が発生
    let state = createGame(buildNoMoveBoard());
    state = { ...state, current: 2 as StoneColor }; // C から開始
    const moves = movesFor(state, 2);
    expect(moves).toHaveLength(1);
    expect(moves[0].free).toBe(true);

    state = applyMove(state, 1, 0); // C が自由配置で最後のマスを埋める
    expect(state.over).toBe(true);
    // A=2, B=3, C=2 → 勝者 B
    expect(scores(state.board)).toEqual([2, 3, 2]);
    expect(state.winner).toBe(1);
  });

  it('自由配置がある局面ではパスはエラー', () => {
    const state = { ...createGame(buildNoMoveBoard()), current: 2 as StoneColor };
    expect(() => applyPass(state)).toThrow();
  });

  it('通常手がある局面でもパスはエラー', () => {
    const state = createGame(createBoard({ radius: 2, gimmicks: false }));
    expect(() => applyPass(state)).toThrow();
  });
});

describe('終了条件: 満盤', () => {
  it('ブラックホール以外の全マスに石があれば満盤', () => {
    const board = buildNoMoveBoard();
    expect(isBoardFull(board)).toBe(false); // (1,0) が空
    setStone(board, 1, 0, 2);
    expect(isBoardFull(board)).toBe(true);
  });

  it('ブラックホールは満盤判定に含めない', () => {
    const board = buildNoMoveBoard();
    setStone(board, 1, 0, 2);
    setCellType(board, 0, -1, 'blackhole');
    setStone(board, 0, -1, -1); // ブラックホールは石を持たない
    expect(isBoardFull(board)).toBe(true);
  });

  it('地雷(flipモード)で最後の空マスを埋めるとゲーム終了', () => {
    // R=1 専用盤。空き: (1,0)。
    // Cが(1,0)に置くと、(0,0)[B]を挟んで(-1,0)[C]に届く直線挟み込みが成立する
    const board = createEmptyBoard(1);
    board.bombEffect = 'flip';
    setStone(board, -1, 0, 2); // C
    setStone(board, 0, 0, 1);  // B
    setStone(board, 0, -1, 1); // B
    setStone(board, 0, 1, 1);  // B
    setStone(board, -1, 1, 0); // A
    setStone(board, 1, -1, 0); // A
    setCellType(board, 1, 0, 'bomb');

    let state = createGame(board);
    state = { ...state, current: 2 as StoneColor };
    state = applyMove(state, 1, 0);
    // (1,0) に C が置き、直線挟みと周囲の石がすべて自色に反転
    expect(state.over).toBe(true);
    expect(state.board.cells.get('1,0')?.stone).toBe(2);
    expect(state.winner).toBe(2);
  });

  it('地雷(destroyモード)を着手すると、爆心地のみブラックホール化し、反転も起きず1手損する', () => {
    const board = createEmptyBoard(3);
    board.bombEffect = 'destroy';
    setCellType(board, 0, 0, 'bomb');
    // 直線挟み込み: (0,0)にP0が置くと、(1,0)[P1]を挟んで(2,0)[P0]に届く
    setStone(board, 1, 0, 1);
    setStone(board, 2, 0, 0);
    // 周囲の他プレイヤー石
    setStone(board, 0, -1, 2);
    setStone(board, -1, 1, 1);

    let state = createGame(board);
    state = { ...state, current: 0 as StoneColor };
    state = applyMove(state, 0, 0);

    // 起爆マス自身（爆心地）はブラックホール化し、石は乗らない(stone: -1)
    const epicenter = state.board.cells.get('0,0');
    expect(epicenter?.stone).toBe(-1);
    expect(epicenter?.type).toBe('blackhole');

    // 直線挟みの石(1,0)は反転されずP1のまま無傷
    expect(state.board.cells.get('1,0')?.stone).toBe(1);
    expect(state.board.cells.get('2,0')?.stone).toBe(0);

    // 周囲の石(0,-1)と(-1,1)も無傷で維持
    expect(state.board.cells.get('0,-1')?.stone).toBe(2);
    expect(state.board.cells.get('-1,1')?.stone).toBe(1);

    // P0のスコアは増えず(1手損)、手番はP1に進む
    expect(state.turn).toBe(1);
    expect(state.current).toBe(1);
  });
});

describe('スコア計算: 倍点マス', () => {
  it('double=×2, triple=×3 でカウント', () => {
    const board = createEmptyBoard(2);
    setCellType(board, 0, 0, 'double');
    setStone(board, 0, 0, 0);
    setCellType(board, 1, -1, 'triple');
    setStone(board, 1, -1, 2);
    setStone(board, 2, 0, 1); // 通常マス
    expect(scores(board)).toEqual([2, 1, 3]);
  });
});

describe('ランダムプレイアウト', () => {
  function playout(seed: number, gimmicks: boolean): GameState {
    let state = createGame(
      createBoard({
        radius: 2,
        gimmicks,
        gimmickCounts: gimmicks
          ? { double: 1, triple: 0, blackhole: 1, bomb: 1 }
          : undefined,
        seed,
      }),
    );
    const rng = createRng(seed);
    let guard = 0;
    while (!state.over && guard++ < 500) {
      const moves = movesFor(state, state.current);
      if (moves.length === 0) {
        state = applyPass(state);
        continue;
      }
      const m = moves[Math.floor(rng() * moves.length)];
      state = applyMove(state, m.q, m.r);
    }
    return state;
  }

  it.each([1, 2, 3, 42, 777])('シード %i: 終了し、勝者とスコアが一致する', (seed) => {
    for (const gimmicks of [false, true]) {
      const state = playout(seed, gimmicks);
      expect(state.over).toBe(true);
      const s = scores(state.board);
      const max = Math.max(...s);
      const holders = s.filter((v) => v === max).length;
      if (holders === 1) {
        expect(state.winner).toBe(s.indexOf(max));
      } else {
        expect(state.winner).toBeNull(); // 共勝
      }
    }
  });
});

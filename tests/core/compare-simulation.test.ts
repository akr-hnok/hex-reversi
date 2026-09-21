import { it } from 'vitest';
import { createBoard, createRng, BoardConfig } from '../../src/core/board';
import { chooseMove, EngineLevel } from '../../src/core/engine';
import { applyMove, createGame, scores, seatForTurn, GameState } from '../../src/core/game';
import { StoneColor } from '../../src/core/types';

const GAME_COUNT = 100;
const RADIUS = 4; // 61マス
const LEVEL: EngineLevel = 'normal';

interface SimResult {
  title: string;
  wins: [number, number, number];
  roleWins: [number, number, number]; // 先攻, 2番手, 3番手
  ties: number;
  avgScores: [number, number, number];
  avgTurns: number;
  avgFreeMoves: number;
  wipeoutRate: number; // 1試合あたりの全滅発生回数
  blackholesCountAvg?: number;
}

function runSimulation(title: string, configFn: (seed: number) => BoardConfig): SimResult {
  const wins = [0, 0, 0];
  const roleWins = [0, 0, 0];
  let ties = 0;
  const scoreSums = [0, 0, 0];
  let turnSum = 0;
  let freeMovesSum = 0;
  let wipeoutsSum = 0;
  let finalBlackholesSum = 0;

  for (let seed = 1; seed <= GAME_COUNT; seed++) {
    const boardConfig = configFn(seed);
    const seatOffset = (seed % 3) as StoneColor;
    const seatDirection = Math.floor(seed / 7) % 2 === 0 ? 1 : 2;

    let state: GameState = createGame(createBoard(boardConfig), {
      seatOffset,
      seatDirection,
    });
    const rng = createRng(seed);
    let freeMoves = 0;
    let wipeouts = 0;
    const wasZero = [false, false, false];

    let guard = 0;
    while (!state.over && guard++ < 500) {
      const move = chooseMove(state.board, state.current, LEVEL, rng, [
        seatForTurn(state.turn + 1, state.seatOffset, state.seatDirection),
        seatForTurn(state.turn + 2, state.seatOffset, state.seatDirection),
      ]);
      if (!move) break;
      if (move.free) freeMoves++;
      state = applyMove(state, move.q, move.r);

      const s = scores(state.board);
      for (const c of [0, 1, 2] as StoneColor[]) {
        if (s[c] === 0) {
          if (!wasZero[c]) wipeouts++;
          wasZero[c] = true;
        } else {
          wasZero[c] = false;
        }
      }
    }

    const finalScores = scores(state.board);
    const maxScore = Math.max(...finalScores);
    const winners = [0, 1, 2].filter((i) => finalScores[i] === maxScore);

    if (winners.length > 1) ties++;
    for (const w of winners) {
      wins[w]++;
      const firstSeat = seatForTurn(0, state.seatOffset, state.seatDirection);
      const secondSeat = seatForTurn(1, state.seatOffset, state.seatDirection);
      const thirdSeat = seatForTurn(2, state.seatOffset, state.seatDirection);
      if (w === firstSeat) roleWins[0]++;
      else if (w === secondSeat) roleWins[1]++;
      else if (w === thirdSeat) roleWins[2]++;
    }

    scoreSums[0] += finalScores[0];
    scoreSums[1] += finalScores[1];
    scoreSums[2] += finalScores[2];
    turnSum += state.turn;
    freeMovesSum += freeMoves;
    wipeoutsSum += wipeouts;

    let bhCount = 0;
    for (const cell of state.board.cells.values()) {
      if (cell.type === 'blackhole') bhCount++;
    }
    finalBlackholesSum += bhCount;
  }

  return {
    title,
    wins: [wins[0], wins[1], wins[2]],
    roleWins: [roleWins[0], roleWins[1], roleWins[2]],
    ties,
    avgScores: [
      Math.round((scoreSums[0] / GAME_COUNT) * 10) / 10,
      Math.round((scoreSums[1] / GAME_COUNT) * 10) / 10,
      Math.round((scoreSums[2] / GAME_COUNT) * 10) / 10,
    ],
    avgTurns: Math.round((turnSum / GAME_COUNT) * 10) / 10,
    avgFreeMoves: Math.round((freeMovesSum / GAME_COUNT) * 100) / 100,
    wipeoutRate: Math.round((wipeoutsSum / GAME_COUNT) * 100) / 100,
    blackholesCountAvg: Math.round((finalBlackholesSum / GAME_COUNT) * 10) / 10,
  };
}

function printReport(r: SimResult) {
  console.log(`\n========================================`);
  console.log(`${r.title}`);
  console.log(`========================================`);
  console.log(`席別勝率: P1=${r.wins[0]}% | P2=${r.wins[1]}% | P3=${r.wins[2]}% (同点共勝: ${r.ties}局)`);
  console.log(`役別勝率: 先攻=${r.roleWins[0]}% | 2番手=${r.roleWins[1]}% | 3番手=${r.roleWins[2]}%`);
  console.log(`平均スコア: P1=${r.avgScores[0]} | P2=${r.avgScores[1]} | P3=${r.avgScores[2]}`);
  console.log(`平均手数: ${r.avgTurns} 手 (自由配置: 平均 ${r.avgFreeMoves} 回/局)`);
  console.log(`全滅イベント: 平均 ${r.wipeoutRate} 回/局`);
  if (r.blackholesCountAvg !== undefined) {
    console.log(`最終ブラックホール数: 平均 ${r.blackholesCountAvg} マス/盤面`);
  }
}

it('run comparative simulations', { timeout: 300_000 }, () => {
  // 1. 通常ルール (ギミックなし)
  const resNormal = runSimulation('【1】通常ルール (ギミックなし)', (seed) => ({
    radius: RADIUS,
    gimmicks: false,
    seed,
  }));
  printReport(resNormal);

  // 2. 地雷(破壊モード: 爆心地ブラックホール化・1手損)
  const resDestroy = runSimulation('【2】地雷(破壊モード: 爆心地ブラックホール化・1手損)', (seed) => ({
    radius: RADIUS,
    gimmicks: true,
    gimmickCounts: { double: 0, triple: 0, blackhole: 0, bomb: 2 }, // 地雷2組=6マス
    bombEffect: 'destroy',
    seed,
  }));
  printReport(resDestroy);

  // 3. 地雷(反転モード: 周囲反転)
  const resFlip = runSimulation('【3】地雷(反転モード: 周囲反転)', (seed) => ({
    radius: RADIUS,
    gimmicks: true,
    gimmickCounts: { double: 0, triple: 0, blackhole: 0, bomb: 2 }, // 地雷2組=6マス
    bombEffect: 'flip',
    seed,
  }));
  printReport(resFlip);

  // 4. フルギミック(倍点+BH+地雷破壊)
  const resFullGimmick = runSimulation('【4】フルギミック (倍点+BH+地雷破壊)', (seed) => ({
    radius: RADIUS,
    gimmicks: true,
    gimmickCounts: { double: 1, triple: 0, blackhole: 1, bomb: 1 },
    bombEffect: 'destroy',
    seed,
  }));
  printReport(resFullGimmick);
});

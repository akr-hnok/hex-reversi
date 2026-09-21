import { it } from 'vitest';
import { createBoard, createRng } from '../../src/core/board';
import { chooseMove, type EngineLevel } from '../../src/core/engine';
import { applyMove, createGame, movesFor, scores, seatForTurn, type GameState } from '../../src/core/game';
import { StoneColor } from '../../src/core/types';

declare const process: { env: Record<string, string | undefined> };

/**
 * バランス検証シミュレーション。
 * 全部COM・ギミックなしの既定設定で N 回対局し、集計レポートを出力する。
 * レポート目的のテストのため常にパスする。
 */

const GAME_COUNT = Number(process.env.SIM_GAMES ?? 100);
const RADIUS = 4; // 一辺5マス(61マス) が既定
const LEVEL: EngineLevel = 'normal';

interface GameResult {
  winners: StoneColor[];
  scores: [number, number, number];
  turns: number;
  freeMoves: number;
  wipeoutEvents: number;
  /** この対局で一度でも石が0個になった席(復活後に再び全滅した場合も含む)。 */
  everWiped: StoneColor[];
  /** この対局の開始席。ロール別集計に使う。 */
  seatOffset: number;
}

function playGame(seed: number): GameResult {
  // 実運用と同じく開始席と回転方向をシードでランダム化する
  let state: GameState = createGame(
    createBoard({ radius: RADIUS, gimmicks: false, seed }),
    { seatOffset: seed % 3, seatDirection: Math.floor(seed / 7) % 2 === 0 ? 1 : 2 },
  );
  const rng = createRng(seed);
  let freeMoves = 0;
  let wipeouts = 0;
  let wasZero = [false, false, false];
  let everZero = [false, false, false];
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
        everZero[c] = true;
      } else {
        wasZero[c] = false;
      }
    }
  }
  // 席の並び替え: 各ゲームの「物理席」を先攻起点で正規化しない(開始席は結果に影響する)。
  // 代わりに seatOffset を記録して、統計は seatOffset 順(=実プレイヤー視点)で集計する。
  const s = scores(state.board);
  const max = Math.max(...s);
  return {
    winners: s.flatMap((v, i) => (v === max ? [i as StoneColor] : [])),
    scores: s,
    turns: state.turn,
    freeMoves,
    wipeoutEvents: wipeouts,
    everWiped: [0, 1, 2].filter((c) => everZero[c]) as StoneColor[],
    seatOffset: state.seatOffset,
  };
}

it(`balance simulation: ${GAME_COUNT} games (radius ${RADIUS}, level ${LEVEL})`, { timeout: 300_000 }, () => {
  const results: GameResult[] = [];
  for (let seed = 1; seed <= GAME_COUNT; seed++) {
    results.push(playGame(seed));
  }

  const wins = [0, 0, 0];
  let ties = 0;
  const avgScores = [0, 0, 0];
  let winnerShareSum = 0;
  let marginTop2Sum = 0;
  let blowout60 = 0; // 勝者が全石の60%超
  let blowout75 = 0; // 75%超
  let turnsSum = 0;
  let freeMovesSum = 0;
  let wipeoutsSum = 0;
  let perfectGames = 0; // 誰かが全石を取った局
  const turnHistogram = new Map<string, number>();

  for (const r of results) {
    for (const w of r.winners) wins[w]++;
    if (r.winners.length > 1) ties++;
    const total = r.scores[0] + r.scores[1] + r.scores[2];
    const sorted = [...r.scores].sort((a, b) => b - a);
    winnerShareSum += sorted[0] / total;
    marginTop2Sum += sorted[0] - sorted[1];
    if (sorted[0] / total > 0.6) blowout60++;
    if (sorted[0] / total > 0.75) blowout75++;
    if (sorted[0] === total) perfectGames++;
    turnsSum += r.turns;
    freeMovesSum += r.freeMoves;
    wipeoutsSum += r.wipeoutEvents;
    r.scores.forEach((v, i) => (avgScores[i] += v));
    const bucket = `${Math.floor(r.turns / 10) * 10}-${Math.floor(r.turns / 10) * 10 + 9}`;
    turnHistogram.set(bucket, (turnHistogram.get(bucket) ?? 0) + 1);
  }

  const n = results.length;
  const pct = (x: number) => `${((x / n) * 100).toFixed(1)}%`;

  // ロール別(その対局での手番順: 先攻/2番手/3番手)勝率。seatOffset で正規化する。
  const roleWins = [0, 0, 0];
  for (const r of results) {
    for (const w of r.winners) {
      roleWins[(w - r.seatOffset + 3) % 3]++;
    }
  }

  // 全滅経験者の成績(復活着手はエンジンが評価値最大=隅優先で選ぶため、
  // 「全滅→隅で復活」の戦術が含まれた形で測れる)。
  let wipedPlayers = 0;
  let wipedWins = 0;
  let wipedRankSum = 0;
  let wipedScoreSum = 0;
  for (const r of results) {
    const ranked = r.scores
      .map((v, i) => ({ seat: i as StoneColor, score: v }))
      .sort((a, b) => b.score - a.score);
    for (const seat of r.everWiped) {
      wipedPlayers++;
      if (r.winners.includes(seat)) wipedWins++;
      wipedRankSum += ranked.findIndex((x) => x.seat === seat) + 1;
      wipedScoreSum += r.scores[seat];
    }
  }

  const lines = [
    `===== balance report (${n} games, radius=${RADIUS}, level=${LEVEL}, randomized seats) =====`,
    `wins by seat: P1=${wins[0]} (${pct(wins[0])}), P2=${wins[1]} (${pct(wins[1])}), P3=${wins[2]} (${pct(wins[2])})  ties(共勝)=${ties}`,
    `wins by role: 先攻=${roleWins[0]} (${pct(roleWins[0])}), 2番手=${roleWins[1]} (${pct(roleWins[1])}), 3番手=${roleWins[2]} (${pct(roleWins[2])})`,
    `wiped players: ${wipedPlayers} (avg ${(wipedPlayers / n).toFixed(2)}/game) → win rate ${pct(wipedWins)} (baseline 33%), avg rank ${(wipedRankSum / Math.max(1, wipedPlayers)).toFixed(2)}, avg score ${(wipedScoreSum / Math.max(1, wipedPlayers)).toFixed(1)}`,
    `avg score: P1=${(avgScores[0] / n).toFixed(1)}, P2=${(avgScores[1] / n).toFixed(1)}, P3=${(avgScores[2] / n).toFixed(1)}`,
    `winner stone share: avg=${(winnerShareSum / n * 100).toFixed(1)}%  >60%: ${pct(blowout60)}  >75%: ${pct(blowout75)}  全取り: ${perfectGames}`,
    `1st-2nd margin: avg=${(marginTop2Sum / n).toFixed(1)} stones`,
    `turns: avg=${(turnsSum / n).toFixed(1)}  histogram=${JSON.stringify([...turnHistogram.entries()].sort())}`,
    `free placements: avg=${(freeMovesSum / n).toFixed(2)}/game  wipeout events: avg=${(wipeoutsSum / n).toFixed(2)}/game`,
  ];
  for (const line of lines) console.log(line);
});

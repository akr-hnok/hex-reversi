import { chooseMove } from '../core/engine';
import { GameState, scores } from '../core/game';
import { legalMoves, Move } from '../core/rules';
import { StoneColor } from '../core/types';

/**
 * Workers AI を使った LLM COM。
 * 合法手の番号リストをプロンプトに与え、番号で着手を選ばせる。
 * 回答は必ずサーバー側で合法手検証し、不正・失敗時は呼び出し側が古典エンジンにフォールバックする。
 */

export interface AiBinding {
  run(
    model: string,
    input: {
      messages: Array<{ role: 'system' | 'user'; content: string }>;
      max_tokens?: number;
    },
  ): Promise<{ response?: string }>;
}

export const DEFAULT_AI_MODEL = '@cf/meta/llama-3.2-3b-instruct';

export function buildPrompt(state: GameState): { prompt: string; moves: Move[] } {
  const moves = legalMoves(state.board, state.current);
  const me = 'ABC'[state.current];
  const cells: string[] = [];
  for (const cell of state.board.cells.values()) {
    const st = cell.stone === -1 ? '.' : 'ABC'[cell.stone];
    const tag =
      cell.type === 'double'
        ? '(×2)'
        : cell.type === 'triple'
          ? '(×3)'
          : cell.type === 'bomb'
            ? '(爆)'
            : cell.type === 'blackhole'
              ? '(黒)'
              : '';
    cells.push(`${cell.q},${cell.r}:${st}${tag}`);
  }
  const counts = scores(state.board);
  const moveList = moves.map((m, i) => `${i + 1}. (${m.q},${m.r})`).join('\n');
  const prompt = `3人対戦のヘクスリバーシです。あなたはプレイヤー${me}の番です。
ルール: 6方向の直線で相手の石を挟むと裏返る(混色可)。石が0個の人はどこかに置いて復活できる。ボム(爆)は置くと周囲を強制反転。ブラックホール(黒)は置けず遮断する。終了時に石(倍点込み)が多い人の勝ち。

盤面(座標:状態 .=空 A/B/C=石 (×2)(×3)=倍点 (爆)=ボム (黒)=ブラックホール):
${cells.join(' ')}

石数 A=${counts[0]}, B=${counts[1]}, C=${counts[2]}

以下の合法手の中から最善の一手を1つ選び、下記の形式だけで回答してください(解説は必ず付け、一覧の形式を真似しないでください):
番号: 日本語の短い解説
回答例) 4: 外周を固めて裏返されにくくします
${moveList}`;
  return { prompt, moves };
}

export function parseResponse(
  text: string,
  moves: Move[],
): { index: number; comment: string | null } | null {
  const m = text.trim().match(/(\d{1,3})/);
  if (!m) return null;
  const index = parseInt(m[1], 10) - 1;
  if (index < 0 || index >= moves.length) return null;
  const parts = text.split(/[:：]/);
  let comment = (parts.length > 1 ? parts.slice(1).join(':') : '').trim().slice(0, 80);
  // モデルが番号や「説明:」を重ねて出力した場合の残骸を取り除く
  comment = comment.replace(/^\s*\d+\s*[:：]?\s*/, '').replace(/^説明\s*[:：]?\s*/, '').trim();
  return { index, comment: comment || null };
}

export interface LlmDecision {
  q: number;
  r: number;
  comment: string | null;
}

/** LLM に着手を選ばせる。3回試してダメなら null(呼び出し側がフォールバック)。 */
export async function chooseLlmMove(
  ai: AiBinding,
  state: GameState,
  model: string,
): Promise<LlmDecision | null> {
  const { prompt, moves } = buildPrompt(state);
  // 合法手が1つしかない場合は LLM を使わない(強制手に解説は不要・コストも省ける)
  if (moves.length <= 1) return null;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await ai.run(model, {
        messages: [{ role: 'user', content: prompt }],
        max_tokens: 100,
      });
      const parsed = parseResponse(res.response ?? '', moves);
      if (parsed) {
        const mv = moves[parsed.index];
        return { q: mv.q, r: mv.r, comment: parsed.comment };
      }
    } catch {
      // 次の試行へ
    }
  }
  return null;
}

/** LLM 優先、失敗時は古典エンジン。呼び出し側が move を検証・適用する。 */
export async function decideComMove(
  ai: AiBinding | null,
  state: GameState,
  model: string,
  nextSeats: readonly [StoneColor, StoneColor],
): Promise<{ move: Move; comment: string | null }> {
  if (ai) {
    const llm = await chooseLlmMove(ai, state, model);
    if (llm) {
      const move = legalMoves(state.board, state.current).find(
        (m) => m.q === llm.q && m.r === llm.r,
      );
      if (move) return { move, comment: llm.comment };
    }
  }
  const move = chooseMove(state.board, state.current, 'normal', Math.random, nextSeats);
  if (!move) throw new Error('no legal move');
  return { move, comment: null };
}

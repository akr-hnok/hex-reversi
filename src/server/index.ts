import { BoardConfig } from '../core/board';
import { seatForTurn } from '../core/game';
import { legalMoves } from '../core/rules';
import { deserializeGame, SerializedGame } from '../core/serde';
import { ComType, StoneColor } from '../core/types';
import { chooseMove } from '../core/engine';
import { decideComMove, DEFAULT_AI_MODEL } from './com';
import { GameRoom } from './room';

export { GameRoom };

const ID_CHARS = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';

function genRoomId(): string {
  const bytes = new Uint8Array(6);
  crypto.getRandomValues(bytes);
  return [...bytes].map((b) => ID_CHARS[b % ID_CHARS.length]).join('');
}

function nextSeatsOf(game: SerializedGame): [StoneColor, StoneColor] {
  return [
    seatForTurn(game.turn + 1, game.seatOffset, game.seatDirection, game.fixThirdSeat),
    seatForTurn(game.turn + 2, game.seatOffset, game.seatDirection, game.fixThirdSeat),
  ];
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    // AI 助言(対局中の「💡 助言」ボタンから呼ばれる)
    if (url.pathname === '/api/com/advice' && request.method === 'POST') {
      let body: { game?: SerializedGame };
      try {
        body = await request.json();
      } catch {
        return Response.json({ error: 'invalid body' }, { status: 400 });
      }
      if (!body.game) return Response.json({ error: 'game required' }, { status: 400 });
      const state = deserializeGame(body.game);
      if (state.over) return Response.json({ error: 'game over' }, { status: 400 });
      try {
        const { move, comment } = await decideComMove(
          env.AI ?? null,
          state,
          env.AI_MODEL || DEFAULT_AI_MODEL,
          nextSeatsOf(body.game),
        );
        return Response.json({ q: move.q, r: move.r, comment });
      } catch {
        return Response.json({ error: 'no legal move' }, { status: 400 });
      }
    }

    // ルーム作成
    if (url.pathname === '/api/rooms' && request.method === 'POST') {
      let config: BoardConfig;
      let com: [ComType, ComType, ComType] = ['none', 'none', 'none'];
      let fixThirdSeat = false;
      try {
        const body = await request.json();
        config = body.config as BoardConfig;
        if (Array.isArray(body.com) && body.com.length === 3) com = body.com;
        fixThirdSeat = body.fixThirdSeat === true;
      } catch {
        return Response.json({ error: 'invalid config' }, { status: 400 });
      }
      if (!Number.isInteger(config.radius) || config.radius < 1 || config.radius > 6) {
        return Response.json({ error: 'invalid radius' }, { status: 400 });
      }
      const roomId = genRoomId();
      const id = env.ROOM.idFromName(roomId);
      await env.ROOM.get(id).fetch(
        new Request(`${url.origin}/internal/rooms/init`, {
          method: 'POST',
          body: JSON.stringify({ config, com, roomId, fixThirdSeat }),
        }),
      );
      return Response.json({ roomId });
    }

    // ルーム関連(スナップショット / WebSocket 昇格)は DO に委譲
    const m = url.pathname.match(/^\/api\/rooms\/([A-Za-z0-9_-]+)(\/ws)?$/);
    if (m && (request.method === 'GET' || request.headers.get('Upgrade') === 'websocket')) {
      const id = env.ROOM.idFromName(m[1]);
      return env.ROOM.get(id).fetch(request);
    }

    return env.ASSETS.fetch(request);
  },
};

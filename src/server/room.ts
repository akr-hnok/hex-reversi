import { BoardConfig } from '../core/board';
import { chooseMove } from '../core/engine';
import { seatForTurn } from '../core/game';
import { legalMoves } from '../core/rules';
import { ComType } from '../core/types';
import { ClientMessage, Seat, ServerMessage } from '../shared/protocol';
import { AiBinding, chooseLlmMove, DEFAULT_AI_MODEL } from './com';
import { PersistedRoom, RoomCore } from './room-core';

/**
 * 1ルーム = 1 Durable Object インスタンス。
 * WebSocket(非 hibernation 方式)を中継し、COM 席の自動着手と状態の永続化を行う。
 */

const STORAGE_KEY = 'room';

type ServerSocket = WebSocket & { accept(): void };

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export class GameRoom {
  private core: RoomCore;
  private sockets = new Map<ServerSocket, Seat>();
  private initialized = false;
  private comRunning = false;
  private comLoopId = 0;

  constructor(
    private ctx: DurableObjectState,
    private env: Env,
  ) {
    this.core = new RoomCore('', { radius: 4, gimmicks: false });
    ctx.blockConcurrencyWhile(async () => {
      const saved = await ctx.storage.get<PersistedRoom>(STORAGE_KEY);
      if (saved) {
        this.core = RoomCore.restore('', saved);
        this.initialized = true;
      }
    });
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);

    // ルーム初期化(Worker からの内部呼び出し)
    if (url.pathname.endsWith('/init') && request.method === 'POST') {
      const { config, com, roomId, fixThirdSeat } = (await request.json()) as {
        config: BoardConfig;
        com: [ComType, ComType, ComType];
        roomId: string;
        fixThirdSeat?: boolean;
      };
      this.core = new RoomCore(roomId, config, com, Math.random, fixThirdSeat === true);
      this.initialized = true;
      await this.persist();
      return new Response('ok');
    }

    if (!this.initialized) {
      return Response.json({ error: 'room not found' }, { status: 404 });
    }

    // スナップショット取得(参加画面の席状態表示用)。アップグレード無しの GET として扱う。
    if (request.method === 'GET' && request.headers.get('Upgrade') !== 'websocket') {
      return Response.json(this.core.snapshot());
    }

    // WebSocket 昇格
    const seatParam = Number(url.searchParams.get('seat'));
    if (request.headers.get('Upgrade') !== 'websocket' || !(seatParam === 0 || seatParam === 1 || seatParam === 2)) {
      return new Response('expected websocket upgrade', { status: 400 });
    }
    const pair = new WebSocketPair();
    this.handleSocket(pair[1] as unknown as ServerSocket, seatParam as Seat);
    return new Response(null, { status: 101, webSocket: pair[0] } as unknown as ResponseInit);
  }

  private handleSocket(ws: ServerSocket, seat: Seat): void {
    ws.accept();
    this.sockets.set(ws, seat);
    const joined = this.core.join(seat);
    if (!joined.ok) {
      this.send(ws, { type: 'error', message: joined.error });
      ws.close(4000, joined.error);
      this.sockets.delete(ws);
      return;
    }
    void this.persist();
    this.broadcast();
    this.maybeComMove();

    ws.addEventListener('message', (event) => {
      let msg: ClientMessage;
      try {
        msg = JSON.parse(String(event.data)) as ClientMessage;
      } catch {
        return;
      }
      if (msg.type === 'move') {
        const res = this.core.move(seat, msg.q, msg.r);
        if (!res.ok) this.send(ws, { type: 'error', message: res.error });
      } else if (msg.type === 'rematch') {
        this.core.voteRematch(seat);
      } else {
        return; // join は接続時に済ませる
      }
      void this.persist();
      this.broadcast();
      this.maybeComMove();
    });

    ws.addEventListener('close', () => {
      this.sockets.delete(ws);
      this.core.disconnect(seat);
      void this.persist();
      this.broadcast();
    });
  }

  /** COM 席の自動着手ループ。人間の席に回る・終局・新規ループ開始で止まる。 */
  private maybeComMove(): void {
    const game = this.core.game;
    if (!game || game.over || this.comRunning) return;
    if (this.core.com[game.current] === 'none') return;
    this.comRunning = true;
    const id = ++this.comLoopId;
    void (async () => {
      try {
        while (id === this.comLoopId) {
          const state = this.core.game;
          if (!state || state.over) break;
          const seat = state.current;
          const type = this.core.com[seat];
          if (type === 'none') break;
          await sleep(600 + Math.random() * 700);

          const nextSeats: [Seat, Seat] = [
            seatForTurn(state.turn + 1, state.seatOffset, state.seatDirection, state.fixThirdSeat),
            seatForTurn(state.turn + 2, state.seatOffset, state.seatDirection, state.fixThirdSeat),
          ];
          let move = null;
          let comment: string | null = null;
          if (type === 'llm' && this.env.AI) {
            const model = this.env.AI_MODEL || DEFAULT_AI_MODEL;
            const llm = await chooseLlmMove(this.env.AI, state, model);
            if (llm) {
              move =
                legalMoves(state.board, seat).find((m) => m.q === llm.q && m.r === llm.r) ?? null;
              comment = llm.comment;
            }
          }
          if (!move) {
            move = chooseMove(state.board, seat, 'normal', Math.random, nextSeats);
          }
          if (!move) break;
          const res = this.core.move(seat, move.q, move.r);
          if (!res.ok) break;
          if (comment) this.core.setComment(seat, comment);
          await this.persist();
          this.broadcast();
        }
      } finally {
        this.comRunning = false;
      }
    })();
  }

  private send(ws: ServerSocket, msg: ServerMessage): void {
    try {
      ws.send(JSON.stringify(msg));
    } catch {
      // 切断済み
    }
  }

  private broadcast(): void {
    const snapshot = this.core.snapshot();
    for (const [ws, seat] of this.sockets) {
      this.send(ws, { type: 'room', you: seat, snapshot });
    }
  }

  private async persist(): Promise<void> {
    await this.ctx.storage.put(STORAGE_KEY, this.core.toJSON());
  }
}

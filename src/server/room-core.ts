import { BoardConfig, createBoard } from '../core/board';
import { applyMove, createGame, GameState, seatOptsFromSeed } from '../core/game';
import { deserializeGame, SerializedGame, serializeGame } from '../core/serde';
import { ComType } from '../core/types';
import { RoomSnapshot, Seat, SeatState } from '../shared/protocol';

/**
 * ルームの純粋な状態・ロジック。Durable Object や WebSocket に依存しないため単体テスト可能。
 * 通信・永続化はラッパー側が担当する。
 */

export interface PersistedRoom {
  config: BoardConfig;
  com: [ComType, ComType, ComType];
  seats: [SeatState, SeatState, SeatState];
  game: SerializedGame | null;
  rematchVotes: Seat[];
  lastComment: { seat: Seat; text: string } | null;
  fixThirdSeat: boolean;
}

export type RoomResult = { ok: true } | { ok: false; error: string };

export class RoomCore {
  seats: [SeatState, SeatState, SeatState] = [
    { occupied: false, connected: false },
    { occupied: false, connected: false },
    { occupied: false, connected: false },
  ];
  game: GameState | null = null;
  rematchVotes = new Set<Seat>();
  lastComment: { seat: Seat; text: string } | null = null;

  constructor(
    public roomId: string,
    public config: BoardConfig,
    public com: [ComType, ComType, ComType] = ['none', 'none', 'none'],
    private random: () => number = Math.random,
    public fixThirdSeat = false,
  ) {}

  private newSeed(): number {
    return Math.floor(this.random() * 2 ** 31);
  }

  /** 席が埋まっているか(人間の参加 or COM の担当)。 */
  isFilled(seat: Seat): boolean {
    return this.seats[seat].occupied || this.com[seat] !== 'none';
  }

  /** 人間の席数(再戦に必要な票数)。 */
  humanSeatCount(): number {
    return this.com.filter((t) => t === 'none').length;
  }

  /** 席に参加。空きの人間席、または切断中の席なら再参加として受理。COM 席は不可。 */
  join(seat: Seat): RoomResult {
    if (this.com[seat] !== 'none') {
      return { ok: false, error: 'その席は COM が担当します' };
    }
    const s = this.seats[seat];
    if (s.occupied && s.connected) {
      return { ok: false, error: 'その席は既に使われています' };
    }
    s.occupied = true;
    s.connected = true;
    this.maybeStart();
    return { ok: true };
  }

  disconnect(seat: Seat): void {
    const s = this.seats[seat];
    if (s.occupied) s.connected = false;
  }

  private maybeStart(): void {
    if (this.game) return;
    if (( [0, 1, 2] as Seat[]).every((seat) => this.isFilled(seat))) {
      this.startGame(this.newSeed());
    }
  }

  /** 新しい対局を開始する(最初の開始・再戦共通)。 */
  startGame(seed: number): void {
    const board = createBoard({ ...this.config, seed });
    this.game = createGame(board, { ...seatOptsFromSeed(seed), fixThirdSeat: this.fixThirdSeat });
    this.rematchVotes.clear();
    this.lastComment = null;
  }

  /** 着手。手番・合法性は core のルールで検証する(サーバー権威)。 */
  move(seat: Seat, q: number, r: number): RoomResult {
    if (!this.game) return { ok: false, error: '対局がまだ開始されていません' };
    if (this.game.over) return { ok: false, error: '対局は終了しています' };
    if (this.game.current !== seat) return { ok: false, error: 'あなたの番ではありません' };
    try {
      this.game = applyMove(this.game, q, r);
    } catch {
      return { ok: false, error: 'その場所には置けません' };
    }
    return { ok: true };
  }

  /** COM の解説コメントを記録する。 */
  setComment(seat: Seat, text: string): void {
    this.lastComment = { seat, text: text.slice(0, 100) };
  }

  /** 再戦投票。人間席の全員が投票したら新対局開始(COM 席は自動的に賛成扱い)。 */
  voteRematch(seat: Seat): void {
    if (!this.game?.over) return;
    this.rematchVotes.add(seat);
    if (this.rematchVotes.size >= this.humanSeatCount()) {
      this.startGame(this.newSeed());
    }
  }

  snapshot(): RoomSnapshot {
    return {
      roomId: this.roomId,
      config: this.config,
      com: this.com,
      fixThirdSeat: this.fixThirdSeat,
      seats: this.seats.map((s) => ({ ...s })) as RoomSnapshot['seats'],
      game: this.game ? serializeGame(this.game) : null,
      rematchVotes: [...this.rematchVotes],
      lastComment: this.lastComment,
    };
  }

  toJSON(): PersistedRoom {
    return {
      config: this.config,
      com: this.com,
      seats: this.seats.map((s) => ({ ...s })) as PersistedRoom['seats'],
      game: this.game ? serializeGame(this.game) : null,
      rematchVotes: [...this.rematchVotes],
      lastComment: this.lastComment,
      fixThirdSeat: this.fixThirdSeat,
    };
  }

  static restore(roomId: string, saved: PersistedRoom, random?: () => number): RoomCore {
    const core = new RoomCore(roomId, saved.config, saved.com, random, saved.fixThirdSeat ?? false);
    core.seats = saved.seats.map((s) => ({ ...s })) as RoomCore['seats'];
    core.game = saved.game ? deserializeGame(saved.game) : null;
    core.rematchVotes = new Set(saved.rematchVotes);
    core.lastComment = saved.lastComment ?? null;
    return core;
  }
}

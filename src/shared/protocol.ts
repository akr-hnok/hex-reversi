import { BoardConfig } from '../core/board';
import { SerializedGame } from '../core/serde';
import { ComType } from '../core/types';

/** クライアント↔サーバー間の通信プロトコル。 */

export type Seat = 0 | 1 | 2;

export interface SeatState {
  occupied: boolean;
  connected: boolean;
}

export interface RoomSnapshot {
  roomId: string;
  config: BoardConfig;
  /** 各席の担当(人間/COM 種別)。 */
  com: [ComType, ComType, ComType];
  /** ハンデ: 席2を常に3番手に固定。 */
  fixThirdSeat: boolean;
  seats: [SeatState, SeatState, SeatState];
  game: SerializedGame | null;
  /** 再戦投票済みの席。 */
  rematchVotes: Seat[];
  /** COM(主に LLM)の最新コメント。 */
  lastComment: { seat: Seat; text: string } | null;
}

export type ClientMessage =
  | { type: 'join'; seat: Seat }
  | { type: 'move'; q: number; r: number }
  | { type: 'rematch' }
  | { type: 'ping' };

export type ServerMessage =
  | { type: 'room'; you: Seat; snapshot: RoomSnapshot }
  | { type: 'error'; message: string };

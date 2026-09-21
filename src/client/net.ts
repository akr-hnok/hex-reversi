import { BoardConfig } from '../core/board';
import { ClientMessage, RoomSnapshot, Seat, ServerMessage } from '../shared/protocol';
import { ComType } from '../core/types';

/** オンライン対戦の通信クライアント。 */

export interface OnlineCallbacks {
  onSnapshot(you: Seat, snapshot: RoomSnapshot): void;
  onError(message: string): void;
  /** 予期しない切断。 */
  onClose(): void;
}

export class OnlineSession {
  private ws: WebSocket | null = null;
  private pingTimer: number | null = null;

  constructor(
    private roomId: string,
    private seat: Seat,
    private cb: OnlineCallbacks,
  ) {}

  connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      const proto = location.protocol === 'https:' ? 'wss' : 'ws';
      const ws = new WebSocket(
        `${proto}://${location.host}/api/rooms/${this.roomId}/ws?seat=${this.seat}`,
      );
      ws.onopen = () => {
        this.ws = ws;
        // アイドル切断防止のハートビート(エッジの WS アイドルタイムアウト対策)
        this.pingTimer = window.setInterval(() => {
          try {
            ws.send(JSON.stringify({ type: 'ping' }));
          } catch {
            // 切断済み
          }
        }, 25_000);
        resolve();
      };
      ws.onerror = () => reject(new Error('接続に失敗しました'));
      ws.onclose = () => {
        if (this.pingTimer !== null) {
          window.clearInterval(this.pingTimer);
          this.pingTimer = null;
        }
        if (this.ws) {
          this.ws = null;
          this.cb.onClose();
        }
      };
      ws.onmessage = (event) => {
        let msg: ServerMessage;
        try {
          msg = JSON.parse(String(event.data)) as ServerMessage;
        } catch {
          return;
        }
        if (msg.type === 'room') {
          this.cb.onSnapshot(msg.you, msg.snapshot);
        } else {
          this.cb.onError(msg.message);
        }
      };
    });
  }

  send(msg: ClientMessage): void {
    this.ws?.send(JSON.stringify(msg));
  }

  move(q: number, r: number): void {
    this.send({ type: 'move', q, r });
  }

  voteRematch(): void {
    this.send({ type: 'rematch' });
  }

  close(): void {
    const ws = this.ws;
    this.ws = null; // onclose での通知を抑止
    ws?.close();
  }
}

export async function createRoomApi(
  config: BoardConfig,
  com: [ComType, ComType, ComType] = ['none', 'none', 'none'],
  fixThirdSeat = false,
): Promise<string> {
  const res = await fetch('/api/rooms', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ config, com, fixThirdSeat }),
  });
  if (!res.ok) throw new Error('ルームの作成に失敗しました');
  const data = (await res.json()) as { roomId: string };
  return data.roomId;
}

export async function fetchSnapshot(roomId: string): Promise<RoomSnapshot> {
  const res = await fetch(`/api/rooms/${roomId}`);
  if (!res.ok) throw new Error('ルームが見つかりません');
  return (await res.json()) as RoomSnapshot;
}

export interface ComAdviceResult {
  q: number;
  r: number;
  comment: string | null;
}

/** 対局中の人間プレイヤー向け AI 助言をサーバーに依頼する。 */
export async function requestComAdvice(game: unknown): Promise<ComAdviceResult> {
  const res = await fetch('/api/com/advice', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ game }),
  });
  if (!res.ok) throw new Error('AI 助言の取得に失敗しました');
  return (await res.json()) as ComAdviceResult;
}

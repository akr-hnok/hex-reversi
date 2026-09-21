/**
 * Cloudflare Workers ランタイムの最小限の型定義。
 * @cloudflare/workers-types を使わない構成(DOM lib との競合回避)。
 */

interface DurableObjectStorage {
  get<T>(key: string): Promise<T | undefined>;
  put(key: string, value: unknown): Promise<void>;
}

interface DurableObjectState {
  readonly storage: DurableObjectStorage;
  blockConcurrencyWhile(fn: () => Promise<void>): void;
}

interface DurableObjectId {
  toString(): string;
}

interface DurableObjectNamespace {
  idFromName(name: string): DurableObjectId;
  get(id: DurableObjectId): { fetch(request: Request): Promise<Response> };
}

interface AiRunResult {
  response?: string;
}

interface AiBinding {
  run(
    model: string,
    input: {
      messages: Array<{ role: 'system' | 'user'; content: string }>;
      max_tokens?: number;
    },
  ): Promise<AiRunResult>;
}

interface Env {
  ROOM: DurableObjectNamespace;
  ASSETS: { fetch(request: Request): Promise<Response> };
  AI: AiBinding;
  AI_MODEL?: string;
}

declare class WebSocketPair {
  0: WebSocket;
  1: WebSocket;
}

import type { Envelope } from '@porterkit/contracts';
import type { PorterStorage } from './types.js';

/** The other end of a WebSocket, driven by the test. Put it in place of the global `WebSocket`. */
export class FakeSocket {
  /** Every socket opened, oldest first. A test empties it before it starts. */
  static all: FakeSocket[] = [];
  static get last() {
    return FakeSocket.all.at(-1)!;
  }
  readyState = 1;
  /** What the client sent. */
  sent: Envelope[] = [];
  onmessage?: (event: { data: string }) => void;
  onclose?: () => void;
  onerror?: () => void;
  constructor(readonly url: string) {
    FakeSocket.all.push(this);
  }
  send(text: string) {
    this.sent.push(JSON.parse(text));
  }
  close() {
    this.readyState = 3;
  }
  /** The server sends a message. */
  emit(event: string, data?: unknown) {
    this.onmessage?.({ data: JSON.stringify(data === undefined ? { event } : { event, data }) });
  }
  /** The connection drops. */
  drop() {
    this.readyState = 3;
    this.onclose?.();
  }
}

/** A `storage` option that keeps what the client stores in `map`. */
export function memoryStorage(): PorterStorage & { map: Map<string, string> } {
  const map = new Map<string, string>();
  return {
    map,
    getItem: (key) => map.get(key) ?? null,
    setItem: (key, value) => void map.set(key, value),
    removeItem: (key) => void map.delete(key),
  };
}

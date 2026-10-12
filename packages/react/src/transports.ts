import type { CommandRejectReason, Envelope } from '@porterkit/contracts';
import type { CloseReason } from './types.js';

/** One open connection, whatever carries it. */
export interface Link {
  /** Hands the envelope to the transport. A message sent into a dying connection is lost. */
  send(envelope: Envelope): void;
  /** Closes it without reporting `down`. */
  close(): void;
}

export interface LinkEvents {
  message(envelope: Envelope): void;
  /** The connection is gone. With a reason, the server refused the Token and there is no retry. */
  down(final?: CloseReason): void;
}

export function openWs(wsUrl: string, token: string, on: LinkEvents): Link {
  let dead = false;
  const socket = new WebSocket(`${wsUrl}${wsUrl.includes('?') ? '&' : '?'}token=${encodeURIComponent(token)}`);
  socket.onmessage = (event) => {
    if (dead) return;
    let envelope: Envelope;
    try {
      envelope = JSON.parse(event.data);
    } catch {
      return;
    }
    on.message(envelope);
  };
  socket.onclose = socket.onerror = () => {
    if (dead) return;
    dead = true;
    on.down();
  };
  return {
    send: (envelope) => {
      if (socket.readyState === 1) socket.send(JSON.stringify(envelope));
    },
    close: () => {
      dead = true;
      socket.close();
    },
  };
}

/**
 * The envelopes in a chunk of an SSE stream. Only `data` means anything; comments, other fields and
 * the padding event, whose data starts with `:`, are dropped.
 */
function sseParser(onEnvelope: (envelope: Envelope) => void) {
  let buffer = '';
  return (chunk: string) => {
    const events = (buffer + chunk).split(/\r?\n\r?\n/);
    buffer = events.pop()!;
    for (const event of events) {
      const data = event
        .split(/\r?\n/)
        .filter((line) => line.startsWith('data:'))
        .map((line) => line.slice(5).replace(/^ /, ''))
        .join('\n');
      if (data === '' || data.startsWith(':')) continue;
      onEnvelope(JSON.parse(data));
    }
  };
}

export function openSse(httpUrl: string, token: string, on: LinkEvents): Link {
  let dead = false;
  const abort = new AbortController();
  const down = (final?: CloseReason) => {
    if (dead) return;
    dead = true;
    abort.abort();
    on.down(final);
  };

  const read = async () => {
    const response = await fetch(`${httpUrl}/porter/events?token=${encodeURIComponent(token)}`, {
      headers: { accept: 'text/event-stream' },
      signal: abort.signal,
    });
    if (!response.ok || !response.body) return down();
    const parse = sseParser((envelope) => {
      if (!dead) on.message(envelope);
    });
    const reader = response.body.pipeThrough(new TextDecoderStream()).getReader();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) return down();
      parse(value);
    }
  };
  read().catch(() => down());

  return {
    send: (envelope) => {
      const post = async () => {
        const response = await fetch(`${httpUrl}/porter/commands`, {
          method: 'POST',
          headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
          body: JSON.stringify(envelope),
        });
        if (response.status === 202) return;
        if (response.status !== 401) return down();
        const { reason } = (await response.json()) as { reason: Exclude<CommandRejectReason, 'notConnected'> };
        down(reason);
      };
      post().catch(() => down());
    },
    close: () => {
      dead = true;
      abort.abort();
    },
  };
}

import type { Envelope, GamesMap, Joined } from '@porterkit/contracts';
import { createStore } from './store.js';
import { type Link, openSse, openWs } from './transports.js';
import type {
  ClientGame,
  CloseReason,
  Connection,
  LoginResult,
  Porter,
  PorterOptions,
  PorterStorage,
} from './types.js';

export function defineGame<Games extends GamesMap, Name extends keyof Games & string>(
  definition: ClientGame<Games, Name>['definition'],
  appliers: ClientGame<Games, Name>['appliers'],
): ClientGame<Games, Name> {
  return { definition, appliers };
}

const KEY = 'porter';
const FINAL = { 'porter:kicked': 'kicked', 'porter:replaced': 'replaced' } as const;

export function createPorter<Games extends GamesMap, Profile = unknown>(
  options: PorterOptions<Games>,
): Porter<Games, Profile> {
  const httpUrl = options.httpUrl.replace(/\/$/, '');
  const maxRetries = options.maxRetries ?? 10;
  const games = options.games as Record<string, ClientGame<any, any> | undefined>;
  const store = createStore(games);
  const subscribers = new Set<() => void>();
  const listeners = new Map<string, Set<(data: any) => void>>();

  let connection: Connection = { status: 'idle' };
  let token: string | null = null;
  let link: Link | null = null;
  /** Failed connection attempts in a row. */
  let failures = 0;
  /** Waits before a retry since the last `porter:joined`. */
  let waits = 0;
  let pingInterval = 0;
  let retry: ReturnType<typeof setTimeout> | undefined;
  let silence: ReturnType<typeof setTimeout> | undefined;

  // ── Storage ─────────────────────────────────────────────────────────────

  const memory = new Map<string, string>();
  /** Resolved on first use: creating the instance reads nothing. */
  const storage = (): PorterStorage =>
    options.storage ??
    (globalThis as { sessionStorage?: PorterStorage }).sessionStorage ?? {
      getItem: (key) => memory.get(key) ?? null,
      setItem: (key, value) => void memory.set(key, value),
      removeItem: (key) => void memory.delete(key),
    };

  const forget = () => {
    token = null;
    storage().removeItem(KEY);
  };

  const game = (name?: string) => {
    const current = store.view();
    if (!current) throw new Error('Porter: there is no room yet');
    if (name !== undefined && current.game.name !== name) {
      throw new Error(`Porter: the active Game is "${current.game.name}", not "${name}"`);
    }
    return current.game;
  };

  // ── Subscribers ─────────────────────────────────────────────────────────

  const notify = () => {
    for (const onChange of subscribers) onChange();
  };

  const setConnection = (next: Connection) => {
    connection = next;
    notify();
  };

  // ── Connection ──────────────────────────────────────────────────────────

  const stop = () => {
    clearTimeout(retry);
    clearTimeout(silence);
    link?.close();
    link = null;
  };

  /** A close that is never retried. Only `unreachable` keeps the Token. */
  const close = (reason: CloseReason) => {
    stop();
    if (reason !== 'unreachable') forget();
    setConnection({ status: 'closed', reason });
  };

  /** A connection attempt failed, or the connection dropped. */
  const dropped = () => {
    const wasConnected = connection.status === 'connected';
    stop();
    if (!wasConnected && ++failures >= maxRetries) return close('unreachable');
    if (wasConnected) setConnection({ status: 'reconnecting' });
    retry = setTimeout(open, Math.min(2000, 500 * 1.3 ** waits++));
  };

  const hear = () => {
    clearTimeout(silence);
    if (pingInterval > 0) silence = setTimeout(dropped, 2 * pingInterval);
  };

  const receive = (envelope: Envelope) => {
    const { event, data } = envelope;
    hear();
    if (event === 'porter:ping') return link?.send({ event: 'porter:pong' });

    if (event === 'porter:joined') {
      failures = waits = 0;
      pingInterval = (data as Joined<GamesMap, unknown>).pingInterval;
      hear();
      store.receive(envelope);
      setConnection({ status: 'connected' });
    } else if (event === 'porter:rejected') {
      close((data as { reason: CloseReason }).reason);
    } else if (event in FINAL) {
      close(FINAL[event as keyof typeof FINAL]);
    } else if (store.receive(envelope)) {
      notify();
    }

    for (const listener of listeners.get(event) ?? []) {
      try {
        listener(data);
      } catch (error) {
        console.error(`Porter: a listener of "${event}" threw`, error);
      }
    }
  };

  function open() {
    const opening = token!;
    const transport =
      typeof options.transport === 'function' ? options.transport({ attempt: failures }) : (options.transport ?? 'ws');
    const mine: Link = (transport === 'sse' ? openSse : openWs)(
      transport === 'sse' ? httpUrl : options.wsUrl!,
      opening,
      {
        message: (envelope) => {
          if (link === mine) receive(envelope);
        },
        down: (final) => {
          if (link !== mine) return;
          if (final) close(final);
          else dropped();
        },
      },
    );
    link = mine;
  }

  /** Starts the retry loop from its first attempt. */
  const start = () => {
    stop();
    failures = waits = 0;
    pingInterval = 0;
    setConnection({ status: store.view() ? 'reconnecting' : 'connecting' });
    open();
  };

  const trying = () => ['connecting', 'connected', 'reconnecting'].includes(connection.status);

  // ── Public ──────────────────────────────────────────────────────────────

  const subscribe = (onChange: () => void) => {
    subscribers.add(onChange);
    return () => void subscribers.delete(onChange);
  };

  const on = (event: string, listener: (data: any) => void) => {
    if (!listeners.has(event)) listeners.set(event, new Set());
    listeners.get(event)!.add(listener);
    return () => void listeners.get(event)?.delete(listener);
  };

  const porter = {
    async login(request: object): Promise<LoginResult> {
      const response = await fetch(`${httpUrl}/porter/login`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(request),
      });
      const body = await response.json();
      if (!response.ok) {
        if (typeof body?.reason !== 'string') throw new Error(`Porter: the login answered ${response.status}`);
        return { ok: false, reason: body.reason };
      }
      stop();
      token = body.token;
      store.clear();
      storage().setItem(KEY, JSON.stringify({ token: body.token, roomId: body.roomId }));
      start();
      return { ok: true, roomId: body.roomId };
    },

    resume() {
      if (trying()) return true;
      const stored = storage().getItem(KEY);
      if (stored === null) return false;
      try {
        const parsed = JSON.parse(stored);
        if (typeof parsed.token !== 'string' || typeof parsed.roomId !== 'string') throw new Error('no Token');
        token = parsed.token;
      } catch {
        storage().removeItem(KEY);
        return false;
      }
      start();
      return true;
    },

    reconnect() {
      if (connection.status === 'closed' && connection.reason === 'unreachable') start();
    },

    leave() {
      stop();
      forget();
      store.clear();
      if (connection.status !== 'idle') setConnection({ status: 'closed', reason: 'left' });
    },

    async roomExists(roomId: string) {
      const response = await fetch(`${httpUrl}/porter/rooms/${encodeURIComponent(roomId)}`, { method: 'HEAD' });
      return response.status === 200;
    },

    send(event: string, data?: unknown) {
      if (connection.status !== 'connected' || !link) return false;
      link.send(data === undefined ? { event } : { event, data });
      return true;
    },

    on,
    subscribe,
    get connection() {
      return connection;
    },
    get room() {
      return store.view()?.room ?? null;
    },
    game,
    timer: store.timer,
  };
  return porter as unknown as Porter<Games, Profile>;
}

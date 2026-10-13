import type { Envelope, GamesMap, Joined, MatchStatus, PorterEvents, WireTimers, WireUser } from '@porterkit/contracts';
import { useEffect, useRef, useSyncExternalStore } from 'react';
import { type Link, openSse, openWs } from './transports.js';
import type {
  ClientGame,
  CloseReason,
  Connection,
  GameData,
  LoginResult,
  Porter,
  PorterOptions,
  PorterStorage,
  Timer,
  User,
} from './types.js';

export function defineGame<Games extends GamesMap, Name extends keyof Games & string>(
  definition: ClientGame<Games, Name>['definition'],
  appliers: ClientGame<Games, Name>['appliers'],
): ClientGame<Games, Name> {
  return { definition, appliers };
}

type AnyData = GameData<any, any>;

/** Everything `porter:joined` brings, kept as it arrived and never mutated. */
interface State {
  roomId: string;
  you: string;
  admin: string;
  locked: boolean;
  users: readonly WireUser<unknown>[];
  game: string;
  data: AnyData;
  match: MatchStatus;
  timers: Readonly<Record<string, Timer>>;
}

type Events = PorterEvents<GamesMap, unknown>;
/** Porter's events that leave the room's state as it is. `receive` deals with all but the last itself. */
type Stateless =
  | 'porter:ping'
  | 'porter:joined'
  | 'porter:rejected'
  | 'porter:replaced'
  | 'porter:kicked'
  | 'porter:messageRejected';
/** The envelopes of Porter's events that change the room's state. */
type RoomMessage = {
  [E in Exclude<keyof Events, Stateless>]: [Events[E]] extends [undefined]
    ? { event: E }
    : { event: E; data: Events[E] };
}[Exclude<keyof Events, Stateless>];

const KEY = 'porter';
const FINAL = { 'porter:kicked': 'kicked', 'porter:replaced': 'replaced' } as const;

/** What a factory of the Game definition returns, as the plain data the wire would carry. */
const plain = <T>(value: T): T => JSON.parse(JSON.stringify(value));

const running = (ms: number): Timer => {
  const endsAt = Date.now() + ms;
  return { paused: false, remaining: () => Math.max(0, endsAt - Date.now()) };
};
const frozen = (ms: number): Timer => ({ paused: true, remaining: () => ms });
const retime = (timers: State['timers'], make: (ms: number) => Timer) =>
  Object.fromEntries(Object.entries(timers).map(([name, timer]) => [name, make(timer.remaining())]));

export function createPorter<Games extends GamesMap, Profile = unknown>(
  options: PorterOptions<Games>,
): Porter<Games, Profile> {
  const httpUrl = options.httpUrl.replace(/\/$/, '');
  const maxRetries = options.maxRetries ?? 10;
  const games = options.games as Record<string, ClientGame<any, any> | undefined>;
  const subscribers = new Set<() => void>();
  const listeners = new Map<string, Set<(data: any) => void>>();

  let connection: Connection = { status: 'idle' };
  let token: string | null = null;
  let state: State | null = null;
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

  // ── Views ───────────────────────────────────────────────────────────────

  let viewsOf: State | null = null;
  let views: { room: any; game: any } | null = null;
  let userCache = new Map<string, User<unknown>>();
  let lastUsers: readonly User<unknown>[] = [];

  /** The room and the Game as the hooks give them, built once per state. */
  const view = () => {
    if (!state) return null;
    if (viewsOf === state) return views!;
    const { users: wire, data } = state;
    const cache = new Map<string, User<unknown>>();
    let users: readonly User<unknown>[] = wire.map((user) => {
      const before = userCache.get(user.name);
      const same =
        before &&
        before.profile === user.profile &&
        before.status === user.status &&
        before.data === data.userData[user.name];
      const next = same ? before : { ...user, data: data.userData[user.name] };
      cache.set(user.name, next);
      return next;
    });
    if (users.length === lastUsers.length && users.every((user, i) => user === lastUsers[i])) users = lastUsers;
    userCache = cache;
    lastUsers = users;
    const you = cache.get(state.you)!;
    const before = views?.room;
    const isAdmin = state.you === state.admin;
    const sameGame = before?.game.name === state.game && before.game.match === state.match;
    const sameRoom =
      sameGame &&
      before.id === state.roomId &&
      before.you === you &&
      before.admin === state.admin &&
      before.locked === state.locked &&
      before.users === users;
    viewsOf = state;
    views = {
      room: sameRoom
        ? before
        : {
            id: state.roomId,
            you,
            admin: state.admin,
            isAdmin,
            locked: state.locked,
            users,
            game: sameGame ? before.game : { name: state.game, match: state.match },
          },
      game: { ...data, name: state.game, match: state.match, you, users },
    };
    return views;
  };

  const game = (name?: string) => {
    const current = view();
    if (!current) throw new Error('Porter: there is no room yet');
    if (name !== undefined && current.game.name !== name) {
      throw new Error(`Porter: the active Game is "${current.game.name}", not "${name}"`);
    }
    return current.game;
  };

  // ── State ───────────────────────────────────────────────────────────────

  const notify = () => {
    for (const onChange of subscribers) onChange();
  };

  const setConnection = (next: Connection) => {
    connection = next;
    notify();
  };

  /** State and per-User data new from the Game definition. */
  const fresh = (s: State, name: string, settings: unknown): AnyData => {
    const definition = games[name]?.definition;
    return {
      settings: settings as object,
      state: plain(definition?.createState() ?? {}),
      userData: Object.fromEntries(s.users.map((user) => [user.name, plain(definition?.createUserData() ?? {})])),
    };
  };

  /** The state after one of Porter's messages. The same object when nothing changes. */
  const applyPorter = (s: State, message: RoomMessage): State => {
    switch (message.event) {
      case 'porter:userJoined': {
        const data = plain(games[s.game]?.definition.createUserData() ?? {});
        return {
          ...s,
          users: [...s.users, message.data.user],
          data: { ...s.data, userData: { ...s.data.userData, [message.data.user.name]: data } },
        };
      }
      case 'porter:userDisconnected':
      case 'porter:userReconnected': {
        const status = message.event === 'porter:userDisconnected' ? 'reconnecting' : 'connected';
        if (!s.users.some((user) => user.name === message.data.name && user.status !== status)) return s;
        return { ...s, users: s.users.map((user) => (user.name === message.data.name ? { ...user, status } : user)) };
      }
      case 'porter:userLeft': {
        const { [message.data.name as string]: _gone, ...userData } = s.data.userData;
        return {
          ...s,
          users: s.users.filter((user) => user.name !== message.data.name),
          data: { ...s.data, userData },
        };
      }
      case 'porter:adminChanged':
        return s.admin === message.data.admin ? s : { ...s, admin: message.data.admin };
      case 'porter:roomLocked':
        return s.locked === message.data.locked ? s : { ...s, locked: message.data.locked };
      case 'porter:settingsUpdated':
        return { ...s, data: { ...s.data, settings: message.data } };
      case 'porter:gameChanged':
        return {
          ...s,
          game: message.data.game,
          data: fresh(s, message.data.game, message.data.settings),
          match: { status: 'idle' },
          timers: {},
        };
      case 'porter:matchStarted':
        return { ...s, data: fresh(s, s.game, s.data.settings), match: { status: 'running' }, timers: {} };
      case 'porter:matchPaused':
        return { ...s, match: { status: 'paused', reason: message.data.reason }, timers: retime(s.timers, frozen) };
      case 'porter:matchContinued':
        return { ...s, match: { status: 'running' }, timers: retime(s.timers, running) };
      case 'porter:matchEnded':
        return { ...s, match: { status: 'ended', reason: message.data.reason }, timers: {} };
      case 'porter:timerSet': {
        const timer = s.match.status === 'paused' ? frozen(message.data.remaining) : running(message.data.remaining);
        return { ...s, timers: { ...s.timers, [message.data.name]: timer } };
      }
      case 'porter:timerCleared': {
        const { [message.data.name as string]: _gone, ...timers } = s.timers;
        return { ...s, timers };
      }
      default:
        // An event this client does not know, or a `Stateless` one, changes nothing.
        message satisfies never;
        return s;
    }
  };

  const joined = (d: Joined<GamesMap, unknown>): State => {
    const { timers = {}, ...match } = d.game.match as typeof d.game.match & { timers?: WireTimers };
    const make = match.status === 'paused' ? frozen : running;
    return {
      roomId: d.roomId,
      you: d.you,
      admin: d.admin,
      locked: d.locked,
      users: d.users,
      game: d.game.name,
      data: { settings: d.game.settings, state: d.game.state, userData: d.game.userData },
      match,
      timers: Object.fromEntries(Object.entries(timers).map(([n, ms]) => [n, make(ms)])),
    };
  };

  const applyGame = (s: State, event: string, data: unknown): State => {
    const applier = (games[s.game]?.appliers as Record<string, ((...args: any[]) => AnyData) | undefined>)?.[event];
    if (!applier) return s;
    try {
      const next = applier(s.data, data, { you: s.you, admin: s.admin, users: s.users });
      return next === s.data ? s : { ...s, data: next };
    } catch (error) {
      console.error(`Porter: the Applier of "${event}" in the Game "${s.game}" threw`, error);
      return s;
    }
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

  const receive = ({ event, data }: Envelope) => {
    hear();
    if (event === 'porter:ping') return link?.send({ event: 'porter:pong' });

    if (event === 'porter:joined') {
      failures = waits = 0;
      const room = data as Joined<GamesMap, unknown>;
      pingInterval = room.pingInterval;
      hear();
      state = joined(room);
      setConnection({ status: 'connected' });
    } else if (event === 'porter:rejected') {
      close((data as { reason: CloseReason }).reason);
    } else if (event in FINAL) {
      close(FINAL[event as keyof typeof FINAL]);
    } else if (state) {
      // The client takes the server's word for the shape of Porter's own events.
      const next = event.startsWith('porter:')
        ? applyPorter(state, { event, data } as RoomMessage)
        : applyGame(state, event, data);
      if (next !== state) {
        state = next;
        notify();
      }
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
    setConnection({ status: state ? 'reconnecting' : 'connecting' });
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

  const timer = (name: string) => state?.timers[name] ?? null;

  const useStore = <T>(read: () => T) => useSyncExternalStore(subscribe, read, read);

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
      state = null;
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
      state = null;
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
      return view()?.room ?? null;
    },
    game,
    timer,

    hooks: {
      useConnection: () => useStore(() => connection),
      useRoom() {
        const room = useStore(() => view()?.room ?? null);
        if (!room) throw new Error('Porter: useRoom() without a room; render it only while connected');
        return room;
      },
      useGame(name?: string) {
        useStore(() => view());
        return game(name);
      },
      useTimer: (name: string) => useStore(() => timer(name)),
      useEvent(event: string, listener: (data: any) => void) {
        const latest = useRef(listener);
        useEffect(() => {
          latest.current = listener;
        });
        useEffect(() => on(event, (data) => latest.current(data)), [event]);
      },
    },
  };
  return porter as unknown as Porter<Games, Profile>;
}

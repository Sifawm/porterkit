import type { Envelope, GamesMap, Joined, MatchStatus, PorterEvents, WireTimers, WireUser } from '@porterkit/contracts';
import type { ClientGame, GameData, Timer, User } from './types.js';

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
/** Porter's events that `applyPorter` has nothing to do for: `porter:joined` replaces the state, the others leave it as it is. */
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

/** What a factory of the Game definition returns, as the plain data the wire would carry. */
const plain = <T>(value: T): T => JSON.parse(JSON.stringify(value));

const running = (ms: number): Timer => {
  const endsAt = Date.now() + ms;
  return { paused: false, remaining: () => Math.max(0, endsAt - Date.now()) };
};
const frozen = (ms: number): Timer => ({ paused: true, remaining: () => ms });
const retime = (timers: State['timers'], make: (ms: number) => Timer) =>
  Object.fromEntries(Object.entries(timers).map(([name, timer]) => [name, make(timer.remaining())]));

/** The room's state on the client and the views the hooks read from it. Telling the subscribers is the caller's. */
export interface Store {
  /** Takes one envelope, `porter:joined` included. Whether the state changed. */
  receive(envelope: Envelope): boolean;
  /** There is no room any more. */
  clear(): void;
  /** `null` without a room. */
  view(): { room: any; game: any } | null;
  timer(name: string): Timer | null;
}

export function createStore(games: Record<string, ClientGame<any, any> | undefined>): Store {
  let state: State | null = null;

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

  return {
    receive({ event, data }) {
      let next = state;
      if (event === 'porter:joined') next = joined(data as Joined<GamesMap, unknown>);
      // The client takes the server's word for the shape of Porter's own events.
      else if (state) {
        next = event.startsWith('porter:')
          ? applyPorter(state, { event, data } as RoomMessage)
          : applyGame(state, event, data);
      }
      const changed = next !== state;
      state = next;
      return changed;
    },
    clear() {
      state = null;
    },
    view,
    timer: (name) => state?.timers[name] ?? null,
  };
}

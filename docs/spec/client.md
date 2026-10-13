# `@porterkit/client`

## Purpose

The client: it logs a User into a room, keeps its connection alive over WebSocket or SSE and holds the state of the room and of its active Game. It knows no framework: a Binding exposes it to one, as [react.md](react.md) does for React. The messages are in [protocol.md](protocol.md) and their types in [contracts.md](contracts.md); this file says what the client does with them and what an Integrator or a Binding writes against it.

- Dependency: `@porterkit/contracts`. No peer dependency.
- Two entry points: the package root, and `@porterkit/client/testing` with the fakes of "Testing".
- It runs wherever `WebSocket`, `fetch` and timers are global: a browser, and Node with nothing mounted.
- It uses no state library, no dependency injection, no router and no device detection.
- The root exports `createPorter`, `defineGame` and types.

The client keeps a Game's data as immutable plain data, never as instances of the Integrator's classes ([ADR 0005](../adr/0005-client-state-is-plain-data.md)).

## Public API

Everything exported is below. What does not appear is not public: the store, the transports, the SSE parser and the retry loop are internal.

### Defining a Game

```ts
import type { GameDefinition, GameName, GamesMap, UserStatus } from '@porterkit/contracts';

/** A Game's data on the client: plain JSON, typed from the games map, never mutated. */
export interface GameData<Games extends GamesMap, Name extends GameName<Games>> {
  readonly settings: Readonly<Games[Name]['settings']>;
  readonly state: Readonly<Games[Name]['state']>;
  /** By User name. */
  readonly userData: Readonly<Record<string, Readonly<Games[Name]['userData']>>>;
}

/** What an Applier may read of the room. */
export interface ApplierRoom {
  /** This User's name. */
  readonly you: string;
  /** The Admin's name. */
  readonly admin: string;
  readonly users: readonly { readonly name: string; readonly status: UserStatus }[];
}

/** Returns the next data of the Game. What it does not touch keeps its identity. */
export type Applier<Games extends GamesMap, Name extends GameName<Games>, Data> = (
  game: GameData<Games, Name>,
  data: Data,
  room: ApplierRoom,
) => GameData<Games, Name>;

/** One optional Applier per event of the Game's `server` map. */
export type Appliers<Games extends GamesMap, Name extends GameName<Games>> = {
  [E in keyof Games[Name]['server'] & string]?: Applier<Games, Name, Games[Name]['server'][E]>;
};

export interface ClientGame<Games extends GamesMap, Name extends GameName<Games>> {
  readonly definition: GameDefinition<Games, Name>;
  readonly appliers: Appliers<Games, Name>;
}

export declare function defineGame<Games extends GamesMap, Name extends GameName<Games>>(
  definition: GameDefinition<Games, Name>,
  appliers: Appliers<Games, Name>,
): ClientGame<Games, Name>;
```

### What the client holds

```ts
import type {
  ConnectRejectReason,
  GameName,
  GamesMap,
  LoginRejectReason,
  MatchStatus,
  PorterCommands,
  PorterEvents,
  WireUser,
} from '@porterkit/contracts';

export type Connection =
  | { status: 'idle' }          // no Token
  | { status: 'connecting' }    // first connection after a login or a resume
  | { status: 'connected' }     // `porter:joined` has arrived
  | { status: 'reconnecting' }  // the connection dropped and the client is retrying
  | { status: 'closed'; reason: CloseReason };

export type CloseReason = 'left' | 'kicked' | 'replaced' | 'unreachable' | ConnectRejectReason;

/** A User as the client gives it. `data` is its data in the active Game. */
export interface User<Profile, Data = unknown> extends Readonly<WireUser<Profile>> {
  readonly data: Data;
}

export interface RoomView<Games extends GamesMap, Profile> {
  readonly id: string;
  readonly you: User<Profile>;
  /** The Admin's name. */
  readonly admin: string;
  /** `you.name === admin`. */
  readonly isAdmin: boolean;
  readonly locked: boolean;
  readonly users: readonly User<Profile>[];
  readonly game: { readonly name: GameName<Games>; readonly match: MatchStatus };
}

export interface GameView<Games extends GamesMap, Name extends GameName<Games>, Profile>
  extends GameData<Games, Name> {
  readonly name: Name;
  readonly match: MatchStatus<Games[Name]['pauseReason'], Games[Name]['endReason']>;
  readonly you: User<Profile, Readonly<Games[Name]['userData']>>;
  readonly users: readonly User<Profile, Readonly<Games[Name]['userData']>>[];
}

/** Discriminated by `name`. */
export type AnyGameView<Games extends GamesMap, Profile> = {
  [Name in GameName<Games>]: GameView<Games, Name, Profile>;
}[GameName<Games>];

export interface Timer {
  readonly paused: boolean;
  /** Milliseconds left at the moment of the call. */
  remaining(): number;
}
```

### Messages

```ts
type Intersect<Union> = (Union extends unknown ? (member: Union) => void : never) extends (
  all: infer All,
) => void
  ? All
  : never;

type Args<Data> = [Data] extends [undefined] ? [] : [data: Data];

/** What a client sends: Porter's commands, without the pong, and every Game's `client` events. */
export type Outgoing<Games extends GamesMap> = Omit<PorterCommands<Games>, 'porter:pong'> &
  Intersect<Games[GameName<Games>]['client']>;

/** What a client listens to: Porter's events, without the ping, and every Game's `server` events. */
export type Incoming<Games extends GamesMap, Profile> = Omit<PorterEvents<Games, Profile>, 'porter:ping'> &
  Intersect<Games[GameName<Games>]['server']>;
```

### `createPorter`

```ts
export type Transport = 'ws' | 'sse';

export interface PorterStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

interface CommonOptions<Games extends GamesMap> {
  /** Base of the four HTTP routes, the Integrator's global prefix included: `/api` gives `/api/porter/login`. */
  httpUrl: string;
  games: { [Name in GameName<Games>]: ClientGame<Games, Name> };
  /** Failed connection attempts in a row before giving up. Default 10. */
  maxRetries?: number;
  /** Default `sessionStorage`. */
  storage?: PorterStorage;
}

export type PorterOptions<Games extends GamesMap> = CommonOptions<Games> &
  (
    | {
        /** Default `'ws'`. A function is called before every connection attempt. `attempt` counts from 0. */
        transport?: 'ws' | ((info: { attempt: number }) => Transport);
        /** The full WebSocket URL, path included: `wss://example.com/porter/ws`. */
        wsUrl: string;
      }
    | { transport: 'sse'; wsUrl?: string }
  );

export type LoginResult =
  | { ok: true; roomId: string }
  | { ok: false; reason: LoginRejectReason };

export interface Porter<Games extends GamesMap, Profile> {
  /** Without `roomId`, creates a room. An accepted login replaces whatever room was open. */
  login(request: { name: string; profile: Profile; roomId?: string }): Promise<LoginResult>;
  /** Connects with the stored Token. Returns whether there was one. Does nothing while a connection is open or opening. */
  resume(): boolean;
  /** Retries after `closed` with `unreachable`. Does nothing otherwise. */
  reconnect(): void;
  /** Closes the connection and forgets the Token. */
  leave(): void;
  roomExists(roomId: string): Promise<boolean>;

  /** Returns `false`, and sends nothing, unless `connected`. */
  send<E extends keyof Outgoing<Games> & string>(event: E, ...data: Args<Outgoing<Games>[E]>): boolean;
  /** Returns the function that removes the listener. */
  on<E extends keyof Incoming<Games, Profile> & string>(
    event: E,
    listener: (data: Incoming<Games, Profile>[E]) => void,
  ): () => void;
  /** Called after every change of the connection or of the state. Returns the function that unsubscribes. */
  subscribe(onChange: () => void): () => void;

  readonly connection: Connection;
  /** `null` before the first `porter:joined` and after `leave()`. */
  readonly room: RoomView<Games, Profile> | null;
  game(): AnyGameView<Games, Profile>;
  game<Name extends GameName<Games>>(name: Name): GameView<Games, Name, Profile>;
  timer(name: string): Timer | null;
}

export declare function createPorter<Games extends GamesMap, Profile = unknown>(
  options: PorterOptions<Games>,
): Porter<Games, Profile>;
```

## Behaviour

### Instance

- The Integrator calls `createPorter` once, in a module of its own, with its games map and its Profile type. Everything it returns is typed from them; the type parameters are written nowhere else.
- The instance is a module-level value. Nothing has to wrap the code that uses it.
- Creating the instance opens no connection, reads no storage and has no other effect.
- One instance is one room at a time, and one connection: a User has a single connection, and a second one replaces the first ([protocol.md](protocol.md#connection-lifecycle)). An application with several Bindings creates one instance and gives it to each of them ([ADR 0007](../adr/0007-a-binding-is-given-the-instance.md)).
- `wsUrl` is required unless `transport` is `'sse'`. It is not derived from `httpUrl`: the HTTP routes follow the Integrator's global prefix and the WebSocket path does not ([protocol.md](protocol.md#http-routes)).

### Login and Token

- `login` sends `POST /porter/login`. When the server accepts, the client stores the Token and the room id, starts connecting and resolves with `{ ok: true, roomId }`. It resolves when the HTTP response arrives, not when `porter:joined` does.
- When the server rejects, `login` resolves with `{ ok: false, reason }`, the `reason` of the body. It rejects its promise only when the request itself fails. A `500` with `{ reason: 'failed' }` is a rejection like the others: the server could not create the room, and trying again is up to the front.
- The client stores `{ token, roomId }` and nothing else, as `JSON.stringify` of that object under the key `porter`. The name and the Profile come back in `porter:joined`.
- The default storage is `sessionStorage`, which is per tab. The `storage` option replaces it. The key is fixed: an Integrator that needs another one passes a `storage` that maps it.
- A stored value that is not JSON, or that lacks `token` or `roomId`, is no Token: `resume()` removes it and returns `false`.
- The Token is opaque to the client: it reads neither the room nor the name from it.
- `resume()` returns `false` and does nothing when no Token is stored. Otherwise it starts connecting with it and returns `true`. It is what a page calls when it loads.
- None of `login`, `resume`, `reconnect` and `leave` throws for being called at the wrong moment, and each is harmless when repeated: see "Calls out of place".
- `roomExists(id)` sends `HEAD /porter/rooms/:id` and resolves `true` on `200` and `false` on `404`. It rejects only when the request itself fails.
- `leave()` closes the connection, forgets the Token and sets the connection to `closed` with `left`; from `idle` it only removes a stored Token and stays `idle`. It tells the server nothing: for the other Users this User is `reconnecting` until its Grace period runs out.
- A front may repeat the server's name rules to warn before the login. The server decides: `invalidName` and `invalidProfile` are handled all the same.

### Calls out of place

| Call | Connection | What it does |
|---|---|---|
| `resume()` | `connecting`, `connected` or `reconnecting` | nothing; returns `true` |
| `resume()` | `idle` or `closed` | reads the storage: with a Token it starts connecting and returns `true`, without one it returns `false`. After `unreachable` it is the same as `reconnect()` |
| `reconnect()` | anything but `closed` with `unreachable` | nothing |
| `login()` | any | sends the request and touches nothing until the answer |
| `leave()` | `idle` | removes the stored Token, if there is one; stays `idle` |
| `leave()` | `closed` | forgets the Token and the room; `closed` with `left` |

- A `login()` the server accepts while a room is open or opening closes the previous connection, replaces the Token and the state, and starts `connecting`. It leaves the previous room as `leave()` does: the server is told nothing, and there the User is `reconnecting` until its Grace period runs out.
- A `login()` that is rejected, or whose request fails, leaves the previous Token, connection and state as they were.
- Of two `login()` in flight, the last accepted one to resolve stays.
- `resume()` is safe to call twice in a row, as an effect does under React's StrictMode.

### Connection

| Status | Meaning |
|---|---|
| `idle` | no Token: nothing has logged in or resumed |
| `connecting` | the first connection after `login` or `resume` is being opened |
| `connected` | `porter:joined` has arrived |
| `reconnecting` | the connection dropped after `connected`, and the client is retrying |
| `closed` | the client has stopped; `reason` says why |

- `connected` begins with `porter:joined`, not when the socket or the stream opens.
- A connection attempt that fails, or a connection that drops, is retried by one loop, the same for both transports. The wait before a retry starts at 500 ms and is multiplied by 1.3 after each failed attempt, up to 2 s.
- After `maxRetries` failed attempts in a row the connection is `closed` with `unreachable`. A `porter:joined` sets the count back to zero.
- **Silent connection.** `porter:joined` carries the server's `pingInterval`. When two intervals pass without any message from the server, a ping or any other, the client takes the connection as dropped: it closes it and retries like any other drop. There is no option for it and no way to turn it off. It makes the status tell the truth; it does not keep the User's place, which depends on the server's Grace period ([protocol.md](protocol.md#ping)).
- `unreachable` is the only close that keeps the Token. `reconnect()` starts the loop again; if the Grace period has run out by then, the answer is `porter:rejected` with `notInRoom`.
- The other closes are final, forget the Token and are never retried ([protocol.md](protocol.md#connecting)):

  | Cause | `reason` |
  |---|---|
  | `porter:rejected` | the `reason` of the message: `invalidToken`, `roomNotFound` or `notInRoom` |
  | `porter:kicked` | `kicked` |
  | `porter:replaced` | `replaced` |
  | `leave()` | `left` |
  | `401` from `POST /porter/commands` | the `reason` of the body |

- The client answers every `porter:ping` with `porter:pong`. Neither is visible to the Integrator: `porter:ping` cannot be listened to and `porter:pong` cannot be sent.
- What to show while `connecting`, `reconnecting` or `closed` is the Integrator's, read from the status.

### Transport

- `transport` is `'ws'`, `'sse'` or a function called before every connection attempt, whose result is the transport of that attempt. The default is `'ws'`.
- `attempt` is the count of "Connection": the failed attempts in a row before this one. It is `0` on the first attempt after `login()`, `resume()` or `reconnect()` and on the first after a drop while `connected`, goes up by one with each failure and is back to `0` after `porter:joined`. `({ attempt }) => (attempt < 3 ? 'ws' : 'sse')` tries WebSocket three times and then SSE; after the next `porter:joined` it tries WebSocket again, and a function that wants to stay on SSE remembers it itself.
- The client has no policy of its own: it detects no device and falls back to nothing. A policy is the Integrator's function. A reconnection may use a different transport from the connection it replaces.
- **WebSocket.** The client opens `wsUrl` with the Token in the query parameter `token`.
- **SSE.** The client opens `GET /porter/events` under `httpUrl`, with the Token in the query parameter `token`, using `fetch` and its own parser of the stream. It does not use `EventSource`, so the same code runs in a browser and in Node without a polyfill, and the only retry is the client's own loop. The parser reads the `data` field of each event as one envelope, discards an event whose `data` starts with `:` ([protocol.md](protocol.md#transports)) and ignores comment lines and every other field (`event`, `id`, `retry`). It sends no `Last-Event-ID`. Each message the client sends is one `POST /porter/commands` with the Token as `Authorization: Bearer`. It posts them one at a time, each once the one before it has been answered, so they reach the server in the order they were sent.

### Sending

- `send(event, data)` is the only way to send. It is typed for Porter's commands and for the `client` events of every Game. There are no named methods.
- `send` does not queue. Unless the connection is `connected` it sends nothing and returns `false`.
- Sending changes no state. The client waits for the announcement, which also reaches whoever asked, or for `porter:messageRejected`.
- `true` means the message was handed to the transport, not that it arrived. A message sent just before a drop is lost in silence on both transports; the Integrator learns of the drop from the connection, and `porter:joined` then brings the whole state.
- **Over SSE**, a `POST /porter/commands` that answers anything but `202` or `401`, the `409` with `notConnected` included, or whose request fails, is a dropped connection: the client closes the stream, goes to `reconnecting` and retries. The message is lost and nothing announces it. This holds for the `porter:pong` too.

### Receiving

The client handles each incoming message in three steps, in this order:

1. **Apply.** A `porter:` message is applied by the client itself. Any other message goes to the Applier the active Game has for that event, if it has one.
2. **Notify.** If the first step changed anything, subscribers are notified.
3. **Listen.** The listeners of that event are called. They see the state already updated.

- A Game event without an Applier is valid: it reaches the listeners.
- `porter:ping` is answered and goes through none of the three steps.
- A message that changes nothing notifies nobody. `porter:messageRejected` changes nothing and reaches listeners only.
- **An Applier that throws** is caught. The state stays as it was before the message, nobody is notified, the listeners of the event are called all the same, and the error goes to `console.error` with the Game and the event. The connection stays `connected` and the client does not reconnect to catch up: that Game's state may lag behind the server until the next `porter:joined` or Match start.
- **A listener that throws** is caught and goes to `console.error`; the other listeners of the event are called.
- There is no `onError` option.

### State

- The state is plain immutable data: the JSON of the wire. Every change produces new objects for what changed and keeps the identity of what did not, so comparing two pieces by identity tells whether anything in them changed.
- A `User` keeps its identity for as long as neither its wire fields nor its `data` change.
- Notification is coarse: `subscribe` tells that something changed after every message that changed anything, and not what. There are no selectors.
- The state of a Game changes only in an Applier and in the steps below. Whoever reads it never changes it.

What the client does with each of Porter's messages:

| Message | State after it |
|---|---|
| `porter:joined` | the whole room, Game and Match are replaced by the message, on the first connection and on every reconnection |
| `porter:userJoined` | the User is added, with per-User data new from the Game definition |
| `porter:userDisconnected`, `porter:userReconnected` | that User's `status` |
| `porter:userLeft` | the User is removed from `users`, and its per-User data with it, whatever the Match's situation |
| `porter:adminChanged` | `admin`, each time it arrives; the Admin is not assumed stable |
| `porter:roomLocked` | `locked` |
| `porter:settingsUpdated` | the settings are replaced by the message |
| `porter:gameChanged` | the active Game is the one named; settings from the message; state and per-User data new from that Game's definition; Match `idle`; no timers |
| `porter:matchStarted` | state and per-User data new from the Game definition; settings kept; Match `running`; no timers |
| `porter:matchPaused` | Match `paused` with its reason; timers frozen |
| `porter:matchContinued` | Match `running`; timers resume with what each had left |
| `porter:matchEnded` | Match `ended` with its reason; no timers |
| `porter:timerSet`, `porter:timerCleared` | that timer is set or removed |

- **New from the Game definition** means the result of the definition's factory after a JSON round trip. The client holds no instance of the Integrator's classes, also when the factory returns one ([contracts.md](contracts.md#behaviour)).
- The room survives a close: after `closed`, its last state stays readable until `leave()` or the next `login()`.

### Appliers

- `defineGame` takes the shared Game definition whole and the Game's Appliers, keyed by event name of the Game's `server` map. It adds nothing else and has no effect.
- An Applier runs for a message of its Game while that Game is the active one.
- It receives the Game's data, the message's data and a read-only view of the room, and returns the next data without mutating what it received.
- An Applier that returns the object it received has changed nothing: nobody is notified.
- Porter does not depend on immer. An Integrator may wrap its Appliers with it.

### Reading

- `connection` is the connection.
- `room` is the room. `isAdmin` is the only value Porter derives. It is `null` before the first `porter:joined` and after `leave()`.
- `game(name)` returns the Game's data, its Match and the Users joined with their per-User data as `user.data`, the name it has on the server. It throws if the active Game is another one. `game()` without a name returns the same for whichever Game is active, discriminated by `name`. Both throw where `room` is `null`.
- `you` is a `User` in both. `admin` is a name.
- `room`, and each User in it, keep their identity while nothing in them changes. What `game()` returns is new after every change of the state.
- `subscribe(onChange)` is how a reader learns that any of them changed. Any number of subscribers and listeners may be registered at once.
- `on(event, listener)` is for effects only: navigating, opening a modal, showing a toast.

### Match timers

- `timer(name)` returns `null` when the active Match has no timer of that name.
- `remaining()` returns the milliseconds left at the moment of the call, never below zero, worked out from the client's clock and the remaining time received ([protocol.md](protocol.md#match-timers)). While the Match is `paused` it returns the same value on every call and `paused` is `true`.
- The tick is the caller's: it calls `remaining()` on its own interval. A countdown does not go through the store and notifies nobody.
- Timer names are plain strings, not typed from the games map.

### What stays with the Integrator

- **Drafts.** What a User is editing before sending (settings being changed, an answer being typed) is the front's own state, not the Game's state.
- **Effects.** Navigation, modals and toasts go in a listener. A handler that both changes state and navigates is split into an Applier and a listener.
- **What has to outlive a reconnection** is in the Game's state. What a front keeps from a listener in its own state is lost on reconnecting, because `porter:joined` replaces everything and replays nothing.
- **Guards.** "Connected" is `connection.status === 'connected'`; "the room exists" is `porter.roomExists(id)`.
- **Rejections.** `porter:messageRejected` is shown by whoever sent the message, from a listener; a `porter:startMatch` the Game vetoes arrives there with `{ code: 'game', reason }`.

## Testing

`@porterkit/client/testing` is for the tests of a Binding or of an Integrator's front: they run the real client and stand in for the server.

```ts
import type { Envelope } from '@porterkit/contracts';
import type { PorterStorage } from '@porterkit/client';

/** The other end of a WebSocket, driven by the test. */
export declare class FakeSocket {
  /** Every socket opened, oldest first. */
  static all: FakeSocket[];
  static readonly last: FakeSocket;
  readonly url: string;
  /** What the client sent. */
  sent: Envelope[];
  constructor(url: string);
  /** The server sends a message. */
  emit(event: string, data?: unknown): void;
  /** The connection drops. */
  drop(): void;
}

/** A `storage` option that keeps what the client stores in `map`. */
export declare function memoryStorage(): PorterStorage & { map: Map<string, string> };
```

- The entry imports no test runner. The test puts `FakeSocket` in place of the global `WebSocket` with whatever its runner offers, and empties `FakeSocket.all` before each test.
- Besides what is declared above, `FakeSocket` has the members of a `WebSocket` that the client itself uses.
- `FakeSocket` is the WebSocket transport only. There is no fake of the SSE stream and none of `fetch`.
- A test that needs no login stores a Token in a `memoryStorage()` under the key `porter` and calls `resume()`; the client then opens a `FakeSocket`, and `emit('porter:joined', …)` makes it `connected`.
- Nothing else of the client's own tests is public: their Games and their fixtures are not exported.

## Usage

The client half of the example Game in [contracts.md](contracts.md#usage).

```ts
// misfit.client.ts
import { defineGame } from '@porterkit/client';
import { type Games, misfit } from './misfit.game';

export const misfitClient = defineGame<Games, 'misfit'>(misfit, {
  turnChanged: (game, name) => ({ ...game, state: { ...game.state, turn: name } }),

  cardDealt: (game, { card }) => ({
    ...game,
    state: { ...game.state, card },
    userData: Object.fromEntries(
      Object.entries(game.userData).map(([name, data]) => [name, { ...data, answer: '', status: 'idle' }]),
    ),
  }),
  // roundEnded, preStarted: no Applier. The state has nowhere to keep them,
  // so the front listens with `on`.
});
```

The Integrator's instance, written once:

```ts
// porter.ts
import { createPorter } from '@porterkit/client';
import type { Games } from './misfit.game';
import { misfitClient } from './misfit.client';

export interface Profile {
  avatar: string;
}

export const porter = createPorter<Games, Profile>({
  httpUrl: '/api',
  wsUrl: 'wss://example.com/porter/ws',
  games: { misfit: misfitClient },
});
```

Logging in, and coming back after a reload:

```ts
if (!porter.resume()) {
  const result = await porter.login({ name: 'Ana', profile: { avatar: 'fox' } });
  if (!result.ok) showLoginError(result.reason);
}
```

Reading and listening, with no framework:

```ts
porter.subscribe(() => {
  if (porter.connection.status !== 'connected') return showConnection(porter.connection);
  const { state, you, users, match } = porter.game('misfit');
  // ...
});
porter.on('roundEnded', (answers) => showAnswers(answers));
porter.on('porter:messageRejected', ({ reason }) => showRejection(reason));

const answer = (text: string) => porter.send('answer', { answer: text });
```

## Verify during construction

- **Several Games.** That `send` and `on` type correctly with a games map of two Games whose events differ, and that an event name two Games share with different data is an error at the call, not `any`. If it is not, `Outgoing` and `Incoming` are rewritten here.
- **SSE over `fetch`.** That a streaming `fetch` with the client's parser reads the stream in the supported browsers and in Node 22, and reports a dropped connection promptly. If it does not, the SSE transport takes an `EventSource` constructor, closes it on the first error to cancel its native retry, and "Transport" changes to say so.
- **`sessionStorage` absent.** That creating the instance in Node without a `storage` option does not throw, since creation reads no storage. If it does, the default is resolved on first use.

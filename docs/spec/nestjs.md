# `@porterkit/nestjs`

## Purpose

The server: a NestJS module that holds the rooms in memory, logs Users into them, keeps their connections alive over WebSocket and SSE, runs the Match lifecycle and delivers each Game's messages to its Manager. The messages themselves are in [protocol.md](protocol.md) and their types in [contracts.md](contracts.md); this file says what the server does behind them and what an Integrator writes against it.

- Dependency: `@porterkit/contracts`, imported with `import type` only.
- Peer dependencies: `@nestjs/common`, `@nestjs/core`, `@nestjs/websockets`, `rxjs`, `reflect-metadata`.
- The Integrator's application also installs `@nestjs/platform-ws` and `ws`.
- It does not use `@nestjs/jwt`, `@nestjs/config`, `@nestjs/schedule`, `class-validator` or `class-transformer`.
- It uses only NestJS's own API, so it runs on Express and on Fastify alike: no `@Res()`, no `req.raw`, no Express or Fastify types.

Rooms live in the memory of one process. Porter knows a Game as a contract and never its rules ([ADR 0002](../adr/0002-porter-knows-games.md)).

## Public API

Everything exported is below. What does not appear is not public: rooms, Users, Matches, the Token service, the timer service, the gateway and the controllers are internal, and a Manager sees them only through its context.

### Module

```ts
import type { DynamicModule } from '@nestjs/common';
import type { ConfigurableModuleAsyncOptions } from '@nestjs/common';
import type { GameName, GamesMap } from '@porterkit/contracts';

export interface PorterModuleOptions<Games extends GamesMap> {
  /** The Game every new room starts with. */
  initialGame: GameName<Games>;
  /** Users per room. Default 16. */
  capacity?: number;
  /** UTF-16 code units, what `String.prototype.length` counts. Default 20. */
  maxNameLength?: number;
  /** UTF-8 bytes of `JSON.stringify(profile)`. Default 2048. */
  maxProfileSize?: number;
  /** Runs after the size check. `false` refuses the login with `invalidProfile`. */
  validateProfile?: (profile: unknown) => boolean;
  /** Milliseconds. Default 30000. */
  pingInterval?: number;
  /** Milliseconds. Default 20000. */
  gracePeriod?: number;
}

export declare class PorterModule {
  static forRoot<Games extends GamesMap>(options: PorterModuleOptions<Games>): DynamicModule;
  static forRootAsync<Games extends GamesMap>(
    options: ConfigurableModuleAsyncOptions<PorterModuleOptions<Games>>,
  ): DynamicModule;
}
```

### Manager

```ts
import type { EndReason, GameDefinition, GameName, GamesMap } from '@porterkit/contracts';

type AnyDefinition = GameDefinition<any, string>;

type Args<Data> = [Data] extends [undefined] ? [] : [data: Data];
type Send<Server> = <E extends keyof Server & string>(event: E, ...data: Args<Server[E]>) => void;

export interface User<Data, Server> {
  readonly name: string;
  readonly status: 'connected' | 'reconnecting';
  /** This User's data in the Game, created anew at every Match start. */
  readonly data: Data;
  send: Send<Server>;
}

export interface Room<Data, Server> {
  readonly id: string;
  /** The Admin's name. */
  readonly admin: string;
  /** `connected` and `reconnecting`, in the order they joined. */
  readonly users: User<Data, Server>[];
  readonly connected: User<Data, Server>[];
  user(name: string): User<Data, Server> | undefined;
  /** To every `connected` User. */
  broadcast: Send<Server>;
}

export interface Timers {
  set(name: string, ms: number, callback: () => void | Promise<void>): void;
  clear(name: string): void;
}

export type UserOf<Games extends GamesMap, Definition extends AnyDefinition> = User<
  ReturnType<Definition['createUserData']>,
  Games[Definition['name']]['server']
>;

export declare class GameRejection extends Error {
  readonly reason: string;
}

/** Everything a Manager can do in one room. */
export interface GameContext<
  Games extends GamesMap,
  Definition extends AnyDefinition,
  Memory = undefined,
> {
  readonly room: Room<ReturnType<Definition['createUserData']>, Games[Definition['name']]['server']>;
  readonly game: {
    readonly settings: ReturnType<Definition['createSettings']>;
    /** Replaced at every Match start. */
    readonly state: ReturnType<Definition['createState']>;
  };
  /** The Match memory. */
  readonly memory: Memory;
  readonly timers: Timers;
  /** `throw ctx.reject(reason)`. */
  reject(reason: Games[Definition['name']]['rejectReason']): GameRejection;
  endMatch(reason: Games[Definition['name']]['endReason']): void;
}

type AnyContext = GameContext<any, any, any>;
type SettingsOf<Ctx extends AnyContext> = Parameters<Ctx['game']['settings']['set']>[0];
type UserIn<Ctx extends AnyContext> = Ctx['room']['users'][number];

/** The interface every Manager implements. */
export interface GameManager<Ctx extends AnyContext> {
  defaultSettings(): SettingsOf<Ctx> | Promise<SettingsOf<Ctx>>;
  updateSettings(ctx: Ctx, next: unknown): void;
}

/** Optional pieces, one interface each, named after its method. */
export interface CreateMemory<Ctx extends AnyContext> {
  createMemory(): Ctx['memory'];
}
export interface CanStart<Ctx extends AnyContext> {
  canStart(ctx: Ctx): void;
}
export interface OnStart<Ctx extends AnyContext> {
  onStart(ctx: Ctx): void | Promise<void>;
}
export interface OnPause<Ctx extends AnyContext, Reason = unknown> {
  onPause(ctx: Ctx, reason: Reason): void;
}
export interface OnContinue<Ctx extends AnyContext> {
  onContinue(ctx: Ctx): void;
}
export interface OnEnd<Ctx extends AnyContext> {
  onEnd(ctx: Ctx, reason: EndReason<Parameters<Ctx['endMatch']>[0]>): void;
}
export interface OnUserDisconnected<Ctx extends AnyContext> {
  onUserDisconnected(ctx: Ctx, user: UserIn<Ctx>): void;
}
export interface OnUserLeft<Ctx extends AnyContext> {
  onUserLeft(ctx: Ctx, user: UserIn<Ctx>): void;
}
```

### Decorators

```ts
/** Marks a class as the Manager of that Game definition. Also applies `@Injectable()`. */
export declare function GameManager(definition: AnyDefinition): ClassDecorator;

/** The typed message decorator of one Game: `const On = handlersOf<Games, 'misfit'>()`. */
export declare function handlersOf<Games extends GamesMap, Name extends GameName<Games>>(): <
  E extends keyof Games[Name]['client'] & string,
>(
  event: E,
  ...guard: [Games[Name]['client'][E]] extends [undefined]
    ? []
    : [accepts: (data: unknown) => data is Games[Name]['client'][E]]
) => (
  target: object,
  method: string,
  descriptor: {
    value?: (ctx: any, data: Games[Name]['client'][E], user: User<any, any>) => unknown;
  },
) => void;

/** The message is for the Admin only. */
export declare function AdminOnly(): MethodDecorator;

/** The message is delivered with or without a Match under way. */
export declare function AnyTime(): MethodDecorator;
```

## Behaviour

### Module

- There is one module, `PorterModule`. It exports no provider: an Integrator's modules inject nothing of Porter's and do not import it.
- `forRoot` and `forRootAsync` take the same options. The options are global: none is per room or per Game.
- Porter checks its configuration once, in `onApplicationBootstrap`, in the same place for `forRoot` and `forRootAsync`. When a check fails the application does not start. The checks run in this order: the options, then duplicate Managers (see "Registering a Game"), then `initialGame`.
- **Options.** An option that is `undefined` is not given and takes its default. Any other value must be valid, `null` included; Porter does not correct it, clamp it or fall back to the default. The error names the option and the value received.

  | Option | Valid |
  |---|---|
  | `capacity`, `maxNameLength` | an integer, at least 1 |
  | `maxProfileSize` | an integer, at least 4, so that the `null` of an absent Profile always fits |
  | `pingInterval`, `gracePeriod` | a finite number greater than zero; it need not be an integer |
  | `validateProfile` | a function |

  There are no maximums and no rule between options: a `gracePeriod` shorter than `pingInterval` is accepted.
- **`initialGame`** is checked once every Manager has been discovered. If it names no registered Game, the application does not start. An application with no Manager at all fails this check; its error says that no Manager is registered, which is a different message from the one for a name that matches none.
- Games are not an option of the module. See "Registering a Game".
- The routes are fixed and there is no option to change them. The four HTTP routes follow the Integrator's global prefix or `RouterModule`; the gateway's path `/porter/ws` is absolute.
- The gateway declares no port: it shares the HTTP server of the application.
- Neither transport can be switched off.

In its `main.ts` the Integrator calls `app.useWebSocketAdapter(new WsAdapter(app))` before the application starts, and decides CORS, the global prefix, the platform and `listen`. Porter does none of these.

### Rooms

- A login without `roomId` creates a room. Porter generates its id: 10 characters from `a-z` and `0-9`, each drawn with `crypto.randomInt`, generated again if a room already has it. The Integrator neither supplies the id nor vetoes the creation, and its length and alphabet are not options.
- A room is found by its exact id. Porter does not fold case.
- A new room has the Game named by `initialGame` as its active Game, with that Game's default settings, new state, and its Match `idle`.
- Porter waits for the Game's `defaultSettings()` before it creates anything. If it throws or its promise rejects, there is no room and no User: the login answers `500` with `{ reason: 'failed' }` and the error is logged.
- A room ceases to exist only when its last User leaves it. It does not expire from inactivity and nobody can close it.
- The Integrator cannot replace or extend the room or the User. Its own data goes in the Profile and in a Game's per-User data.

### Login

The route, its body and its rejections are in [protocol.md](protocol.md#post-porterlogin).

- **Name.** Porter trims the whitespace at both ends. What remains is not empty and is at most `maxNameLength` long, measured in UTF-16 code units, the `length` of the string and what `maxlength` counts on an HTML input; otherwise `invalidName`. The name is stored and shown as written; Porter does not normalize it. Two names that differ only in case are the same name: "Ana" and "ana" do not share a room.
- **Body.** A body that is not a JSON object is `invalidName`. The checks run in this order and the first to fail answers: name, Profile, room, lock, capacity, name taken. `failed` comes after them all and only on a login that creates a room (see "Rooms").
- **Room.** Only an absent `roomId` creates a room. A `roomId` that is present and is not a string of the form above is `roomNotFound`, without looking for a room.
- **Profile.** An absent `profile` is stored as `null`, so every User has a Profile on the wire. `validateProfile` receives that `null` like any other value; an Integrator whose Profile type does not admit `null` refuses it there. Porter stores it and sends it to every User without reading it. Its serialization, `JSON.stringify(profile)` encoded as UTF-8, is at most `maxProfileSize` bytes: Porter measures what it will store, not the body as it arrived. The `null` of an absent Profile is 4 bytes. The limit on the size of the request body is the Integrator's and applies before Porter sees anything. Then `validateProfile`, when given, returns `true`; otherwise `invalidProfile`. The validator's refusal carries no reason of its own.
- **Capacity.** A room holds at most `capacity` Users, counting `pending`, `connected` and `reconnecting`.
- **Lock.** A locked room refuses new logins and nothing else. A `pending` User keeps its place and may connect; a `reconnecting` User may come back.
- A User that logs in is `pending` and its Grace period starts.

### Token

- A Token is the room id, a `.` and 32 random bytes from `crypto.randomBytes` encoded as base64url without padding: 54 characters matching `^[a-z0-9]{10}\.[A-Za-z0-9_-]{43}$`. The random part is stored on its User ([ADR 0004](../adr/0004-opaque-room-token.md)).
- There is no secret and no expiry. Porter verifies a Token by finding its User in its room.
- The random part is compared with `crypto.timingSafeEqual`.
- A Token that does not have that form is `invalidToken`, without looking for a room; one whose room does not exist, `roomNotFound`; one whose room has no User holding it, `notInRoom`.

### Connections

The states, the transitions and what each sends are in [protocol.md](protocol.md#connection-lifecycle). On the server:

- `pingInterval` is the time between two `porter:ping` on a connection. A dead connection is closed between one and two intervals after it died. Its value travels in every `porter:joined`, so a client can tell a silent connection ([protocol.md](protocol.md#ping)).
- `gracePeriod` is the length of the Grace period. Every User without an open connection has one running. When it runs out the User leaves the room.
- A `pending` User whose Grace period runs out is removed without any message: nobody ever saw it.
- A second connection of a `connected` User replaces the first. The User never stops being `connected`; neither the other Users nor the Game are told.
- Pings and Grace periods use native timers, kept with each User's Presence and cleared when the User leaves the room and when the room or the module is destroyed.

**Transport adapters.** The gateway and the SSE controller contain no room logic. Each is an adapter over one internal function:

```ts
// what an adapter gives Porter
interface Sink {
  send(message: { event: string; data?: unknown }): void;
  close(): void;
}

// what Porter gives an adapter
declare function connect(token: string, sink: Sink): Connection;

interface Connection {
  receive(raw: unknown): void; // one incoming envelope, not yet validated
  closed(): void;              // the transport reports that it dropped
}
```

- An adapter only translates: it takes the Token from the request, serializes what it receives through `send`, and calls `closed`. It knows nothing of rooms, Users, states or timers.
- Everything else is behind `connect`: verifying the Token, `porter:joined` or `porter:rejected`, replacing a connection, the ping, the Grace period, the announcements and the notices to the Game. A rejection is a `send` followed by a `close` on the same `Sink`.
- `POST /porter/commands` is the incoming half of the SSE adapter: it finds the `Connection` by the Token and calls `receive`.
- These interfaces mention neither NestJS, `ws` nor RxJS.
- The SSE controller cleans up in the `finalize` of the Observable it returns.

### Admin

- The first User of a room is its Admin from the moment it logs in.
- **Succession.** As soon as the Admin's connection drops, without waiting for the Grace period, the Admin becomes the first `connected` User in the order they joined the room.
- If no User is `connected`, the Admin stays the Admin. If a User then connects while it is still away, the Admin becomes that User.
- An Admin that is still `pending` is treated as one whose connection dropped: if another User connects before it does, that User becomes the Admin.
- **Recovery.** Porter keeps, per room, the line of Users that have been Admin, in order. A User that comes back within its Grace period becomes the Admin again if it is earlier in the line than the current Admin, and those behind it leave the line.
  - A drops and B becomes Admin; B drops and C becomes Admin. If B comes back, B is the Admin; if A then comes back, A is. If A comes back first, A is the Admin and B does not recover it on coming back.
- A User that leaves the room leaves the line. Whoever logs in later with the same name is a new User.
- **The Admin leaves with nobody `connected`.** When the Admin leaves the room and no User is `connected`, the Admin becomes the first User left in the order they joined, the `reconnecting` ones ahead of the `pending` ones. That User is away, so the rules above apply to it: the first User to connect while it is still away becomes the Admin, and if it is the one that connects, it stays the Admin. It joins the line like any Admin; if it was already in the line, those behind it leave the line.
  - A, B and C join and C is still `pending`. A is the Admin; A and B drop. A's Grace period runs out: the Admin is B, not C. If C connects before B comes back, C is the Admin; if B then comes back within its Grace period, B is the Admin again.
- Every change is announced to everyone with `porter:adminChanged`, also when nobody is `connected` to receive it. A User that comes back reads the Admin in `porter:joined`.
- Only Porter changes the Admin. A Manager cannot.

### Permissions

- Every one of Porter's client messages except `porter:pong` is for the Admin only. From anyone else it gets `notAdmin`.
- A `porter:` event that is not one of Porter's gets `unhandled` from anyone and is never offered to a Manager.
- The checks on any message run in the order of [protocol.md](protocol.md#rejected-messages): the sender before the `data`, the `data` before the situation.
- A Game message is for the Admin only when its handler carries `@AdminOnly()`. Porter checks it and answers `notAdmin` without calling the Manager.

### Removing a User

What each party receives is in [protocol.md](protocol.md#removing-a-user).

- Removing a `reconnecting` User cancels its Grace period and it leaves at once.
- In every case the User leaves the room exactly as when a Grace period runs out: the minimum is checked and the Game is told (see "Users and the Match").

### Registering a Game

- A Game is registered by putting `@GameManager(definition)` on its Manager and listing that class in the `providers` of any module of the application. Porter finds it with `DiscoveryService`.
- A Manager is a NestJS singleton, one per Game for the whole application, with ordinary constructor injection.
- Two Managers for the same Game stop the application from starting, with an error that names the Game and both classes. The same Game means the same `name` in the Game definition, even when the two definitions are different objects.
- A class that carries `@GameManager` and is in the `providers` of no module is invisible to Porter. Nothing is promised about it.
- A Manager keeps nothing about any room. Everything of a room reaches it through the context.
- The methods of a Manager do not run inside NestJS's execution context. `@UseGuards`, `@UsePipes`, `@UseInterceptors` and `@UseFilters` have no effect on them, and there are no DTOs with `ValidationPipe`. The guard of `On` and `@AdminOnly()` take their place.
- The decorators are legacy decorators (`experimentalDecorators`), as NestJS's are.

### Context

Every hook and every handler receives the context as its first argument.

- There is one context per room for as long as that Game is the room's active Game, and it is the same object on every call. A Match timer callback may capture it.
- `room.users` are the `connected` and `reconnecting` Users in the order they joined; `room.connected`, the `connected` ones in the same order. `pending` Users appear in neither.
- `room.broadcast(event, data)` sends to every `connected` User and takes no filter. A subset is reached with `user.send(event, data)` on each.
- `user.send` to a User that is `reconnecting`, or to one that has already left the room, does nothing: it does not throw, queue or log. A message is a notice, not a store. What a User must see when it comes back goes in `game.state` or in its `user.data`, which travel in `porter:joined`.
- A Manager does not see a User's Profile. The User of the context has `name`, `status`, `data` and `send`. A Game that needs something about a User on the server receives it in a Game message and keeps it in `user.data`.
- Events and their data are typed from the Game's `server` entry in the games map.
- `game.state` and each `user.data` are replaced at every Match start. A Manager reads them from the context each time and keeps no reference.
- A User that connects with a Match under way gets new per-User data from the Game definition.
- A User's per-User data goes when the User leaves the room, also with the Match `ended`. There is never data for a User that is not in `room.users`.
- `memory` is the Match memory: `createMemory()` makes it when the Game becomes the active Game and again at every Match start. It is never sent to anyone. A Manager without `createMemory` has `undefined`.
- What `game.settings`, `game.state` and `user.data` hold is what Users receive, read as [contracts.md](contracts.md#behaviour) says.

### Game messages

A client message whose event is not one of Porter's goes to the active Game's Manager.

- A handler is a method carrying the Game's `On(event)`. `On` checks at compile time the event name and the type of the handler's `data` against the Game's `client` entry. It does not report a message that has no handler.
- A handler's signature is `(ctx, data, user)`, where `user` is the sender. A handler that does not use `data` or `user` does not declare them.
- The four checks below run in the order written, that of [protocol.md](protocol.md#rejected-messages), and the first to fail answers.
- **No handler.** `unhandled`.
- **Admin.** With `@AdminOnly()`, a sender that is not the Admin gets `notAdmin`, and the guard is not run.
- **Guard.** A message that carries data declares a guard, `On('answer', isAnswer)`, of type `(data: unknown) => data is T`. When it returns `false` Porter answers `malformed` without calling the Manager. A message without data has no guard. Porter brings no validation library: a guard is written by hand or wraps one.
- **Match.** A Game message is delivered only while the Match is `running` or `paused`; otherwise the sender gets `notAllowedNow`. `@AnyTime()` marks a handler that is also called without a Match under way.
- **Rejecting.** `throw ctx.reject(reason)` answers the sender with `{ code: 'game', reason }`. Anything else thrown, or a rejected promise, answers `failed` and is logged.
- A handler may be `async`.
- A pause does not hold Game messages back.

### Order within a room

- Porter does not queue the messages of a room. It delivers each one as it arrives and does not wait for an `async` handler to finish: the next message of that room may be delivered while the first is awaiting.
- Whatever runs without an `await` in between is atomic. Porter's own checks, and a handler up to its first `await`, never interleave with anything. The messages of one connection start being processed in the order they arrived.
- The same holds for what is not a message: while a handler awaits, a Match timer may fire, a User may drop or leave the room, a Grace period may run out and the Match may end.
- After an `await` a Manager reads again from the context and trusts nothing it read before.
- Porter itself awaits in two places only, both `defaultSettings()`: when a room is created, before the room exists, and in `porter:changeGame` (see "Changing the Game").

### Exceptions in hooks

The hooks are `onStart`, `onPause`, `onContinue`, `onEnd`, `onUserDisconnected` and `onUserLeft`. Each is called after the situation has changed and has been announced.

- When a hook throws, or the promise of `onStart` rejects, Porter catches it where it calls the hook and logs it. Nothing else happens: nobody gets `failed`, the situation is not undone and the Match goes on. The announcement was the confirmation of the request.
- The exception does not reach whoever caused the hook. When a handler calls `ctx.endMatch` and `onEnd` throws, `ctx.endMatch` returns normally, the handler goes on and the Match is `ended`.
- An `onStart` that throws leaves a Match `running` without its opening. The Admin gets out of it with `porter:endMatch`. Porter does not end the Match and has no `EndReason` for an error.
- `canStart` and `updateSettings` are not hooks in this sense: they run before any announcement, and what they throw answers the sender.
- **Synchronous methods.** `updateSettings`, `canStart`, `onPause`, `onContinue`, `onEnd`, `onUserDisconnected` and `onUserLeft` are synchronous and Porter does not await them. TypeScript accepts an `async` method in their place, so Porter attaches a `catch` to any promise one of them returns: the rejection is logged like any other exception and the process never dies of an unhandled rejection from a Manager.
- In `canStart` and `updateSettings`, whatever happens after the first `await` comes too late: it neither vetoes the start nor prevents the announcement. A `canStart` that needs something asynchronous gets it beforehand, through an `@AnyTime()` Game message that leaves the result in the state.

### Settings

- `defaultSettings()` takes no context and may be asynchronous. Porter calls it when a room is created with that Game and when a room changes to it, and writes the result into the settings with their `set(data)`. The result is trusted: it does not go through `updateSettings`. When it throws or its promise rejects, nothing of the room changes and the error is logged: see "Rooms" for a room being created and "Changing the Game" for a change.
- `updateSettings(ctx, next)` is called for `porter:updateSettings`. `next` is whatever the Admin sent, known only to be an object. The Manager validates it and writes into `ctx.game.settings`, or throws `ctx.reject(reason)`.
- When it returns, Porter announces `porter:settingsUpdated` with the settings as they then are. When it throws, Porter announces nothing; a `ctx.reject` answers the sender with `{ code: 'game', reason }` and anything else with `failed`.
- A field the server computes is kept by the Manager, which does not take it from `next`.
- Settings may be updated at any time, with or without a Match.

### Changing the Game

- `porter:changeGame` is refused with `notAllowedNow` with a Match under way and, failing that, with `notFound` when no Game has that name.
- Changing to the Game that is already active is carried out like any other change. So is `porter:lockRoom` with the value the room already has: Porter does not compare, and announces.
- Porter asks the new Game for its default settings before it discards anything. If `defaultSettings()` throws or its promise rejects, the Admin gets `failed`, nothing is announced, the room keeps the previous Game with everything as it was, and the error is logged.
- When the settings arrive, Porter checks the situation again: if a Match has started in the meantime, the Admin gets `notAllowedNow` and nothing changes.
- Then, without awaiting anything else, Porter discards the previous Game's settings, state, per-User data, Match memory and last result, loads the new Game's default settings, creates its state, per-User data and Match memory, sets its Match to `idle` and announces `porter:gameChanged`.
- Two `porter:changeGame` in a row are each carried out and announced when their settings arrive. The room ends in the Game of the one that resolved last.

### Match

Porter owns the Match: whether there is one, whether it is paused, and its timers. A Manager never writes code to reset a Match.

**Starting.** On `porter:startMatch` Porter, in this order:

1. refuses with `notAdmin` if the sender is not the Admin;
2. refuses with `notAllowedNow` if a Match is under way;
3. refuses with `belowMinPlayers` if the Users `connected` or `reconnecting` are fewer than the Game definition's `minPlayers`;
4. calls `canStart(ctx)`, when the Manager has it. If it throws `ctx.reject(reason)`, the sender gets `{ code: 'game', reason }` and nothing else happens;
5. creates new state, new per-User data for every User and a new Match memory. The settings are kept;
6. sets the Match to `running` and announces `porter:matchStarted`;
7. calls `onStart(ctx)`. The Game sends its opening from there.

**Pausing and continuing.** `porter:pauseMatch` sets the Match to `paused` with the reason given, stops every Match timer, announces `porter:matchPaused` and calls `onPause(ctx, reason)`. The message's `data` must be an object, or it is `malformed`; a missing `reason` is `null`. `porter:continueMatch` sets it to `running`, resumes the timers with the time each had left, announces `porter:matchContinued` and calls `onContinue(ctx)`. Porter does not read the reason and has no guard for it: `onPause` and the clients receive whatever the Admin's client sent.

**Ending.** A Match ends in three ways, each with its `EndReason`:

| Cause | `EndReason` |
|---|---|
| the Manager calls `ctx.endMatch(reason)` | `{ by: 'game', reason }` |
| `porter:endMatch` | `{ by: 'admin' }` |
| the Users in the room fall below `minPlayers` | `{ by: 'minPlayers' }` |

In all three Porter cancels every Match timer, sets the Match to `ended`, announces `porter:matchEnded` and then calls `onEnd(ctx, reason)`. State and per-User data stay as they were until the next Match starts.

`ctx.endMatch` without a Match under way does nothing: it announces nothing, does not call `onEnd`, does not throw and is not logged. That covers a Match that is `idle` or `ended`, a second call, whose reason is ignored in favour of the first, and a call from inside `onEnd`. It is the opposite of `timers.set` on purpose: a handler that awaits may find the Match already ended by the Admin or by the minimum, and the state it asks for is the one that already holds.

All hooks are optional.

### Users and the Match

- The Users counted against `minPlayers` are those `connected` or `reconnecting`. The minimum is checked when a User leaves the room, not when its connection drops.
- When a User leaves with a Match `running` or `paused` and the count falls below `minPlayers`, the Match ends with `{ by: 'minPlayers' }`: the Manager receives `onEnd` and not `onUserLeft`.
- `onUserDisconnected(ctx, user)` is called when a User's connection drops and it becomes `reconnecting`. `onUserLeft(ctx, user)` is called when a User leaves the room, by Grace period or by being removed.
- Both are called only with the Match `running` or `paused`.
- There is no notice for a User joining or coming back.
- A User may join a room with a Match under way; the lock is what prevents it.

### Match timers

`ctx.timers` are the room's Match timers. What they send is in [protocol.md](protocol.md#match-timers).

- `set(name, ms, callback)` creates a timer that fires once. A timer of the same name is replaced. There are no intervals and no way to ask whether a timer exists or how long it has left.
- `clear(name)` removes it. If there is none, nothing happens and nothing is sent.
- With the Match `running`, a timer set starts at once. With the Match `paused`, it is created stopped and starts when the Match continues.
- Without a Match under way, `set` throws. That includes a `set` inside `onEnd`: the timers are already cancelled when `onEnd` is called.
- `ms` is finite and greater than zero; otherwise `set` throws. A Game with no time limit does not create the timer.
- Every timer stops while the Match is `paused`. There is no option per timer. A Game that needs a clock the pause does not stop uses `setTimeout` and clears it in `onEnd`.
- When a timer fires, Porter removes it and announces `porter:timerCleared` before calling the callback, which may set a timer of the same name.
- A callback never runs with the Match `paused` or over.
- A callback may be `async`. If it throws or its promise rejects, Porter logs it, the Match goes on and nothing is sent to any client.
- When the room ceases to exist its timers are cancelled with it.
- After an `await`, the Match may be over. A `set` there throws: in a handler the sender gets `failed`, anywhere else it is only logged.

### Logging

- Porter logs with the `Logger` of `@nestjs/common` under the fixed context `Porter`, and never with `console`. There is no logging option: the Integrator replaces the logger the NestJS way.
- It logs at `error` level only, and only two things:
  - an exception from the Integrator's code: a hook, a handler, `canStart`, `updateSettings`, `defaultSettings` or a Match timer callback that throws or whose promise rejects, other than a `ctx.reject`. The line carries the room, when there is one, the Game, the name of the method, message or timer, and the stack;
  - an unexpected error of Porter's own.
- It does not log the normal flow (logins, connections, Users leaving, Admin changes, Matches) or messages answered with `porter:messageRejected` for any reason but `failed`.
- A line never carries a Token, a Profile or the data of a message; only the room id, the Game's name, the User's name and the event name.

## Usage

The Manager of the example Game in [contracts.md](contracts.md#usage).

```ts
import {
  AdminOnly,
  AnyTime,
  type CanStart,
  type CreateMemory,
  type GameContext,
  GameManager,
  type GameManager as Manager,
  handlersOf,
  type OnStart,
  type OnUserLeft,
  type UserOf,
} from '@porterkit/nestjs';
import { type Card, type Games, misfit, type MisfitSettingsData } from './misfit.game';
import { CardService } from './card.service';

// The Integrator's three aliases for this Game.
const On = handlersOf<Games, 'misfit'>();
type MisfitUser = UserOf<Games, typeof misfit>;
type Ctx = GameContext<Games, typeof misfit, MisfitMemory>;

/** The Match memory: never sent to anyone. */
interface MisfitMemory {
  shown: Card[];
}

const isAnswer = (d: unknown): d is { answer: string } =>
  typeof (d as { answer?: unknown })?.answer === 'string';
const isSettings = (d: unknown): d is MisfitSettingsData =>
  Number.isFinite((d as MisfitSettingsData)?.roundTime) &&
  Number.isInteger((d as MisfitSettingsData)?.maxPoints);

@GameManager(misfit)
export class MisfitManager
  implements Manager<Ctx>, CreateMemory<Ctx>, CanStart<Ctx>, OnStart<Ctx>, OnUserLeft<Ctx> {
  constructor(private readonly cards: CardService) {}

  async defaultSettings() {
    return { roundTime: 30_000, maxPoints: await this.cards.count() };
  }

  updateSettings(ctx: Ctx, next: unknown) {
    if (!isSettings(next)) throw ctx.reject('invalidSettings');
    ctx.game.settings.set(next);
  }

  createMemory(): MisfitMemory {
    return { shown: [] };
  }

  canStart(ctx: Ctx) {
    if (ctx.game.settings.maxPoints < 1) throw ctx.reject('invalidSettings');
  }

  // porter:matchStarted is already out; state, per-User data and memory are new.
  async onStart(ctx: Ctx) {
    await this.startRound(ctx);
  }

  onUserLeft(ctx: Ctx) {
    if (this.everyoneAnswered(ctx)) this.endRound(ctx);
  }

  @AdminOnly()
  @AnyTime()
  @On('preStart')
  preStart(ctx: Ctx) {
    ctx.room.broadcast('preStarted');
  }

  @On('answer', isAnswer)
  answer(ctx: Ctx, { answer }: { answer: string }, user: MisfitUser) {
    if (user.data.status === 'ready') throw ctx.reject('alreadyAnswered');
    user.data.answer = answer;
    user.data.status = 'ready';
    if (this.everyoneAnswered(ctx)) this.endRound(ctx);
  }

  @AdminOnly()
  @On('nextRound')
  nextRound(ctx: Ctx) {
    const winners = ctx.room.users
      .filter((u) => u.data.points >= ctx.game.settings.maxPoints)
      .map((u) => u.name);
    if (winners.length > 0) return ctx.endMatch({ winners });
    return this.startRound(ctx);
  }

  private async startRound(ctx: Ctx) {
    const { room, game, memory, timers } = ctx;

    for (const u of room.users) {
      u.data.answer = '';
      u.data.status = 'idle';
    }
    const players = room.connected;
    const turn = players.findIndex((u) => u.name === game.state.turn);
    game.state.turn = players[(turn + 1) % players.length].name;
    room.broadcast('turnChanged', game.state.turn);

    const card = await this.cards.random(memory.shown);
    memory.shown.push(card);
    game.state.card = card;

    if (game.settings.roundTime !== 0) {
      timers.set('endRound', game.settings.roundTime, () => this.endRound(ctx));
    }
    room.broadcast('cardDealt', { card });
  }

  private endRound(ctx: Ctx) {
    ctx.timers.clear('endRound');
    const answered = ctx.room.users.filter((u) => u.data.status === 'ready');
    for (const u of answered) u.data.points += 1;
    ctx.room.broadcast('roundEnded', answered.map((u) => ({ name: u.name, answer: u.data.answer })));
  }

  private everyoneAnswered(ctx: Ctx) {
    return ctx.room.connected.every((u) => u.data.status === 'ready');
  }
}
```

Registering it. The Game's module does not import `PorterModule`.

```ts
import { Module } from '@nestjs/common';
import { PorterModule } from '@porterkit/nestjs';
import type { Games } from './misfit.game';
import { CardService } from './card.service';
import { MisfitManager } from './misfit.manager';

@Module({ providers: [CardService, MisfitManager] })
export class MisfitModule {}

@Module({
  imports: [PorterModule.forRoot<Games>({ initialGame: 'misfit' }), MisfitModule],
})
export class AppModule {}
```

The Integrator's `main.ts`:

```ts
import { NestFactory } from '@nestjs/core';
import { WsAdapter } from '@nestjs/platform-ws';
import { AppModule } from './app.module';

const app = await NestFactory.create(AppModule);
app.useWebSocketAdapter(new WsAdapter(app));
app.enableCors();
await app.listen(3000);
```

## Verify during construction

- **SSE `id`.** Whether `@Sse` adds an `id` to every event unasked. Nothing changes either way: the protocol gives it no meaning and the client ignores it.
- **Shared port on Fastify.** That `WsAdapter` serves `/porter/ws` on the HTTP server's port under Fastify as it does under Express. If it does not, the Integrator passes a port to the adapter and the first bullet on the gateway in "Module" changes; the client already takes the WebSocket URL separately.
- **Gateway path.** That `WsAdapter` matches `/porter/ws` exactly and ignores the global prefix. If the prefix applies, "HTTP routes" in [protocol.md](protocol.md#http-routes) changes to say so.
- **SSE cleanup on Fastify.** That `finalize` runs when a client closes an SSE connection under Fastify. If it does not, the connection is closed by the next unanswered ping, one to two `pingInterval` later, and nothing else changes.
- **Discovery.** That `DiscoveryService` finds a `@GameManager` class in any module, without that module importing `PorterModule`, and that discovery is complete before `onApplicationBootstrap`. If it is not, the `initialGame` check moves to the first hook where it is, or Game modules are registered through `PorterModule`.
- **Missing `createMemory`.** A Manager whose context declares a Match memory type and that lacks `createMemory` compiles and gets `undefined`. If Porter can detect it at startup, the application does not start and "Context" says so.
- **`import type` from CommonJS.** That this package, compiled to CommonJS, never emits a `require` of `@porterkit/contracts`. If one appears, the import in question becomes `import type`.

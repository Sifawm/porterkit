# `@porterkit/contracts`

## Purpose

The types shared by server and client: the games map, every message of the [protocol](protocol.md), the shapes of a room and its Users on the wire, and the Game definition.

It has no dependencies and emits no runtime code ([ADR 0006](../adr/0006-contracts-is-types-only.md)). It is safe to import from a browser. `@porterkit/nestjs`, `@porterkit/client` and `@porterkit/react` depend on it and import it with `import type`.

## Public API

Everything exported is below. What does not appear is not public.

### Games map

The Integrator declares one map from Game name to that Game's types and passes it as the first type parameter of every generic type here. `Profile` is the second ([ADR 0003](../adr/0003-games-type-map.md)).

```ts
/** A Game's event names never start with `porter:`. */
type GameEvents = { [event: `porter:${string}`]: never; [event: string]: unknown };

export interface GameTypes {
  settings: object;
  state: object;
  /** One User's data in this Game. */
  userData: object;
  /** Client → server: event name → data. `undefined` for a message without data. */
  client: GameEvents;
  /** Server → client: event name → data. */
  server: GameEvents;
  pauseReason: unknown;
  endReason: unknown;
  rejectReason: string;
}

export type GamesMap = Record<string, GameTypes>;

export type GameName<Games extends GamesMap> = keyof Games & string;
```

### Game definition

```ts
export interface GameDefinition<Games extends GamesMap, Name extends GameName<Games>> {
  name: Name;
  minPlayers: number;
  createSettings(): Games[Name]['settings'] & { set(data: Games[Name]['settings']): void };
  createState(): Games[Name]['state'];
  createUserData(): Games[Name]['userData'];
}
```

### Room and Users on the wire

```ts
export type UserStatus = 'connected' | 'reconnecting';

export interface WireUser<Profile> {
  name: string;
  profile: Profile;
  status: UserStatus;
}

export type EndReason<GameEndReason = unknown> =
  | { by: 'game'; reason: GameEndReason }
  | { by: 'admin' }
  | { by: 'minPlayers' };

export type MatchStatus<PauseReason = unknown, GameEndReason = unknown> =
  | { status: 'idle' }
  | { status: 'running' }
  | { status: 'paused'; reason: PauseReason }
  | { status: 'ended'; reason: EndReason<GameEndReason> };

/** Remaining milliseconds by Match timer name. */
export type WireTimers = Record<string, number>;

/** `game.match` in `porter:joined`: the situation plus the Match timers. */
export type JoinedMatch<PauseReason = unknown, GameEndReason = unknown> =
  | { status: 'idle' }
  | { status: 'running'; timers: WireTimers }
  | { status: 'paused'; reason: PauseReason; timers: WireTimers }
  | { status: 'ended'; reason: EndReason<GameEndReason> };

/** Discriminated by `name`. */
export type JoinedGame<Games extends GamesMap> = {
  [Name in GameName<Games>]: {
    name: Name;
    settings: Games[Name]['settings'];
    state: Games[Name]['state'];
    /** By User name. */
    userData: Record<string, Games[Name]['userData']>;
    match: JoinedMatch<Games[Name]['pauseReason'], Games[Name]['endReason']>;
  };
}[GameName<Games>];

export interface Joined<Games extends GamesMap, Profile> {
  roomId: string;
  you: string;
  admin: string;
  locked: boolean;
  /** Milliseconds between two `porter:ping`. */
  pingInterval: number;
  users: WireUser<Profile>[];
  game: JoinedGame<Games>;
}
```

### Reasons

```ts
export type LoginRejectReason =
  | 'invalidName' | 'invalidProfile' | 'roomNotFound' | 'nameTaken' | 'roomFull' | 'roomLocked' | 'failed';

export type ConnectRejectReason = 'invalidToken' | 'roomNotFound' | 'notInRoom';

export type CommandRejectReason = ConnectRejectReason | 'notConnected';

export type UserLeftReason = 'timeout' | 'kicked';

export type RejectReason<Games extends GamesMap> =
  | 'malformed' | 'notAdmin' | 'notAllowedNow' | 'belowMinPlayers' | 'notFound' | 'unhandled' | 'failed'
  | { code: 'game'; reason: Games[GameName<Games>]['rejectReason'] };
```

### HTTP bodies

```ts
export interface LoginRequest<Profile> {
  name: string;
  profile: Profile;
  roomId?: string;
}

export interface LoginResponse {
  token: string;
  roomId: string;
}

export interface LoginRejection {
  reason: LoginRejectReason;
}

export interface CommandRejection {
  reason: CommandRejectReason;
}
```

### Messages

```ts
export interface Envelope {
  event: string;
  data?: unknown;
}

/** Client → server, Porter's own: event name → data. */
export type PorterCommands<Games extends GamesMap> = {
  'porter:lockRoom': { locked: boolean };
  'porter:kickUser': { name: string };
  'porter:changeGame': { game: GameName<Games> };
  'porter:updateSettings': Games[GameName<Games>]['settings'];
  'porter:startMatch': undefined;
  'porter:pauseMatch': { reason: Games[GameName<Games>]['pauseReason'] };
  'porter:continueMatch': undefined;
  'porter:endMatch': undefined;
  'porter:pong': undefined;
};

/** Server → client, Porter's own: event name → data. */
export type PorterEvents<Games extends GamesMap, Profile> = {
  'porter:joined': Joined<Games, Profile>;
  'porter:rejected': { reason: ConnectRejectReason };
  'porter:replaced': undefined;
  'porter:kicked': undefined;
  'porter:userJoined': { user: WireUser<Profile> & { status: 'connected' } };
  'porter:userDisconnected': { name: string };
  'porter:userReconnected': { name: string };
  'porter:userLeft': { name: string; reason: UserLeftReason };
  'porter:adminChanged': { admin: string };
  'porter:roomLocked': { locked: boolean };
  'porter:ping': undefined;
  'porter:gameChanged': {
    [Name in GameName<Games>]: { game: Name; settings: Games[Name]['settings'] };
  }[GameName<Games>];
  'porter:settingsUpdated': Games[GameName<Games>]['settings'];
  'porter:matchStarted': undefined;
  'porter:matchPaused': { reason: Games[GameName<Games>]['pauseReason'] };
  'porter:matchContinued': undefined;
  'porter:matchEnded': { reason: EndReason<Games[GameName<Games>]['endReason']> };
  'porter:timerSet': { name: string; remaining: number };
  'porter:timerCleared': { name: string };
  'porter:messageRejected': { rejected: string; reason: RejectReason<Games> };
};

/** The envelopes of an event map. An event whose data is `undefined` has no `data`. */
type Envelopes<Events> = {
  [E in keyof Events & string]: [Events[E]] extends [undefined]
    ? { event: E }
    : { event: E; data: Events[E] };
}[keyof Events & string];

/** Every envelope a client may send: Porter's commands and each Game's `client` events. */
export type ClientMessage<Games extends GamesMap> =
  | Envelopes<PorterCommands<Games>>
  | { [Name in GameName<Games>]: Envelopes<Games[Name]['client']> }[GameName<Games>];

/** Every envelope a server may send: Porter's events and each Game's `server` events. */
export type ServerMessage<Games extends GamesMap, Profile> =
  | Envelopes<PorterEvents<Games, Profile>>
  | { [Name in GameName<Games>]: Envelopes<Games[Name]['server']> }[GameName<Games>];
```

## Behaviour

**Types only**

- The package emits no JavaScript. Event names and reasons are unions of string literals; there are no enums, constants or classes.
- There are no base classes. An Integrator's settings, state and per-User data extend nothing of Porter's.
- The types compile without Node or DOM typings.

**Games map**

- A Game's `client` and `server` event names do not start with `porter:`. A games map with such a name does not satisfy `GamesMap`.
- A message without data has `undefined` as its data type, and its envelope has no `data`.
- `rejectReason` is a union of string literals. `pauseReason` and `endReason` are any JSON value. A Game without pause reasons declares `pauseReason: null`.
- `Profile` is any JSON value.

**Game definition**

- It is the part of a Game both sides import. It runs in a browser and imports nothing from the server.
- `name` is the Game's key in the games map. `minPlayers` is the fewest Users a Match may have.
- The three factories take no arguments and return a new value on every call. The value may be an instance of a class or an object literal.
- `createSettings()` returns the settings plus `set(data)`, which replaces them with `data`. It is the only method Porter asks of a Game's data.

**A Game's data is its JSON**

- Porter reads settings, state and per-User data with `JSON.stringify`. There is no read method of Porter's.
- What a factory returns survives a JSON round trip unchanged: no `Map`, `Set` or `Date`, no circular references, and no data held in private fields.
- Every enumerable field travels to every User. What Users are not to see is kept in the Match memory ([nestjs.md](nestjs.md)).
- A value that needs another shape on the wire defines `toJSON()`, and that shape is the one declared in the games map.
- The compiler catches a field that is missing or of the wrong type against the games map. It does not catch an extra one, and nothing checks at run time.

## Usage

An example Game, in a package that both the server and the front import.

```ts
import type { GameDefinition } from '@porterkit/contracts';

export interface Card {
  category: 'basics' | 'spicy';
  question: string;
}

export interface MisfitSettingsData {
  roundTime: number; // ms, 0 = no limit
  maxPoints: number;
}

export class MisfitSettings implements MisfitSettingsData {
  roundTime = 30_000;
  maxPoints = 10;

  set(data: MisfitSettingsData) {
    Object.assign(this, data);
  }
}

export class MisfitState {
  turn = '';
  card?: Card;
}

export class MisfitUserData {
  answer = '';
  status: 'idle' | 'editing' | 'ready' = 'idle';
  points = 0;
}

/** The Game's entry in the games map. */
export type Misfit = {
  settings: MisfitSettingsData;
  state: { turn: string; card?: Card };
  userData: { answer: string; status: 'idle' | 'editing' | 'ready'; points: number };
  // imperative: what a client asks for
  client: {
    answer: { answer: string };
    nextRound: undefined;
    preStart: undefined;
  };
  // past tense: what the server announces
  server: {
    turnChanged: string;
    cardDealt: { card: Card };
    roundEnded: Array<{ name: string; answer: string }>;
    preStarted: undefined;
  };
  pauseReason: 'break';
  endReason: { winners: string[] };
  rejectReason: 'invalidSettings' | 'alreadyAnswered';
};

/** The Integrator's games map: one line per Game. */
export type Games = { misfit: Misfit };

export const misfit = {
  name: 'misfit',
  minPlayers: 3,
  createSettings: () => new MisfitSettings(),
  createState: () => new MisfitState(),
  createUserData: () => new MisfitUserData(),
} satisfies GameDefinition<Games, 'misfit'>;
```

The Integrator hides the type parameters once behind its own aliases:

```ts
import type { ClientMessage, ServerMessage } from '@porterkit/contracts';

export type Profile = { avatar: string };
export type Client = ClientMessage<Games>;
export type Server = ServerMessage<Games, Profile>;
```

## Verify during construction

- **`porter:` prefix.** That the `GameEvents` index signatures reject a `client` or `server` event named `porter:…` and still accept games maps written as type aliases. If they do not, the rule holds only at run time, where such a client message is never delivered to a Game.
- **Several Games.** That `ClientMessage`, `ServerMessage`, `JoinedGame` and `porter:gameChanged` discriminate correctly with a games map of two Games whose settings and events differ. The type tests cover it; if one fails, the type in question is rewritten here.
- **`GameDefinition` and classes.** That a class with methods beyond `set` (a helper on per-User data, say) satisfies `GameDefinition` under `satisfies`. If it does not, the factory return types are loosened to accept extra members.

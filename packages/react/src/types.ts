import type {
  ConnectRejectReason,
  GameDefinition,
  GameName,
  GamesMap,
  LoginRejectReason,
  MatchStatus,
  PorterCommands,
  PorterEvents,
  UserStatus,
  WireUser,
} from '@porterkit/contracts';

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

export type Connection =
  | { status: 'idle' } // no Token
  | { status: 'connecting' } // first connection after a login or a resume
  | { status: 'connected' } // `porter:joined` has arrived
  | { status: 'reconnecting' } // the connection dropped and the client is retrying
  | { status: 'closed'; reason: CloseReason };

export type CloseReason = 'left' | 'kicked' | 'replaced' | 'unreachable' | ConnectRejectReason;

/** A User as the hooks give it. `data` is its data in the active Game. */
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

export interface GameView<Games extends GamesMap, Name extends GameName<Games>, Profile> extends GameData<Games, Name> {
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

type Intersect<Union> = (Union extends unknown ? (member: Union) => void : never) extends (all: infer All) => void
  ? All
  : never;

type Args<Data> = [Data] extends [undefined] ? [] : [data: Data];

/** What a client sends: Porter's commands, without the pong, and every Game's `client` events. */
export type Outgoing<Games extends GamesMap> = Omit<PorterCommands<Games>, 'porter:pong'> &
  Intersect<Games[GameName<Games>]['client']>;

/** What a client listens to: Porter's events, without the ping, and every Game's `server` events. */
export type Incoming<Games extends GamesMap, Profile> = Omit<PorterEvents<Games, Profile>, 'porter:ping'> &
  Intersect<Games[GameName<Games>]['server']>;

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

export type LoginResult = { ok: true; roomId: string } | { ok: false; reason: LoginRejectReason };

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

  readonly hooks: {
    useConnection(): Connection;
    useRoom(): RoomView<Games, Profile>;
    useGame(): AnyGameView<Games, Profile>;
    useGame<Name extends GameName<Games>>(name: Name): GameView<Games, Name, Profile>;
    useTimer(name: string): Timer | null;
    useEvent<E extends keyof Incoming<Games, Profile> & string>(
      event: E,
      listener: (data: Incoming<Games, Profile>[E]) => void,
    ): void;
  };
}

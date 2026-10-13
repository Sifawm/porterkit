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

export interface GameDefinition<Games extends GamesMap, Name extends GameName<Games>> {
  name: Name;
  minPlayers: number;
  /** Ticks per second. A Game without it has no Tick. */
  tickRate?: number;
  createSettings(): Games[Name]['settings'] & { set(data: Games[Name]['settings']): void };
  createState(): Games[Name]['state'];
  createUserData(): Games[Name]['userData'];
}

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

export type LoginRejectReason =
  | 'invalidName'
  | 'invalidProfile'
  | 'roomNotFound'
  | 'nameTaken'
  | 'roomFull'
  | 'roomLocked'
  | 'failed';

export type ConnectRejectReason = 'invalidToken' | 'roomNotFound' | 'notInRoom';

export type CommandRejectReason = ConnectRejectReason | 'notConnected';

export type UserLeftReason = 'timeout' | 'kicked';

export type RejectReason<Games extends GamesMap> =
  | 'malformed'
  | 'notAdmin'
  | 'notAllowedNow'
  | 'belowMinPlayers'
  | 'notFound'
  | 'unhandled'
  | 'failed'
  | { code: 'game'; reason: Games[GameName<Games>]['rejectReason'] };

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
  [E in keyof Events & string]: [Events[E]] extends [undefined] ? { event: E } : { event: E; data: Events[E] };
}[keyof Events & string];

/** Every envelope a client may send: Porter's commands and each Game's `client` events. */
export type ClientMessage<Games extends GamesMap> =
  | Envelopes<PorterCommands<Games>>
  | { [Name in GameName<Games>]: Envelopes<Games[Name]['client']> }[GameName<Games>];

/** Every envelope a server may send: Porter's events and each Game's `server` events. */
export type ServerMessage<Games extends GamesMap, Profile> =
  | Envelopes<PorterEvents<Games, Profile>>
  | { [Name in GameName<Games>]: Envelopes<Games[Name]['server']> }[GameName<Games>];

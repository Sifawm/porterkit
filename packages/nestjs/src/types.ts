import type { EndReason, GameDefinition, GameName, GamesMap } from '@porterkit/contracts';

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

export type AnyDefinition = GameDefinition<any, string>;

export type Args<Data> = [Data] extends [undefined] ? [] : [data: Data];
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

export class GameRejection extends Error {
  constructor(readonly reason: string) {
    super(`Game rejected the message: ${reason}`);
  }
}

/** Everything a Manager can do in one room. */
export interface GameContext<Games extends GamesMap, Definition extends AnyDefinition, Memory = undefined> {
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

export type AnyContext = GameContext<any, any, any>;
type SettingsOf<Ctx extends AnyContext> = Parameters<Ctx['game']['settings']['set']>[0];
type UserIn<Ctx extends AnyContext> = Ctx['room']['users'][number];

/** What every Manager implements. Exported as the type `GameManager`. */
export interface ManagerMethods<Ctx extends AnyContext> {
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

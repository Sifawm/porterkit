import { randomBytes, randomInt, timingSafeEqual } from 'node:crypto';
import { inspect } from 'node:util';
import { Logger } from '@nestjs/common';
import type {
  CommandRejectReason,
  ConnectRejectReason,
  EndReason,
  GamesMap,
  Joined,
  LoginRejectReason,
  LoginResponse,
  PorterCommands,
  PorterEvents,
  RejectReason,
  UserStatus,
} from '@porterkit/contracts';
import { AdminLine } from './admin-line';
import { definitionOf, type Handler, handlersIn } from './decorators';
import { Match } from './match';
import { Presence } from './presence';
import {
  type AnyDefinition,
  type Args,
  type GameContext,
  GameRejection,
  type PorterModuleOptions,
  type User,
} from './types';

/** What an adapter gives Porter. `send` serializes the message before it returns. */
export interface Sink {
  send(message: { event: string; data?: unknown }): void;
  close(): void;
}

/** What Porter gives an adapter. */
export interface Connection {
  /** One incoming envelope, not yet validated. */
  receive(raw: unknown): void;
  /** The transport reports that it dropped. */
  closed(): void;
}

interface Registered {
  definition: AnyDefinition;
  manager: any;
  handlers: Map<string, Handler>;
}

interface UserRec {
  name: string;
  profile: unknown;
  secret: Buffer;
  presence: Presence;
  /** That of its Presence. */
  readonly status: Presence['status'];
  data: object;
  /** The User a Manager sees. */
  view: User<any, any>;
}

interface Game {
  entry: Registered;
  settings: any;
  state: object;
  memory: unknown;
  match: Match;
  ctx: GameContext<any, any, any>;
}

interface RoomRec {
  id: string;
  /** In the order they joined, `pending` ones included. */
  users: UserRec[];
  /** Who is the Admin, and who has been. */
  line: AdminLine<UserRec>;
  locked: boolean;
  game: Game;
}

type Reject = (reason: RejectReason<GamesMap>) => void;
type Result<Reason> = { status: number; body?: { reason: Reason } };

const DEFAULTS = { capacity: 16, maxNameLength: 20, maxProfileSize: 2048, pingInterval: 30_000, gracePeriod: 20_000 };

const integerFrom = (min: number) => (value: unknown) => Number.isInteger(value) && (value as number) >= min;
const positive = (value: unknown) => typeof value === 'number' && Number.isFinite(value) && value > 0;
/** A timer fires once a millisecond at most. */
const MAX_TICK_RATE = 1000;
const VALID: Record<string, (value: unknown) => boolean> = {
  capacity: integerFrom(1),
  maxNameLength: integerFrom(1),
  maxProfileSize: integerFrom(4),
  pingInterval: positive,
  gracePeriod: positive,
  validateProfile: (value) => typeof value === 'function',
};

/** Porter's own events, with whatever a Game defines left open. */
type Events = PorterEvents<GamesMap, unknown>;
type Command = Exclude<keyof PorterCommands<GamesMap>, 'porter:pong'>;

const COMMANDS = {
  'porter:lockRoom': true,
  'porter:kickUser': true,
  'porter:changeGame': true,
  'porter:updateSettings': true,
  'porter:startMatch': true,
  'porter:pauseMatch': true,
  'porter:continueMatch': true,
  'porter:endMatch': true,
} satisfies Record<Command, true>;
const isCommand = (event: string): event is Command => Object.hasOwn(COMMANDS, event);

const envelope = (event: string, data?: unknown) => (data === undefined ? { event } : { event, data });
/** One of Porter's own events as it travels. A Game's events go through `envelope`. */
const own = <E extends keyof Events>(event: E, ...data: Args<Events[E]>) => envelope(event, ...(data as [unknown?]));

const ROOM_ID = /^[a-z0-9]{10}$/;
const TOKEN = /^([a-z0-9]{10})\.([A-Za-z0-9_-]{43})$/;
const ALPHABET = 'abcdefghijklmnopqrstuvwxyz0123456789';

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);
const isThenable = (value: unknown): value is PromiseLike<unknown> =>
  typeof (value as { then?: unknown } | null)?.then === 'function';
const isVisible = (user: UserRec): user is UserRec & { status: UserStatus } => user.status !== 'pending';
const NO_CONNECTION: Connection = { receive() {}, closed() {} };

/** The rooms and everything that happens in them. The transports and NestJS stay outside. */
export class Porter {
  private readonly logger = new Logger('Porter');
  private readonly options: Required<Omit<PorterModuleOptions<any>, 'validateProfile'>> &
    Pick<PorterModuleOptions<any>, 'validateProfile'>;
  private readonly games = new Map<string, Registered>();
  private readonly rooms = new Map<string, RoomRec>();

  /** Throws when the options, the Managers or `initialGame` are not valid, in that order. */
  constructor(options: PorterModuleOptions<any>, managers: object[]) {
    for (const [option, valid] of Object.entries(VALID)) {
      const value = (options as Record<string, any>)[option];
      if (value !== undefined && !valid(value)) {
        throw new Error(`Porter: the option ${option} is not valid: ${inspect(value)}`);
      }
    }
    const given = Object.fromEntries(Object.entries(options).filter(([, value]) => value !== undefined));
    this.options = { ...DEFAULTS, ...given } as typeof this.options;

    for (const manager of managers) {
      const definition = definitionOf(manager.constructor);
      if (!definition) continue;
      const first = this.games.get(definition.name);
      if (first) {
        throw new Error(
          `Porter: the Game "${definition.name}" has two Managers: ${first.manager.constructor.name} and ${manager.constructor.name}`,
        );
      }
      const { tickRate } = definition;
      if (tickRate !== undefined && !(positive(tickRate) && tickRate <= MAX_TICK_RATE)) {
        throw new Error(`Porter: the Game "${definition.name}" has a tickRate that is not valid: ${inspect(tickRate)}`);
      }
      const hasOnTick = typeof (manager as { onTick?: unknown }).onTick === 'function';
      if (tickRate !== undefined && !hasOnTick) {
        throw new Error(`Porter: the Game "${definition.name}" has a tickRate and its Manager has no onTick`);
      }
      if (tickRate === undefined && hasOnTick) {
        throw new Error(
          `Porter: the Manager of the Game "${definition.name}" has onTick and its definition no tickRate`,
        );
      }
      this.games.set(definition.name, { definition, manager, handlers: handlersIn(manager) });
    }
    if (this.games.size === 0) throw new Error('Porter: no Manager is registered');
    if (!this.games.has(options.initialGame)) {
      throw new Error(`Porter: initialGame "${options.initialGame}" names no registered Game`);
    }
  }

  // ── HTTP ────────────────────────────────────────────────────────────────

  async login(body: unknown): Promise<{ status: number; body: LoginResponse | { reason: LoginRejectReason } }> {
    const refuse = (status: number, reason: LoginRejectReason) => ({ status, body: { reason } });
    if (!isObject(body) || typeof body.name !== 'string') return refuse(400, 'invalidName');
    const name = body.name.trim();
    if (name === '' || name.length > this.options.maxNameLength) return refuse(400, 'invalidName');

    const profile = body.profile ?? null;
    if (Buffer.byteLength(JSON.stringify(profile)) > this.options.maxProfileSize) return refuse(400, 'invalidProfile');
    try {
      if (this.options.validateProfile && this.options.validateProfile(profile) !== true) {
        return refuse(400, 'invalidProfile');
      }
    } catch (error) {
      this.logError('validateProfile', error);
      return refuse(400, 'invalidProfile');
    }

    let room: RoomRec | undefined;
    if (body.roomId !== undefined) {
      room = typeof body.roomId === 'string' && ROOM_ID.test(body.roomId) ? this.rooms.get(body.roomId) : undefined;
      if (!room) return refuse(404, 'roomNotFound');
      if (room.locked) return refuse(409, 'roomLocked');
      if (room.users.length >= this.options.capacity) return refuse(409, 'roomFull');
      const lower = name.toLowerCase();
      if (room.users.some((user) => user.name.toLowerCase() === lower)) return refuse(409, 'nameTaken');
    }

    const secret = randomBytes(32);
    const user: UserRec = {
      name,
      profile,
      secret,
      presence: undefined!,
      get status() {
        return user.presence.status;
      },
      data: {},
      view: undefined!,
    };
    user.view = {
      get name() {
        return user.name;
      },
      get status() {
        return user.status === 'connected' ? ('connected' as const) : ('reconnecting' as const);
      },
      get data() {
        return user.data;
      },
      send: (event: string, data?: unknown) => user.presence.send(envelope(event, data)),
    };

    if (!room) {
      const entry = this.games.get(this.options.initialGame)!;
      try {
        const settings = await entry.manager.defaultSettings();
        let id: string;
        do id = Array.from({ length: 10 }, () => ALPHABET[randomInt(ALPHABET.length)]).join('');
        while (this.rooms.has(id));
        room = { id, users: [], line: new AdminLine(user), locked: false, game: undefined! };
        room.game = this.createGame(room, entry, settings);
        this.rooms.set(id, room);
      } catch (error) {
        this.logError(`game=${entry.definition.name} method=defaultSettings`, error);
        return refuse(500, 'failed');
      }
    }
    const home = room;
    home.users.push(user);
    user.presence = new Presence(this.options, {
      dropped: () => this.dropped(home, user),
      graceOver: () => this.leave(home, user, 'timeout'),
    });
    return { status: 200, body: { token: `${room.id}.${secret.toString('base64url')}`, roomId: room.id } };
  }

  roomExists(id: string): boolean {
    return this.rooms.has(id);
  }

  /** `POST /porter/commands`: a client message from whoever holds the Token. */
  command(token: unknown, raw: unknown): Result<CommandRejectReason> {
    const found = this.verify(token);
    if ('reason' in found) return { status: 401, body: { reason: found.reason } };
    if (found.user.status !== 'connected') return { status: 409, body: { reason: 'notConnected' } };
    this.receive(found.room, found.user, raw);
    return { status: 202 };
  }

  // ── Connections ─────────────────────────────────────────────────────────

  connect(token: unknown, sink: Sink): Connection {
    const found = this.verify(token);
    if ('reason' in found) {
      sink.send(own('porter:rejected', { reason: found.reason }));
      sink.close();
      return NO_CONNECTION;
    }
    const { room, user } = found;
    const before = user.presence.attach(sink);
    if (before === 'pending') user.data = room.game.entry.definition.createUserData();

    // The Admin is settled first so `porter:joined` carries it, and announced after.
    const adminChanged = before !== 'connected' && room.line.connected(user);

    this.send(user, 'porter:joined', this.joined(room, user));
    const others = room.users.filter((other) => other !== user);
    if (before === 'pending') {
      const wire = { name: user.name, profile: user.profile, status: 'connected' as const };
      for (const other of others) this.send(other, 'porter:userJoined', { user: wire });
    }
    if (before === 'reconnecting') {
      for (const other of others) this.send(other, 'porter:userReconnected', { name: user.name });
    }
    if (adminChanged) this.announceAdmin(room);

    return {
      receive: (raw) => {
        if (user.presence.has(sink)) this.receive(room, user, raw);
      },
      closed: () => {
        if (user.presence.closed(sink)) this.dropped(room, user);
      },
    };
  }

  /** Closes every connection and clears every timer. */
  destroy(): void {
    for (const room of this.rooms.values()) {
      for (const user of room.users) user.presence.end();
      this.destroyRoom(room);
    }
  }

  private verify(token: unknown): { room: RoomRec; user: UserRec } | { reason: ConnectRejectReason } {
    const match = typeof token === 'string' ? TOKEN.exec(token) : null;
    if (!match) return { reason: 'invalidToken' };
    const room = this.rooms.get(match[1]);
    if (!room) return { reason: 'roomNotFound' };
    const secret = Buffer.from(match[2], 'base64url');
    const user = room.users.find((u) => secret.length === u.secret.length && timingSafeEqual(secret, u.secret));
    return user ? { room, user } : { reason: 'notInRoom' };
  }

  private joined(room: RoomRec, user: UserRec): Joined<GamesMap, unknown> {
    const { game } = room;
    const users = room.users.filter(isVisible);
    return {
      roomId: room.id,
      you: user.name,
      admin: room.line.admin.name,
      locked: room.locked,
      pingInterval: this.options.pingInterval,
      users: users.map((u) => ({ name: u.name, profile: u.profile, status: u.status })),
      game: {
        name: game.entry.definition.name,
        settings: game.settings,
        state: game.state,
        userData: Object.fromEntries(users.map((u) => [u.name, u.data])),
        match: game.match.snapshot(),
      },
    };
  }

  /** The User's connection is gone: it is `reconnecting` and its Grace period runs. */
  private dropped(room: RoomRec, user: UserRec) {
    this.broadcast(room, 'porter:userDisconnected', { name: user.name });
    if (room.line.dropped(user, room.users)) this.announceAdmin(room);
    if (room.game.match.underWay) this.hook(room, 'onUserDisconnected', user.view);
  }

  /** The User is out of the room, whatever state it was in. */
  private leave(room: RoomRec, user: UserRec, reason: 'timeout' | 'kicked') {
    const wasVisible = isVisible(user);
    user.presence.end();
    room.users.splice(room.users.indexOf(user), 1);
    if (wasVisible) this.broadcast(room, 'porter:userLeft', { name: user.name, reason });
    if (room.line.left(user, room.users)) this.announceAdmin(room);
    if (wasVisible && room.game.match.underWay) {
      if (room.users.filter(isVisible).length < room.game.entry.definition.minPlayers) {
        this.end(room, { by: 'minPlayers' });
      } else {
        this.hook(room, 'onUserLeft', user.view);
      }
    }
    // The Game has heard the end of its Match before the room goes.
    if (room.users.length === 0) this.destroyRoom(room);
  }

  private destroyRoom(room: RoomRec) {
    room.game.match.cancel();
    this.rooms.delete(room.id);
  }

  private announceAdmin(room: RoomRec) {
    this.broadcast(room, 'porter:adminChanged', { admin: room.line.admin.name });
  }

  private send<E extends keyof Events>(user: UserRec, event: E, ...data: Args<Events[E]>) {
    user.presence.send(own(event, ...data));
  }

  private broadcast<E extends keyof Events>(room: RoomRec, event: E, ...data: Args<Events[E]>) {
    for (const user of room.users) this.send(user, event, ...data);
  }

  // ── Messages ────────────────────────────────────────────────────────────

  private receive(room: RoomRec, user: UserRec, raw: unknown) {
    try {
      this.dispatch(room, user, raw);
    } catch (error) {
      this.logError(`room=${room.id} user=${user.name}`, error);
    }
  }

  private dispatch(room: RoomRec, user: UserRec, raw: unknown) {
    if (!isObject(raw) || typeof raw.event !== 'string') {
      return this.send(user, 'porter:messageRejected', { rejected: '', reason: 'malformed' });
    }
    const { event, data } = raw;
    const reject = (reason: RejectReason<GamesMap>) =>
      this.send(user, 'porter:messageRejected', { rejected: event, reason });
    const { game } = room;
    const { manager, definition } = game.entry;
    /** Runs a synchronous method of the Game. `false` when it threw and the sender has been answered. */
    const veto = (method: string, ...args: unknown[]) =>
      this.contain(room, game.entry, `method=${method}`, () => manager[method](game.ctx, ...args), { now: reject });

    if (event === 'porter:pong') return user.presence.pong();

    if (!event.startsWith('porter:')) {
      const handler = game.entry.handlers.get(event);
      if (!handler) return reject('unhandled');
      if (handler.adminOnly && room.line.admin !== user) return reject('notAdmin');
      const deliver = () => {
        if (handler.guard && !handler.guard(data)) return reject('malformed');
        if (!handler.anyTime && !game.match.underWay) return reject('notAllowedNow');
        return manager[handler.method](game.ctx, data, user.view);
      };
      return void this.contain(room, game.entry, `message=${event}`, deliver, { now: reject, later: reject });
    }

    if (!isCommand(event)) return reject('unhandled');
    if (room.line.admin !== user) return reject('notAdmin');

    switch (event) {
      case 'porter:lockRoom': {
        if (!isObject(data) || typeof data.locked !== 'boolean') return reject('malformed');
        room.locked = data.locked;
        return this.broadcast(room, 'porter:roomLocked', { locked: room.locked });
      }
      case 'porter:kickUser': {
        if (!isObject(data) || typeof data.name !== 'string') return reject('malformed');
        if (data.name === user.name) return reject('notAllowedNow');
        const target = room.users.find((u) => isVisible(u) && u.name === data.name);
        if (!target) return reject('notFound');
        target.presence.end(own('porter:kicked'));
        return this.leave(room, target, 'kicked');
      }
      case 'porter:changeGame': {
        if (!isObject(data) || typeof data.game !== 'string') return reject('malformed');
        if (game.match.underWay) return reject('notAllowedNow');
        const entry = this.games.get(data.game);
        if (!entry) return reject('notFound');
        const load = async () => {
          const settings = await entry.manager.defaultSettings();
          if (this.rooms.get(room.id) !== room) return;
          if (room.game.match.underWay) return reject('notAllowedNow');
          room.game = this.createGame(room, entry, settings);
          this.broadcast(room, 'porter:gameChanged', { game: entry.definition.name, settings: room.game.settings });
        };
        return void load().catch((error) => {
          reject('failed');
          this.logError(`room=${room.id} game=${entry.definition.name} method=defaultSettings`, error);
        });
      }
      case 'porter:updateSettings': {
        if (typeof data !== 'object' || data === null) return reject('malformed');
        if (veto('updateSettings', data)) this.broadcast(room, 'porter:settingsUpdated', game.settings);
        return;
      }
      case 'porter:startMatch': {
        if (game.match.underWay) return reject('notAllowedNow');
        if (room.users.filter(isVisible).length < definition.minPlayers) return reject('belowMinPlayers');
        if (typeof manager.canStart === 'function' && !veto('canStart')) return;
        this.fresh(room, game);
        game.match.start();
        this.broadcast(room, 'porter:matchStarted');
        return this.hook(room, 'onStart');
      }
      case 'porter:pauseMatch': {
        if (!isObject(data)) return reject('malformed');
        if (!this.pause(room, data.reason ?? null)) return reject('notAllowedNow');
        return;
      }
      case 'porter:continueMatch': {
        if (!this.continue(room)) return reject('notAllowedNow');
        return;
      }
      case 'porter:endMatch': {
        if (!this.end(room, { by: 'admin' })) return reject('notAllowedNow');
        return;
      }
      default:
        return event satisfies never;
    }
  }

  // ── Games and Matches ───────────────────────────────────────────────────

  private createGame(room: RoomRec, entry: Registered, settingsData: unknown): Game {
    const settings = entry.definition.createSettings();
    settings.set(settingsData);
    const { tickRate } = entry.definition;
    const game: Game = {
      entry,
      settings,
      state: {},
      memory: undefined,
      match: new Match(
        (name, callback) => {
          this.broadcast(room, 'porter:timerCleared', { name });
          this.contain(room, entry, `timer=${name}`, callback);
        },
        tickRate === undefined ? undefined : { every: 1000 / tickRate, run: () => this.hook(room, 'onTick') },
      ),
      ctx: undefined!,
    };
    game.ctx = this.context(room, game);
    this.fresh(room, game);
    return game;
  }

  /** New state, per-User data and Match memory. */
  private fresh(room: RoomRec, game: Game) {
    const { definition, manager } = game.entry;
    game.state = definition.createState();
    for (const user of room.users) if (isVisible(user)) user.data = definition.createUserData();
    game.memory = typeof manager.createMemory === 'function' ? manager.createMemory() : undefined;
  }

  private context(room: RoomRec, game: Game): GameContext<any, any, any> {
    const active = () => room.game === game && this.rooms.get(room.id) === room;
    return {
      room: {
        id: room.id,
        get admin() {
          return room.line.admin.name;
        },
        get users() {
          return room.users.filter(isVisible).map((u) => u.view);
        },
        get connected() {
          return room.users.filter((u) => u.status === 'connected').map((u) => u.view);
        },
        user: (name: string) => room.users.find((u) => isVisible(u) && u.name === name)?.view,
        broadcast: (event: string, data?: unknown) => {
          if (active()) for (const user of room.users) user.presence.send(envelope(event, data));
        },
      },
      game: {
        settings: game.settings,
        get state() {
          return game.state;
        },
      },
      get memory() {
        return game.memory;
      },
      timers: {
        set: (name, ms, callback) => {
          if (!active()) throw new Error(`Match timer "${name}" set without a Match under way`);
          game.match.setTimer(name, ms, callback);
          this.broadcast(room, 'porter:timerSet', { name, remaining: ms });
        },
        clear: (name) => {
          if (game.match.clearTimer(name)) this.broadcast(room, 'porter:timerCleared', { name });
        },
      },
      reject: (reason: string) => new GameRejection(reason),
      endMatch: (reason: unknown) => {
        if (active()) this.end(room, { by: 'game', reason });
      },
      pauseMatch: (reason: unknown) => {
        if (active()) this.pause(room, reason);
      },
      continueMatch: () => {
        if (active()) this.continue(room);
      },
    };
  }

  /** `false`, and nothing happens, unless the Match is `running`. */
  private pause(room: RoomRec, reason: unknown): boolean {
    if (!room.game.match.pause(reason)) return false;
    this.broadcast(room, 'porter:matchPaused', { reason });
    this.hook(room, 'onPause', reason);
    return true;
  }

  /** `false`, and nothing happens, unless the Match is `paused`. */
  private continue(room: RoomRec): boolean {
    if (!room.game.match.continue()) return false;
    this.broadcast(room, 'porter:matchContinued');
    this.hook(room, 'onContinue');
    return true;
  }

  /** `false`, and nothing happens, without a Match under way. */
  private end(room: RoomRec, reason: EndReason): boolean {
    if (!room.game.match.end(reason)) return false;
    this.broadcast(room, 'porter:matchEnded', { reason });
    this.hook(room, 'onEnd', reason);
    return true;
  }

  /** Calls a hook the Manager may not have. Whatever it throws is logged and goes no further. */
  private hook(room: RoomRec, method: string, ...args: unknown[]) {
    const { entry, ctx } = room.game;
    if (typeof entry.manager[method] !== 'function') return;
    this.contain(room, entry, `method=${method}`, () => entry.manager[method](ctx, ...args));
  }

  /**
   * Runs the Integrator's code. What it throws, or what a promise it returns rejects with, goes no further:
   * it is logged, and a sender given for that moment is answered, a `ctx.reject` with its reason and without a log.
   * `false` when it threw.
   */
  private contain(
    room: RoomRec,
    entry: Registered,
    what: string,
    run: () => unknown,
    sender: { now?: Reject; later?: Reject } = {},
  ): boolean {
    const failed = (reject?: Reject) => (error: unknown) => {
      if (reject && error instanceof GameRejection) return reject({ code: 'game', reason: error.reason });
      reject?.('failed');
      this.logError(`room=${room.id} game=${entry.definition.name} ${what}`, error);
    };
    try {
      const result = run();
      if (isThenable(result)) result.then(undefined, failed(sender.later));
      return true;
    } catch (error) {
      failed(sender.now)(error);
      return false;
    }
  }

  private logError(what: string, error: unknown) {
    this.logger.error(what, error instanceof Error ? error.stack : String(error));
  }
}

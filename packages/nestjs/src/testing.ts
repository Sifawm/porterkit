import type { GameDefinition } from '@porterkit/contracts';
import { AdminOnly, AnyTime, GameManager, handlersOf } from './decorators';
import { type Connection, Porter, type Sink } from './porter';
import type { GameContext, PorterModuleOptions, UserOf } from './types';

/** The Games the tests play. */
export type Games = {
  counter: {
    settings: { target: number };
    state: { count: number };
    userData: { clicks: number };
    client: {
      increment: undefined;
      add: { by: number };
      reset: undefined;
      peek: undefined;
      slow: undefined;
      explode: number;
    };
    server: { incremented: number; peeked: undefined };
    pauseReason: 'break' | null;
    endReason: { winner: string };
    rejectReason: 'invalidSettings' | 'tooBig';
  };
  other: {
    settings: { speed: number };
    state: { laps: number };
    userData: { lane: number };
    client: {};
    server: {};
    pauseReason: null;
    endReason: null;
    rejectReason: never;
  };
};

class CounterSettings {
  target = 3;
  set(data: { target: number }) {
    this.target = data.target;
  }
}

export const counter = {
  name: 'counter',
  minPlayers: 2,
  createSettings: () => new CounterSettings(),
  createState: () => ({ count: 0 }),
  createUserData: () => ({ clicks: 0 }),
} satisfies GameDefinition<Games, 'counter'>;

export const other = {
  name: 'other',
  minPlayers: 1,
  createSettings: () => ({
    speed: 1,
    set(data: { speed: number }) {
      this.speed = data.speed;
    },
  }),
  createState: () => ({ laps: 0 }),
  createUserData: () => ({ lane: 0 }),
} satisfies GameDefinition<Games, 'other'>;

export type Ctx = GameContext<Games, typeof counter, { secret: number }>;
const On = handlersOf<Games, 'counter'>();
const isAdd = (d: unknown): d is { by: number } => typeof (d as { by?: unknown })?.by === 'number';

/** Records every call, so a test reads what the Game was told and in which order. */
@GameManager(counter)
export class CounterManager {
  calls: string[] = [];
  ctx?: Ctx;

  defaultSettings(): { target: number } | Promise<{ target: number }> {
    return { target: 5 };
  }
  updateSettings(ctx: Ctx, next: unknown) {
    const target = (next as { target?: unknown }).target;
    if (typeof target !== 'number') throw ctx.reject('invalidSettings');
    ctx.game.settings.set({ target });
  }
  createMemory() {
    return { secret: 42 };
  }
  canStart(ctx: Ctx) {
    this.ctx = ctx;
    this.calls.push('canStart');
  }
  onStart(ctx: Ctx): void | Promise<void> {
    this.ctx = ctx;
    this.calls.push('onStart');
  }
  onPause(_ctx: Ctx, reason: unknown) {
    this.calls.push(`onPause:${JSON.stringify(reason)}`);
  }
  onContinue() {
    this.calls.push('onContinue');
  }
  onEnd(_ctx: Ctx, reason: unknown) {
    this.calls.push(`onEnd:${JSON.stringify(reason)}`);
  }
  onUserDisconnected(_ctx: Ctx, user: UserOf<Games, typeof counter>) {
    this.calls.push(`onUserDisconnected:${user.name}`);
  }
  onUserLeft(_ctx: Ctx, user: UserOf<Games, typeof counter>) {
    this.calls.push(`onUserLeft:${user.name}`);
  }

  @On('increment')
  increment(ctx: Ctx, _data: undefined, user: UserOf<Games, typeof counter>) {
    user.data.clicks += 1;
    ctx.game.state.count += 1;
    ctx.room.broadcast('incremented', ctx.game.state.count);
    if (ctx.game.state.count >= ctx.game.settings.target) ctx.endMatch({ winner: user.name });
  }

  @On('add', isAdd)
  add(ctx: Ctx, { by }: { by: number }) {
    if (by > 10) throw ctx.reject('tooBig');
    if (by < 0) throw new Error('negative');
    ctx.game.state.count += by;
  }

  @AdminOnly()
  @On('reset')
  reset(ctx: Ctx) {
    ctx.game.state.count = 0;
  }

  @AnyTime()
  @On('peek')
  peek(ctx: Ctx, _data: undefined, user: UserOf<Games, typeof counter>) {
    this.ctx = ctx;
    user.send('peeked');
  }

  @AnyTime()
  @On('explode', (data): data is number => {
    throw new Error(`guard bug: ${String(data)}`);
  })
  explode() {}

  @On('slow')
  async slow() {
    await Promise.resolve();
    throw new Error('late');
  }
}

@GameManager(other)
export class OtherManager {
  defaultSettings(): { speed: number } | Promise<{ speed: number }> {
    return { speed: 9 };
  }
  updateSettings() {}
}

type Message = { event: string; data?: any };

/** A connection as a test sees it: what arrived, and whether Porter closed it. */
export class FakeSink implements Sink {
  messages: Message[] = [];
  isClosed = false;
  // A Sink serializes at once, as a real transport does.
  send(message: Message) {
    this.messages.push(JSON.parse(JSON.stringify(message)));
  }
  close() {
    this.isClosed = true;
  }
  events() {
    return this.messages.map((m) => m.event);
  }
  last(event: string) {
    return this.messages.findLast((m) => m.event === event)?.data;
  }
  /** Forgets what has arrived so far. */
  clear() {
    this.messages = [];
  }
}

export function setup(options: Partial<PorterModuleOptions<Games>> = {}) {
  const manager = new CounterManager();
  const otherManager = new OtherManager();
  const porter = new Porter({ initialGame: 'counter', ...options }, [manager, otherManager]);

  const login = async (name: string, roomId?: string) => {
    const result = await porter.login({ name, profile: { avatar: name }, roomId });
    if (result.status !== 200) throw new Error(`login refused: ${JSON.stringify(result.body)}`);
    return result.body as { token: string; roomId: string };
  };
  const connect = (token: string) => {
    const client = {
      token,
      sink: new FakeSink(),
      connection: undefined! as Connection,
      send: (event: string, data?: unknown) =>
        client.connection.receive(data === undefined ? { event } : { event, data }),
      /** The room as Porter gives it right now. It reconnects, so the sink keeps what it had and gains a `porter:joined`. */
      joined: () => {
        const before = client.sink.messages;
        client.sink = new FakeSink();
        client.connection = porter.connect(token, client.sink);
        client.sink.messages.unshift(...before);
        return client.sink.last('porter:joined');
      },
    };
    client.connection = porter.connect(token, client.sink);
    return client;
  };
  /** Logs in and connects. The first name creates the room. */
  const join = async (name: string, roomId?: string) => {
    const { token, roomId: id } = await login(name, roomId);
    return Object.assign(connect(token), { roomId: id });
  };
  return { porter, manager, otherManager, login, connect, join };
}

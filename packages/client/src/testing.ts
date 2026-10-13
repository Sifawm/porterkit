import type { Envelope, GameDefinition, Joined } from '@porterkit/contracts';
import { vi } from 'vitest';
import { createPorter, defineGame } from './porter.js';
import type { PorterOptions, PorterStorage } from './types.js';

/** The Games the tests play. */
export type Games = {
  counter: {
    settings: { target: number };
    state: { count: number };
    userData: { clicks: number };
    client: { increment: undefined };
    server: { incremented: { by: string; count: number }; cheered: string; broken: undefined };
    pauseReason: 'break' | null;
    endReason: { winner: string };
    rejectReason: 'invalidSettings';
  };
  quiz: {
    settings: { rounds: number };
    state: { question: string };
    userData: { answer: string };
    client: { answer: { answer: string } };
    server: { asked: { question: string } };
    pauseReason: null;
    endReason: null;
    rejectReason: 'tooLate';
  };
};
export type Profile = { avatar: string };

// Classes, as an Integrator may write them: the client must hold their JSON, not the instances.
class CounterState {
  count = 0;
  double() {
    return this.count * 2;
  }
}
export const counter = {
  name: 'counter',
  minPlayers: 2,
  createSettings: () => ({
    target: 3,
    set(data: { target: number }) {
      this.target = data.target;
    },
  }),
  createState: () => new CounterState(),
  createUserData: () => ({ clicks: 0 }),
} satisfies GameDefinition<Games, 'counter'>;

export const quiz = {
  name: 'quiz',
  minPlayers: 1,
  createSettings: () => ({ rounds: 5, set() {} }),
  createState: () => ({ question: '' }),
  createUserData: () => ({ answer: '' }),
} satisfies GameDefinition<Games, 'quiz'>;

export const games = {
  counter: defineGame<Games, 'counter'>(counter, {
    incremented: (game, { by, count }) => ({
      ...game,
      state: { ...game.state, count },
      userData: { ...game.userData, [by]: { clicks: game.userData[by].clicks + 1 } },
    }),
    cheered: (game) => game,
    broken: () => {
      throw new Error('applier bug');
    },
  }),
  quiz: defineGame<Games, 'quiz'>(quiz, {
    asked: (game, { question }) => ({ ...game, state: { question } }),
  }),
};

/** The other end of a WebSocket, driven by the test. */
export class FakeSocket {
  static all: FakeSocket[] = [];
  static get last() {
    return FakeSocket.all.at(-1)!;
  }
  readyState = 1;
  sent: Envelope[] = [];
  onmessage?: (event: { data: string }) => void;
  onclose?: () => void;
  onerror?: () => void;
  constructor(readonly url: string) {
    FakeSocket.all.push(this);
  }
  send(text: string) {
    this.sent.push(JSON.parse(text));
  }
  close() {
    this.readyState = 3;
  }
  /** The server sends a message. */
  emit(event: string, data?: unknown) {
    this.onmessage?.({ data: JSON.stringify(data === undefined ? { event } : { event, data }) });
  }
  /** The connection drops. */
  drop() {
    this.readyState = 3;
    this.onclose?.();
  }
}

/** Lets what a `fetch` stream delivered reach the client. Timers are fake, so nothing else moves. */
export const settle = async () => {
  for (let i = 0; i < 5; i++) await vi.advanceTimersByTimeAsync(0);
};

/** The other end of an SSE stream, driven by the test. Its methods resolve once the client has read. */
export class FakeStream {
  static all: FakeStream[] = [];
  static get last() {
    return FakeStream.all.at(-1)!;
  }
  readonly response: Response;
  private controller!: ReadableStreamDefaultController<Uint8Array>;
  constructor(
    readonly url: string,
    private readonly init?: RequestInit,
  ) {
    FakeStream.all.push(this);
    this.response = new Response(new ReadableStream({ start: (controller) => void (this.controller = controller) }));
  }
  /** Whether the client closed it. */
  get aborted() {
    return this.init?.signal?.aborted === true;
  }
  /** The server writes to the stream, as it comes: any chunk of any text. */
  async raw(text: string) {
    this.controller.enqueue(new TextEncoder().encode(text));
    await settle();
  }
  /** The server sends a message. */
  emit(event: string, data?: unknown) {
    return this.raw(`data: ${JSON.stringify(data === undefined ? { event } : { event, data })}\n\n`);
  }
  /** The connection drops. */
  async drop() {
    this.controller.close();
    await settle();
  }
}

export function memoryStorage(): PorterStorage & { map: Map<string, string> } {
  const map = new Map<string, string>();
  return {
    map,
    getItem: (key) => map.get(key) ?? null,
    setItem: (key, value) => void map.set(key, value),
    removeItem: (key) => void map.delete(key),
  };
}

export const joined = (over: Partial<Joined<Games, Profile>> = {}): Joined<Games, Profile> => ({
  roomId: 'room000001',
  you: 'Ana',
  admin: 'Ana',
  locked: false,
  pingInterval: 30_000,
  users: [
    { name: 'Ana', profile: { avatar: 'fox' }, status: 'connected' },
    { name: 'Bea', profile: { avatar: 'owl' }, status: 'connected' },
  ],
  game: {
    name: 'counter',
    settings: { target: 3 },
    state: { count: 0 },
    userData: { Ana: { clicks: 0 }, Bea: { clicks: 0 } },
    match: { status: 'idle' },
  },
  ...over,
});

/** A client whose WebSocket and `fetch` are the test's. */
export function setup(options: Partial<PorterOptions<Games>> = {}) {
  FakeSocket.all = [];
  FakeStream.all = [];
  vi.stubGlobal('WebSocket', FakeSocket);
  /** The server's side of SSE: what was posted to `/porter/commands`, and how each request is answered. */
  const sse = {
    sent: [] as Envelope[],
    events: (url: string, init?: RequestInit): Response | Promise<Response> => new FakeStream(url, init).response,
    commands: (): Response | Promise<Response> => new Response(null, { status: 202 }),
  };
  const fetch = vi.fn(async (url: string, init?: RequestInit) => {
    if (url.includes('/porter/events')) return sse.events(url, init);
    if (url.endsWith('/porter/commands')) {
      sse.sent.push(JSON.parse(init!.body as string));
      return sse.commands();
    }
    return Response.json({ token: 'room000001.secret', roomId: 'room000001' });
  });
  vi.stubGlobal('fetch', fetch);
  const storage = memoryStorage();
  const porter = createPorter<Games, Profile>({
    httpUrl: '/api',
    wsUrl: 'ws://test/porter/ws',
    games,
    storage,
    ...options,
  } as PorterOptions<Games>);

  /** Logs in and receives `porter:joined`. */
  const connected = async (over?: Partial<Joined<Games, Profile>>) => {
    await porter.login({ name: 'Ana', profile: { avatar: 'fox' } });
    FakeSocket.last.emit('porter:joined', joined(over));
    return FakeSocket.last;
  };
  return { porter, fetch, storage, connected, sse };
}

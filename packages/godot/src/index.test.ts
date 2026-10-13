import { createPorter, defineGame } from '@porterkit/client';
import { FakeSocket, memoryStorage } from '@porterkit/client/testing';
import type { GameDefinition, Joined } from '@porterkit/contracts';
import { afterEach, expect, test, vi } from 'vitest';
import { exposeToGodot } from './index.js';

type Games = {
  counter: {
    settings: { target: number };
    state: { count: number };
    userData: { clicks: number };
    client: { increment: undefined; cheer: { who: string } };
    server: { incremented: { by: string; count: number }; cheered: string; rested: undefined };
    pauseReason: null;
    endReason: null;
    rejectReason: never;
  };
};

const counter = {
  name: 'counter',
  minPlayers: 2,
  createSettings: () => ({ target: 3, set() {} }),
  createState: () => ({ count: 0 }),
  createUserData: () => ({ clicks: 0 }),
} satisfies GameDefinition<Games, 'counter'>;

const joined: Joined<Games, null> = {
  roomId: 'room000001',
  you: 'Ana',
  admin: 'Ana',
  locked: false,
  pingInterval: 30_000,
  users: [{ name: 'Ana', profile: null, status: 'connected' }],
  game: {
    name: 'counter',
    settings: { target: 3 },
    state: { count: 0 },
    userData: { Ana: { clicks: 0 } },
    match: { status: 'idle' },
  },
};

/** The real client over a fake WebSocket, and what Godot would be told. */
function setup() {
  FakeSocket.all = [];
  vi.stubGlobal('WebSocket', FakeSocket);
  const storage = memoryStorage();
  const porter = createPorter<Games, null>({
    httpUrl: '/api',
    wsUrl: 'ws://test/porter/ws',
    storage,
    games: {
      counter: defineGame<Games, 'counter'>(counter, {
        incremented: (game, { count }) => ({ ...game, state: { count } }),
      }),
    },
  });
  const godot = exposeToGodot(porter);
  const told: Record<string, unknown>[] = [];
  const connected = () => {
    storage.map.set('porter', '{"token":"room000001.secret","roomId":"room000001"}');
    godot.resume();
    FakeSocket.last.emit('porter:joined', joined);
    return FakeSocket.last;
  };
  return {
    porter,
    godot,
    told,
    connected,
    watch: () => godot.subscribe((json) => void told.push(JSON.parse(json))),
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

test('it leaves the facade where the addon looks for it', () => {
  const { godot } = setup();
  expect((globalThis as { porterGodot?: unknown }).porterGodot).toBe(godot);
});

test('a subscriber is told the three parts at once, as JSON, and null where there is no room', () => {
  const { told, watch } = setup();
  watch();
  expect(told).toEqual([{ connection: { status: 'idle' }, room: null, game: null }]);
});

test('after a change a subscriber is told, in one call, only the parts that changed', () => {
  const { told, watch, connected } = setup();
  watch();
  told.length = 0;
  const socket = connected();
  expect(told).toEqual([
    { connection: { status: 'connecting' } },
    {
      connection: { status: 'connected' },
      room: expect.objectContaining({ id: 'room000001', isAdmin: true, you: expect.objectContaining({ name: 'Ana' }) }),
      game: expect.objectContaining({ name: 'counter', state: { count: 0 }, match: { status: 'idle' } }),
    },
  ]);

  told.length = 0;
  socket.emit('porter:roomLocked', { locked: true });
  expect(told).toEqual([{ room: expect.objectContaining({ locked: true }) }]);

  told.length = 0;
  socket.emit('incremented', { by: 'Ana', count: 1 });
  expect(told).toEqual([{ game: expect.objectContaining({ state: { count: 1 } }) }]);

  told.length = 0;
  socket.emit('cheered', 'Ana');
  socket.emit('porter:roomLocked', { locked: true });
  expect(told).toEqual([]);
});

test('a listener hears the data of its event as JSON, until it is taken off', () => {
  const { godot, connected } = setup();
  const socket = connected();
  const heard: string[] = [];
  const id = godot.on('cheered', (json) => heard.push(json));
  const rested = godot.on('rested', (json) => heard.push(json));
  socket.emit('cheered', 'Bea');
  socket.emit('rested');
  expect(heard).toEqual(['"Bea"', 'null']);

  godot.off(id);
  socket.emit('cheered', 'Bea');
  expect(heard).toHaveLength(2);
  expect(rested).not.toBe(id);
});

test('send takes the data as JSON, or none, and tells whether it was sent', () => {
  const { godot, connected } = setup();
  expect(godot.send('increment')).toBe(false);
  const socket = connected();
  expect(godot.send('increment')).toBe(true);
  expect(godot.send('cheer', '{"who":"Bea"}')).toBe(true);
  expect(socket.sent).toEqual([{ event: 'increment' }, { event: 'cheer', data: { who: 'Bea' } }]);
});

test('login answers with the result as JSON, and with null when the request itself fails', async () => {
  const { godot } = setup();
  const fetch = vi.fn<(url: string, init?: RequestInit) => Promise<Response>>();
  vi.stubGlobal('fetch', fetch);
  const answer = (json: string) => new Promise<string>((done) => godot.login(json, done));

  fetch.mockResolvedValueOnce(Response.json({ token: 'room000001.secret', roomId: 'room000001' }));
  expect(JSON.parse(await answer('{"name":"Ana","profile":null}'))).toEqual({ ok: true, roomId: 'room000001' });
  expect(JSON.parse(fetch.mock.calls[0][1]!.body as string)).toEqual({ name: 'Ana', profile: null });

  fetch.mockResolvedValueOnce(Response.json({ reason: 'nameTaken' }, { status: 409 }));
  expect(JSON.parse(await answer('{"name":"Ana","profile":null}'))).toEqual({ ok: false, reason: 'nameTaken' });

  fetch.mockRejectedValueOnce(new TypeError('offline'));
  expect(await answer('{"name":"Ana","profile":null}')).toBe('null');
});

test('roomExists answers with a boolean, and with null when the request itself fails', async () => {
  const { godot } = setup();
  const fetch = vi.fn<() => Promise<Response>>();
  vi.stubGlobal('fetch', fetch);
  const answer = () => new Promise<boolean | null>((done) => godot.roomExists('room000001', done));

  fetch.mockResolvedValueOnce(new Response(null, { status: 200 }));
  expect(await answer()).toBe(true);
  fetch.mockResolvedValueOnce(new Response(null, { status: 404 }));
  expect(await answer()).toBe(false);
  fetch.mockRejectedValueOnce(new TypeError('offline'));
  expect(await answer()).toBeNull();
});

test('timerRemaining is the milliseconds left, and -1 without a timer of that name', () => {
  vi.useFakeTimers();
  const { godot, connected } = setup();
  const socket = connected();
  expect(godot.timerRemaining('round')).toBe(-1);
  socket.emit('porter:matchStarted');
  socket.emit('porter:timerSet', { name: 'round', remaining: 5000 });
  vi.advanceTimersByTime(1000);
  expect(godot.timerRemaining('round')).toBe(4000);
});

test('resume, reconnect and leave are the instance’s own', () => {
  const { porter, godot, connected } = setup();
  expect(godot.resume()).toBe(false);
  connected();
  godot.reconnect();
  expect(porter.connection).toEqual({ status: 'connected' });
  godot.leave();
  expect(porter.connection).toEqual({ status: 'closed', reason: 'left' });
});

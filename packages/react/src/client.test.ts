import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { createPorter } from './porter.js';
import { FakeSocket, type Games, games, joined, setup } from './testing.js';

beforeEach(() => void vi.useFakeTimers());
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

test('creating the instance has no effect', () => {
  const { porter, fetch, storage } = setup();
  expect(porter.connection).toEqual({ status: 'idle' });
  expect(porter.room).toBeNull();
  expect(fetch).not.toHaveBeenCalled();
  expect(storage.map.size).toBe(0);
  expect(FakeSocket.all).toHaveLength(0);
  vi.unstubAllGlobals();
  expect(() => createPorter<Games>({ httpUrl: '/api', transport: 'sse', games })).not.toThrow();
});

test('an accepted login stores the Token and connects; connected begins with porter:joined', async () => {
  const { porter, fetch, storage } = setup();
  const result = await porter.login({ name: 'Ana', profile: { avatar: 'fox' } });

  expect(result).toEqual({ ok: true, roomId: 'room000001' });
  expect(fetch.mock.calls[0][0]).toBe('/api/porter/login');
  expect(JSON.parse(fetch.mock.calls[0][1]!.body as string)).toEqual({ name: 'Ana', profile: { avatar: 'fox' } });
  expect(storage.map.get('porter')).toBe('{"token":"room000001.secret","roomId":"room000001"}');
  expect(FakeSocket.last.url).toBe('ws://test/porter/ws?token=room000001.secret');
  expect(porter.connection).toEqual({ status: 'connecting' });

  FakeSocket.last.emit('porter:joined', joined());
  expect(porter.connection).toEqual({ status: 'connected' });
  expect(porter.room).toMatchObject({ id: 'room000001', admin: 'Ana', isAdmin: true, locked: false });
  expect(porter.room!.you).toEqual({
    name: 'Ana',
    profile: { avatar: 'fox' },
    status: 'connected',
    data: { clicks: 0 },
  });
});

test('a rejected login resolves with its reason and leaves everything as it was', async () => {
  const { porter, fetch, connected } = setup();
  await connected();
  fetch.mockResolvedValueOnce(Response.json({ reason: 'nameTaken' }, { status: 409 }));
  expect(await porter.login({ name: 'Ana', profile: { avatar: 'fox' } })).toEqual({ ok: false, reason: 'nameTaken' });
  expect(porter.connection).toEqual({ status: 'connected' });
  expect(FakeSocket.all).toHaveLength(1);

  fetch.mockRejectedValueOnce(new TypeError('network'));
  await expect(porter.login({ name: 'Ana', profile: { avatar: 'fox' } })).rejects.toThrow('network');
});

test('an accepted login while a room is open replaces it', async () => {
  const { porter, fetch, connected } = setup();
  const first = await connected();
  fetch.mockResolvedValueOnce(Response.json({ token: 'room000002.other', roomId: 'room000002' }));
  await porter.login({ name: 'Ana', profile: { avatar: 'fox' } });
  expect(first.readyState).toBe(3);
  expect(porter.connection).toEqual({ status: 'connecting' });
  expect(porter.room).toBeNull();
  expect(FakeSocket.last.url).toContain('room000002.other');
});

test('resume connects with the stored Token, and a stored value that is no Token is removed', () => {
  const { porter, storage } = setup();
  expect(porter.resume()).toBe(false);
  storage.map.set('porter', 'not json');
  expect(porter.resume()).toBe(false);
  storage.map.set('porter', '{"token":"x"}');
  expect(porter.resume()).toBe(false);
  expect(storage.map.size).toBe(0);

  storage.map.set('porter', '{"token":"room000001.secret","roomId":"room000001"}');
  expect(porter.resume()).toBe(true);
  expect(porter.resume()).toBe(true); // as an effect does under StrictMode
  expect(FakeSocket.all).toHaveLength(1);
  expect(porter.connection).toEqual({ status: 'connecting' });
});

test('roomExists is true on 200 and false on 404', async () => {
  const { porter, fetch } = setup();
  fetch.mockResolvedValueOnce(new Response(null, { status: 200 }));
  expect(await porter.roomExists('room000001')).toBe(true);
  expect(fetch.mock.calls[0]).toEqual(['/api/porter/rooms/room000001', { method: 'HEAD' }]);
  fetch.mockResolvedValueOnce(new Response(null, { status: 404 }));
  expect(await porter.roomExists('nope')).toBe(false);
});

test('send does nothing unless connected, and changes no state', async () => {
  const { porter, connected } = setup();
  expect(porter.send('increment')).toBe(false);
  const socket = await connected();
  const room = porter.room;
  expect(porter.send('porter:lockRoom', { locked: true })).toBe(true);
  expect(porter.send('increment')).toBe(true);
  expect(socket.sent).toEqual([{ event: 'porter:lockRoom', data: { locked: true } }, { event: 'increment' }]);
  expect(porter.room).toBe(room);
});

test('a ping is answered with a pong and is not visible', async () => {
  const { porter, connected } = setup();
  const socket = await connected();
  const onChange = vi.fn();
  const listener = vi.fn();
  porter.subscribe(onChange);
  porter.on('porter:ping' as never, listener);
  socket.emit('porter:ping');
  expect(socket.sent).toEqual([{ event: 'porter:pong' }]);
  expect(onChange).not.toHaveBeenCalled();
  expect(listener).not.toHaveBeenCalled();
});

test("each of Porter's messages leaves the state the protocol says", async () => {
  const { porter, connected } = setup();
  const socket = await connected();

  socket.emit('porter:userJoined', { user: { name: 'Cleo', profile: { avatar: 'cat' }, status: 'connected' } });
  expect(porter.room!.users.map((u) => u.name)).toEqual(['Ana', 'Bea', 'Cleo']);
  expect(porter.game('counter').userData.Cleo).toEqual({ clicks: 0 });

  socket.emit('porter:userDisconnected', { name: 'Bea' });
  expect(porter.room!.users[1].status).toBe('reconnecting');
  socket.emit('porter:userReconnected', { name: 'Bea' });
  expect(porter.room!.users[1].status).toBe('connected');

  socket.emit('porter:userLeft', { name: 'Cleo', reason: 'timeout' });
  expect(porter.room!.users.map((u) => u.name)).toEqual(['Ana', 'Bea']);
  expect(porter.game().userData).toEqual({ Ana: { clicks: 0 }, Bea: { clicks: 0 } });

  socket.emit('porter:adminChanged', { admin: 'Bea' });
  expect(porter.room).toMatchObject({ admin: 'Bea', isAdmin: false });
  socket.emit('porter:roomLocked', { locked: true });
  expect(porter.room!.locked).toBe(true);
  socket.emit('porter:settingsUpdated', { target: 9 });
  expect(porter.game('counter').settings).toEqual({ target: 9 });

  socket.emit('porter:matchStarted');
  socket.emit('incremented', { by: 'Bea', count: 1 });
  expect(porter.game('counter')).toMatchObject({
    match: { status: 'running' },
    state: { count: 1 },
    userData: { Ana: { clicks: 0 }, Bea: { clicks: 1 } },
  });
  socket.emit('porter:matchPaused', { reason: 'break' });
  expect(porter.room!.game.match).toEqual({ status: 'paused', reason: 'break' });
  socket.emit('porter:matchContinued');
  socket.emit('porter:matchEnded', { reason: { by: 'admin' } });
  expect(porter.game().match).toEqual({ status: 'ended', reason: { by: 'admin' } });
  expect(porter.game('counter').state.count).toBe(1);

  socket.emit('porter:matchStarted');
  expect(porter.game('counter')).toMatchObject({
    settings: { target: 9 },
    state: { count: 0 },
    match: { status: 'running' },
  });
  expect(porter.game('counter').userData.Bea).toEqual({ clicks: 0 });

  socket.emit('porter:matchEnded', { reason: { by: 'admin' } });
  socket.emit('porter:gameChanged', { game: 'quiz', settings: { rounds: 7 } });
  expect(porter.game()).toMatchObject({
    name: 'quiz',
    settings: { rounds: 7 },
    state: { question: '' },
    userData: { Ana: { answer: '' }, Bea: { answer: '' } },
    match: { status: 'idle' },
  });
  expect(() => porter.game('counter')).toThrow(/quiz/);
});

test('what comes new from the Game definition is plain data, never an instance', async () => {
  const { porter, connected } = setup();
  const socket = await connected();
  socket.emit('porter:matchStarted');
  const state = porter.game('counter').state;
  expect(Object.getPrototypeOf(state)).toBe(Object.prototype);
  expect(state).toEqual({ count: 0 });
});

test('what a message does not touch keeps its identity', async () => {
  const { porter, connected } = setup();
  const socket = await connected();
  const before = porter.game('counter');
  const [ana, bea] = porter.room!.users;

  socket.emit('incremented', { by: 'Bea', count: 1 });
  const after = porter.game('counter');
  expect(after.settings).toBe(before.settings);
  expect(after.users[0]).toBe(ana);
  expect(after.users[1]).not.toBe(bea);
  expect(after.users[1].data).toEqual({ clicks: 1 });

  socket.emit('porter:roomLocked', { locked: true });
  expect(porter.room!.users).toBe(after.users);
  expect(porter.room!.you).toBe(ana);

  // A change of the Game alone leaves the room as it was.
  const room = porter.room;
  socket.emit('porter:settingsUpdated', { target: 4 });
  expect(porter.room).toBe(room);
});

test("one of Porter's messages that repeats what the client holds notifies nobody", async () => {
  const { porter, connected } = setup();
  const socket = await connected();
  const onChange = vi.fn();
  porter.subscribe(onChange);
  socket.emit('porter:roomLocked', { locked: false });
  socket.emit('porter:adminChanged', { admin: 'Ana' });
  socket.emit('porter:userReconnected', { name: 'Bea' });
  expect(onChange).not.toHaveBeenCalled();
});

test('after a drop while connected the waits are 500 ms and then 650 ms', async () => {
  const { connected } = setup();
  const socket = await connected();
  socket.drop();
  vi.advanceTimersByTime(500);
  expect(FakeSocket.all).toHaveLength(2);
  FakeSocket.last.drop();
  vi.advanceTimersByTime(649);
  expect(FakeSocket.all).toHaveLength(2);
  vi.advanceTimersByTime(1);
  expect(FakeSocket.all).toHaveLength(3);
});

test('a message is applied, then subscribers are notified, then listeners hear it', async () => {
  const { porter, connected } = setup();
  const socket = await connected();
  const order: string[] = [];
  porter.subscribe(() => order.push(`notified:${porter.game('counter').state.count}`));
  porter.on('incremented', ({ count }) => order.push(`heard:${count}:${porter.game('counter').state.count}`));
  socket.emit('incremented', { by: 'Ana', count: 1 });
  expect(order).toEqual(['notified:1', 'heard:1:1']);
});

test('a message that changes nothing notifies nobody and still reaches its listeners', async () => {
  const { porter, connected } = setup();
  const socket = await connected();
  const onChange = vi.fn();
  const heard: unknown[] = [];
  porter.subscribe(onChange);
  porter.on('cheered', (who) => heard.push(who));
  const off = porter.on('porter:messageRejected', (rejection) => heard.push(rejection.reason));

  socket.emit('cheered', 'Bea'); // its Applier returns what it received
  socket.emit('porter:messageRejected', { rejected: 'increment', reason: 'notAllowedNow' });
  off();
  socket.emit('porter:messageRejected', { rejected: 'increment', reason: 'notAllowedNow' });
  expect(onChange).not.toHaveBeenCalled();
  expect(heard).toEqual(['Bea', 'notAllowedNow']);
});

test('an Applier or a listener that throws is caught and reported; the others go on', async () => {
  const { porter, connected } = setup();
  const socket = await connected();
  const error = vi.spyOn(console, 'error').mockImplementation(() => {});
  const onChange = vi.fn();
  const heard = vi.fn();
  porter.subscribe(onChange);
  porter.on('broken', () => {
    throw new Error('listener bug');
  });
  porter.on('broken', heard);
  const before = porter.game();

  socket.emit('broken');
  expect(porter.game()).toBe(before);
  expect(onChange).not.toHaveBeenCalled();
  expect(heard).toHaveBeenCalledTimes(1);
  expect(error.mock.calls.map((c) => c[0])).toEqual([
    expect.stringMatching(/Applier.*broken.*counter/),
    expect.stringMatching(/listener.*broken/),
  ]);
  expect(porter.connection).toEqual({ status: 'connected' });
});

test('a Game message goes to the Appliers of the active Game only', async () => {
  const { porter, connected } = setup();
  const socket = await connected();
  const before = porter.game();
  socket.emit('asked', { question: '?' });
  expect(porter.game()).toBe(before);
});

test.each([
  ['porter:kicked', undefined, 'kicked'],
  ['porter:replaced', undefined, 'replaced'],
  ['porter:rejected', { reason: 'notInRoom' }, 'notInRoom'],
])('%s is final: closed, the Token forgotten, never retried, the room still readable', async (event, data, reason) => {
  const { porter, storage, connected } = setup();
  const socket = await connected();
  socket.emit(event, data);
  socket.drop();
  vi.advanceTimersByTime(60_000);
  expect(porter.connection).toEqual({ status: 'closed', reason });
  expect(storage.map.size).toBe(0);
  expect(FakeSocket.all).toHaveLength(1);
  expect(porter.room!.id).toBe('room000001');
  expect(porter.resume()).toBe(false);
});

test('leave closes the connection, forgets the Token and the room', async () => {
  const { porter, storage, connected } = setup();
  porter.leave();
  expect(porter.connection).toEqual({ status: 'idle' });

  const socket = await connected();
  const onChange = vi.fn();
  porter.subscribe(onChange);
  porter.leave();
  expect(socket.readyState).toBe(3);
  expect(porter.connection).toEqual({ status: 'closed', reason: 'left' });
  expect(porter.room).toBeNull();
  expect(() => porter.game()).toThrow();
  expect(storage.map.size).toBe(0);
  expect(onChange).toHaveBeenCalledTimes(1);
});

test('a dropped connection is retried, and porter:joined replaces everything', async () => {
  const { porter, connected } = setup();
  const socket = await connected();
  socket.drop();
  expect(porter.connection).toEqual({ status: 'reconnecting' });
  expect(porter.room).not.toBeNull();
  expect(porter.send('increment')).toBe(false);

  vi.advanceTimersByTime(500);
  expect(FakeSocket.all).toHaveLength(2);
  FakeSocket.last.emit('porter:joined', joined({ locked: true, admin: 'Bea' }));
  expect(porter.connection).toEqual({ status: 'connected' });
  expect(porter.room).toMatchObject({ locked: true, admin: 'Bea', isAdmin: false });
});

test('retries wait 500 ms, then 1.3 times longer each, up to 2 s; maxRetries failures in a row is unreachable', async () => {
  const attempts: number[] = [];
  const { porter, storage } = setup({
    maxRetries: 8,
    transport: ({ attempt }) => (attempts.push(attempt), 'ws'),
  });
  await porter.login({ name: 'Ana', profile: { avatar: 'fox' } });

  const waits: number[] = [];
  for (let i = 0; i < 7; i++) {
    FakeSocket.last.drop();
    expect(porter.connection).toEqual({ status: 'connecting' });
    const before = Date.now();
    const sockets = FakeSocket.all.length;
    while (FakeSocket.all.length === sockets) vi.advanceTimersByTime(1);
    waits.push(Date.now() - before);
  }
  expect(waits).toEqual([500, 650, 845, 1098, 1428, 1856, 2000]);
  expect(attempts).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);

  FakeSocket.last.drop();
  expect(porter.connection).toEqual({ status: 'closed', reason: 'unreachable' });
  expect(storage.map.has('porter')).toBe(true);

  porter.reconnect();
  expect(attempts.at(-1)).toBe(0);
  FakeSocket.last.emit('porter:joined', joined());
  expect(porter.connection).toEqual({ status: 'connected' });
  porter.reconnect();
  expect(FakeSocket.all).toHaveLength(9);
});

test('porter:joined sets the count of failures back to zero', async () => {
  const attempts: number[] = [];
  const { connected } = setup({ transport: ({ attempt }) => (attempts.push(attempt), 'ws') });
  await connected();
  FakeSocket.last.drop();
  vi.advanceTimersByTime(500);
  FakeSocket.last.drop();
  vi.advanceTimersByTime(650);
  FakeSocket.last.emit('porter:joined', joined());
  FakeSocket.last.drop();
  vi.advanceTimersByTime(500);
  expect(attempts).toEqual([0, 0, 1, 0]);
});

test('a connection silent for two ping intervals is taken as dropped', async () => {
  const { porter, connected } = setup();
  const socket = await connected({ pingInterval: 1000 });
  vi.advanceTimersByTime(1500);
  socket.emit('porter:ping');
  vi.advanceTimersByTime(1999);
  expect(porter.connection).toEqual({ status: 'connected' });
  vi.advanceTimersByTime(1);
  expect(porter.connection).toEqual({ status: 'reconnecting' });
  expect(socket.readyState).toBe(3);
});

test('a timer counts down from what the server sent, freezes with a pause and dies with the Match', async () => {
  const { porter, connected } = setup();
  const socket = await connected();
  expect(porter.timer('round')).toBeNull();
  socket.emit('porter:matchStarted');
  socket.emit('porter:timerSet', { name: 'round', remaining: 1000 });
  vi.advanceTimersByTime(400);
  expect(porter.timer('round')).toMatchObject({ paused: false });
  expect(porter.timer('round')!.remaining()).toBe(600);

  socket.emit('porter:matchPaused', { reason: null });
  vi.advanceTimersByTime(5000);
  expect(porter.timer('round')!.paused).toBe(true);
  expect(porter.timer('round')!.remaining()).toBe(600);

  socket.emit('porter:matchContinued');
  vi.advanceTimersByTime(5000);
  expect(porter.timer('round')!.remaining()).toBe(0);

  socket.emit('porter:timerCleared', { name: 'round' });
  expect(porter.timer('round')).toBeNull();
  socket.emit('porter:timerSet', { name: 'round', remaining: 1000 });
  socket.emit('porter:matchEnded', { reason: { by: 'admin' } });
  expect(porter.timer('round')).toBeNull();
});

test('porter:joined brings the timers of a Match under way, frozen when it is paused', async () => {
  const { porter, connected } = setup();
  await connected({
    game: {
      name: 'counter',
      settings: { target: 3 },
      state: { count: 0 },
      userData: { Ana: { clicks: 0 }, Bea: { clicks: 0 } },
      match: { status: 'paused', reason: 'break', timers: { round: 700 } },
    },
  });
  expect(porter.room!.game.match).toEqual({ status: 'paused', reason: 'break' });
  expect(porter.timer('round')).toMatchObject({ paused: true });
  expect(porter.timer('round')!.remaining()).toBe(700);
});

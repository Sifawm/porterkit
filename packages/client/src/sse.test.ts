import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { FakeStream, joined, settle, setup } from './fixtures.js';

beforeEach(() => void vi.useFakeTimers());
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

/** A client over SSE that has logged in. Its stream is open and has carried nothing yet. */
async function opened() {
  const client = setup({ transport: 'sse' });
  await client.porter.login({ name: 'Ana', profile: { avatar: 'fox' } });
  await settle();
  return client;
}

/** Logs in and receives `porter:joined`. */
async function connected() {
  const client = await opened();
  await FakeStream.last.emit('porter:joined', joined());
  return { ...client, stream: FakeStream.last };
}

test('the stream is opened with the Token, and connected begins with porter:joined', async () => {
  const { porter, fetch } = await opened();
  expect(fetch.mock.calls[1][0]).toBe('/api/porter/events?token=room000001.secret');
  expect(porter.connection).toEqual({ status: 'connecting' });

  await FakeStream.last.emit('porter:joined', joined());
  expect(porter.connection).toEqual({ status: 'connected' });
  expect(porter.room).toMatchObject({ id: 'room000001', admin: 'Ana' });
});

test('only data means anything: the padding, comments and other fields are dropped, however the chunks fall', async () => {
  const { porter, stream } = await connected();
  const heard: unknown[] = [];
  porter.on('incremented', (data) => heard.push(data));
  const one = JSON.stringify({ event: 'incremented', data: { by: 'Ana', count: 1 } });
  const two = JSON.stringify({ event: 'incremented', data: { by: 'Bea', count: 2 } });

  await stream.raw(`data: :${' '.repeat(2048)}\n\n`);
  await stream.raw(': a comment\n\n');
  await stream.raw(`event: message\nid: 7\nretry: 100\ndata: ${one}\n\n`);
  expect(heard).toEqual([{ by: 'Ana', count: 1 }]);

  await stream.raw(`data:${two.slice(0, 10)}`);
  expect(heard).toHaveLength(1);
  await stream.raw(`${two.slice(10)}\r\n\r\ndata: ${one}\n`);
  expect(heard).toEqual([
    { by: 'Ana', count: 1 },
    { by: 'Bea', count: 2 },
  ]);
  await stream.raw('\n');
  expect(heard).toHaveLength(3);
  expect(porter.connection).toEqual({ status: 'connected' });
});

test('a stream that ends is a dropped connection, and it is retried', async () => {
  const { porter, stream } = await connected();
  await stream.drop();
  expect(porter.connection).toEqual({ status: 'reconnecting' });
  expect(porter.room).not.toBeNull();

  await vi.advanceTimersByTimeAsync(500);
  expect(FakeStream.all).toHaveLength(2);
  await FakeStream.last.emit('porter:joined', joined({ locked: true }));
  expect(porter.connection).toEqual({ status: 'connected' });
  expect(porter.room!.locked).toBe(true);
});

test.each([
  ['answers 500', () => new Response(null, { status: 500 })],
  ['fails', () => Promise.reject(new TypeError('network'))],
])('a stream whose request %s is a failed attempt, and it is retried', async (_what, events) => {
  const client = setup({ transport: 'sse' });
  const open = client.sse.events;
  client.sse.events = events;
  await client.porter.login({ name: 'Ana', profile: { avatar: 'fox' } });
  await settle();
  expect(client.porter.connection).toEqual({ status: 'connecting' });
  expect(FakeStream.all).toHaveLength(0);

  client.sse.events = open;
  await vi.advanceTimersByTimeAsync(500);
  expect(FakeStream.all).toHaveLength(1);
});

test('porter:rejected on the stream closes with its reason and is not retried', async () => {
  const { porter, storage } = await opened();
  await FakeStream.last.emit('porter:rejected', { reason: 'notInRoom' });
  expect(porter.connection).toEqual({ status: 'closed', reason: 'notInRoom' });
  expect(FakeStream.last.aborted).toBe(true);
  expect(storage.map.size).toBe(0);

  await vi.advanceTimersByTimeAsync(5000);
  expect(FakeStream.all).toHaveLength(1);
});

test('a message is one POST with the Token, and a ping is answered with a pong the same way', async () => {
  const { porter, fetch, sse, stream } = await connected();
  expect(porter.send('porter:lockRoom', { locked: true })).toBe(true);
  await settle();
  expect(fetch.mock.calls.at(-1)).toEqual([
    '/api/porter/commands',
    {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: 'Bearer room000001.secret' },
      body: JSON.stringify({ event: 'porter:lockRoom', data: { locked: true } }),
    },
  ]);

  await stream.emit('porter:ping');
  expect(sse.sent).toEqual([{ event: 'porter:lockRoom', data: { locked: true } }, { event: 'porter:pong' }]);
});

test('a message is posted once the one before it has been answered, so they arrive in the order sent', async () => {
  const { porter, sse } = await connected();
  const answer: (() => void)[] = [];
  sse.commands = () => new Promise((resolve) => answer.push(() => resolve(new Response(null, { status: 202 }))));

  porter.send('porter:startMatch');
  porter.send('increment');
  await settle();
  expect(sse.sent).toEqual([{ event: 'porter:startMatch' }]);

  answer[0]();
  await settle();
  expect(sse.sent).toEqual([{ event: 'porter:startMatch' }, { event: 'increment' }]);
});

test('a 401 on a message closes with the reason of its body and is not retried', async () => {
  const { porter, sse, stream } = await connected();
  sse.commands = () => Response.json({ reason: 'notInRoom' }, { status: 401 });
  porter.send('increment');
  await settle();
  expect(porter.connection).toEqual({ status: 'closed', reason: 'notInRoom' });
  expect(stream.aborted).toBe(true);

  await vi.advanceTimersByTimeAsync(5000);
  expect(FakeStream.all).toHaveLength(1);
});

test.each([
  ['answers 409 with notConnected', () => Response.json({ reason: 'notConnected' }, { status: 409 })],
  ['answers 500', () => new Response(null, { status: 500 })],
  ['fails', () => Promise.reject(new TypeError('network'))],
])(
  'a message whose request %s is a dropped connection: the message is lost and the client retries',
  async (_what, commands) => {
    const { porter, sse, stream } = await connected();
    const accept = sse.commands;
    sse.commands = commands;
    porter.send('increment');
    porter.send('increment');
    await settle();
    expect(porter.connection).toEqual({ status: 'reconnecting' });
    expect(stream.aborted).toBe(true);
    expect(sse.sent).toHaveLength(1);

    sse.commands = accept;
    await vi.advanceTimersByTimeAsync(500);
    expect(FakeStream.all).toHaveLength(2);
    expect(sse.sent).toHaveLength(1);
  },
);

test('leave closes the stream', async () => {
  const { porter, stream } = await connected();
  porter.leave();
  expect(stream.aborted).toBe(true);
  expect(porter.connection).toEqual({ status: 'closed', reason: 'left' });

  await stream.emit('porter:roomLocked', { locked: true });
  expect(porter.room).toBeNull();
});

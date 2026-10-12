import { expect, test, vi } from 'vitest';
import { setup } from './testing';

test('connecting with a Token is joining: porter:joined carries the whole room', async () => {
  const { join } = setup({ pingInterval: 5000 });
  const ana = await join('Ana');
  expect(ana.sink.messages).toEqual([
    {
      event: 'porter:joined',
      data: {
        roomId: ana.roomId,
        you: 'Ana',
        admin: 'Ana',
        locked: false,
        pingInterval: 5000,
        users: [{ name: 'Ana', profile: { avatar: 'Ana' }, status: 'connected' }],
        game: {
          name: 'counter',
          settings: { target: 5 },
          state: { count: 0 },
          userData: { Ana: { clicks: 0 } },
          match: { status: 'idle' },
        },
      },
    },
  ]);
});

test('a User is visible to the others only once it connects', async () => {
  const { join, login, connect } = setup();
  const ana = await join('Ana');
  const { token } = await login('Bea', ana.roomId);
  expect(ana.sink.events()).toEqual(['porter:joined']);

  const bea = connect(token);
  expect(ana.sink.last('porter:userJoined')).toEqual({
    user: { name: 'Bea', profile: { avatar: 'Bea' }, status: 'connected' },
  });
  expect(bea.sink.events()).toEqual(['porter:joined']);
  expect(bea.sink.last('porter:joined').users.map((u: { name: string }) => u.name)).toEqual(['Ana', 'Bea']);
  expect(Object.keys(bea.sink.last('porter:joined').game.userData)).toEqual(['Ana', 'Bea']);
});

test.each([
  ['nonsense', 'invalidToken'],
  [undefined, 'invalidToken'],
  ['aaaaaaaaaa.' + 'A'.repeat(43), 'roomNotFound'],
])('the Token %j is rejected with %s and the connection closed', (token, reason) => {
  const { porter, connect } = setup();
  const { sink } = connect(token as string);
  expect(sink.messages).toEqual([{ event: 'porter:rejected', data: { reason } }]);
  expect(sink.isClosed).toBe(true);
  expect(porter.command(token, { event: 'x' })).toEqual({ status: 401, body: { reason } });
});

test('a Token nobody in the room holds is notInRoom', async () => {
  const { join, connect } = setup();
  const ana = await join('Ana');
  const { sink } = connect(`${ana.roomId}.${'A'.repeat(43)}`);
  expect(sink.messages).toEqual([{ event: 'porter:rejected', data: { reason: 'notInRoom' } }]);
});

test('a dropped connection makes the User reconnecting, and it comes back within its Grace period', async () => {
  const { join, connect } = setup({ gracePeriod: 1000 });
  const ana = await join('Ana');
  const bea = await join('Bea', ana.roomId);
  ana.sink.clear();

  bea.connection.closed();
  expect(ana.sink.messages).toEqual([{ event: 'porter:userDisconnected', data: { name: 'Bea' } }]);

  vi.advanceTimersByTime(999);
  const back = connect(bea.token);
  expect(back.sink.last('porter:joined').users).toMatchObject([{ name: 'Ana' }, { name: 'Bea', status: 'connected' }]);
  expect(ana.sink.events()).toEqual(['porter:userDisconnected', 'porter:userReconnected']);

  vi.advanceTimersByTime(5000);
  expect(ana.sink.events()).not.toContain('porter:userLeft');
});

test('a reconnecting User whose Grace period runs out leaves with timeout, and its Token is worth nothing', async () => {
  const { porter, join, connect } = setup({ gracePeriod: 1000 });
  const ana = await join('Ana');
  const bea = await join('Bea', ana.roomId);
  bea.connection.closed();
  vi.advanceTimersByTime(1000);

  expect(ana.sink.last('porter:userLeft')).toEqual({ name: 'Bea', reason: 'timeout' });
  expect(connect(bea.token).sink.last('porter:rejected')).toEqual({ reason: 'notInRoom' });
  expect(await porter.login({ name: 'Bea', roomId: ana.roomId })).toMatchObject({ status: 200 });
});

test('the room ceases to exist when its last User leaves', async () => {
  const { porter, join } = setup({ gracePeriod: 1000 });
  const ana = await join('Ana');
  ana.connection.closed();
  vi.advanceTimersByTime(1000);
  expect(porter.roomExists(ana.roomId)).toBe(false);
});

test('a second connection replaces the first and nobody else is told', async () => {
  const { join, connect } = setup();
  const ana = await join('Ana');
  const bea = await join('Bea', ana.roomId);
  ana.sink.clear();

  const second = connect(bea.token);
  expect(bea.sink.messages.at(-1)).toEqual({ event: 'porter:replaced' });
  expect(bea.sink.isClosed).toBe(true);
  expect(second.sink.events()).toEqual(['porter:joined']);
  expect(ana.sink.messages).toEqual([]);

  // The old transport reporting its close changes nothing.
  bea.connection.closed();
  bea.send('porter:pong');
  expect(ana.sink.messages).toEqual([]);
});

test('every connection is pinged, and one that does not answer is closed as a drop', async () => {
  const { join } = setup({ pingInterval: 1000 });
  const ana = await join('Ana');
  const bea = await join('Bea', ana.roomId);

  vi.advanceTimersByTime(1000);
  expect(ana.sink.messages.at(-1)).toEqual({ event: 'porter:ping' });
  ana.send('porter:pong');

  vi.advanceTimersByTime(1000);
  expect(bea.sink.isClosed).toBe(true);
  expect(ana.sink.isClosed).toBe(false);
  expect(ana.sink.last('porter:userDisconnected')).toEqual({ name: 'Bea' });
});

test('commands over HTTP reach the room for a connected User, and are discarded otherwise', async () => {
  const { porter, join, login } = setup();
  const ana = await join('Ana');
  const { token } = await login('Bea', ana.roomId);

  expect(porter.command(ana.token, { event: 'porter:lockRoom', data: { locked: true } })).toEqual({ status: 202 });
  expect(ana.sink.last('porter:roomLocked')).toEqual({ locked: true });
  expect(porter.command(ana.token, 'garbage')).toEqual({ status: 202 });
  expect(ana.sink.last('porter:messageRejected')).toEqual({ rejected: '', reason: 'malformed' });

  expect(porter.command(token, { event: 'peek' })).toEqual({ status: 409, body: { reason: 'notConnected' } });
});

test('destroying Porter closes every connection and leaves no timer behind', async () => {
  const { porter, join } = setup();
  const ana = await join('Ana');
  porter.destroy();
  expect(ana.sink.isClosed).toBe(true);
  expect(vi.getTimerCount()).toBe(0);
});

test('a transport that reports its close at once, as SSE does, still drops the User only once', async () => {
  const { porter, join, connect } = setup({ pingInterval: 1000, gracePeriod: 3000 });
  const ana = await join('Ana');
  const bea = await join('Bea', ana.roomId);
  bea.sink.close = () => bea.connection.closed();
  ana.send('porter:pong');
  vi.advanceTimersByTime(1000);
  ana.send('porter:pong');
  vi.advanceTimersByTime(1000); // Bea never answered
  expect(ana.sink.events().filter((e) => e === 'porter:userDisconnected')).toHaveLength(1);

  const back = connect(bea.token);
  for (let i = 0; i < 5; i++) {
    vi.advanceTimersByTime(1000);
    porter.command(ana.token, { event: 'porter:pong' });
    porter.command(bea.token, { event: 'porter:pong' });
  }
  expect(ana.sink.events()).not.toContain('porter:userLeft');
  expect(back.sink.isClosed).toBe(false);
});

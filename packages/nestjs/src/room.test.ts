import { expect, test, vi } from 'vitest';
import { setup } from './testing';

const rejected = (who: { sink: { last(event: string): any } }) => who.sink.last('porter:messageRejected');

test('locking is announced to everyone, also with the value the room already has', async () => {
  const { join } = setup();
  const ana = await join('Ana');
  const bea = await join('Bea', ana.roomId);
  ana.send('porter:lockRoom', { locked: false });
  expect(bea.sink.messages.at(-1)).toEqual({ event: 'porter:roomLocked', data: { locked: false } });
  expect(ana.sink.messages.at(-1)).toEqual({ event: 'porter:roomLocked', data: { locked: false } });
});

test('a locked room still lets a pending User connect and a reconnecting one come back', async () => {
  const { join, login, connect } = setup();
  const ana = await join('Ana');
  const bea = await join('Bea', ana.roomId);
  const cleo = await login('Cleo', ana.roomId);
  ana.send('porter:lockRoom', { locked: true });
  bea.connection.closed();
  expect(connect(bea.token).sink.events()).toEqual(['porter:joined']);
  expect(connect(cleo.token).sink.last('porter:joined').locked).toBe(true);
});

test("Porter's messages are for the Admin only, whatever their data and the situation", async () => {
  const { join } = setup();
  const ana = await join('Ana');
  const bea = await join('Bea', ana.roomId);
  for (const event of ['porter:lockRoom', 'porter:kickUser', 'porter:changeGame', 'porter:updateSettings']) {
    bea.send(event, 'not even an object');
    expect(rejected(bea)).toEqual({ rejected: event, reason: 'notAdmin' });
  }
  for (const event of ['porter:startMatch', 'porter:pauseMatch', 'porter:continueMatch', 'porter:endMatch']) {
    bea.send(event);
    expect(rejected(bea)).toEqual({ rejected: event, reason: 'notAdmin' });
  }
  expect(ana.sink.events()).not.toContain('porter:messageRejected');
});

test("a porter: event that is not one of Porter's is unhandled for anyone", async () => {
  const { join } = setup();
  const ana = await join('Ana');
  const bea = await join('Bea', ana.roomId);
  ana.send('porter:selfDestruct');
  bea.send('porter:joined');
  expect(rejected(ana)).toEqual({ rejected: 'porter:selfDestruct', reason: 'unhandled' });
  expect(rejected(bea)).toEqual({ rejected: 'porter:joined', reason: 'unhandled' });
});

test.each([[undefined], [7], [[]], [{ data: 1 }], [{ event: 7 }]])('%j is not an envelope: malformed', async (raw) => {
  const { join } = setup();
  const ana = await join('Ana');
  ana.connection.receive(raw);
  expect(rejected(ana)).toEqual({ rejected: '', reason: 'malformed' });
});

test.each([
  ['porter:lockRoom', { locked: 'yes' }],
  ['porter:kickUser', {}],
  ['porter:changeGame', { game: 7 }],
  ['porter:updateSettings', 'fast'],
  ['porter:pauseMatch', undefined],
])('%s with data of the wrong shape is malformed', async (event, data) => {
  const { join } = setup();
  const ana = await join('Ana');
  ana.send(event, data);
  expect(rejected(ana)).toEqual({ rejected: event, reason: 'malformed' });
});

test('removing a connected User: it gets porter:kicked and is closed, the others porter:userLeft', async () => {
  const { join, connect } = setup();
  const ana = await join('Ana');
  const bea = await join('Bea', ana.roomId);
  ana.send('porter:kickUser', { name: 'Bea' });

  expect(bea.sink.messages.at(-1)).toEqual({ event: 'porter:kicked' });
  expect(bea.sink.isClosed).toBe(true);
  expect(ana.sink.messages.at(-1)).toEqual({ event: 'porter:userLeft', data: { name: 'Bea', reason: 'kicked' } });
  expect(connect(bea.token).sink.last('porter:rejected')).toEqual({ reason: 'notInRoom' });
});

test('removing a reconnecting User makes it leave at once', async () => {
  const { join } = setup({ gracePeriod: 1000 });
  const ana = await join('Ana');
  const bea = await join('Bea', ana.roomId);
  bea.connection.closed();
  ana.send('porter:kickUser', { name: 'Bea' });
  expect(ana.sink.last('porter:userLeft')).toEqual({ name: 'Bea', reason: 'kicked' });
  ana.sink.clear();
  vi.advanceTimersByTime(1000);
  expect(ana.sink.events()).not.toContain('porter:userLeft');
});

test('the Admin cannot remove itself, a pending User, or nobody', async () => {
  const { join, login } = setup();
  const ana = await join('Ana');
  await login('Bea', ana.roomId);
  ana.send('porter:kickUser', { name: 'Ana' });
  expect(rejected(ana).reason).toBe('notAllowedNow');
  ana.send('porter:kickUser', { name: 'Bea' });
  expect(rejected(ana).reason).toBe('notFound');
  ana.send('porter:kickUser', { name: 'Nobody' });
  expect(rejected(ana).reason).toBe('notFound');
});

test('settings: the Game applies the update and Porter announces them as they are', async () => {
  const { join } = setup();
  const ana = await join('Ana');
  const bea = await join('Bea', ana.roomId);
  ana.send('porter:updateSettings', { target: 9, extra: 'ignored' });
  expect(bea.sink.messages.at(-1)).toEqual({ event: 'porter:settingsUpdated', data: { target: 9 } });
});

test('settings the Game rejects are not announced; anything else it throws is failed and logged', async () => {
  const { join, manager } = setup();
  const { Logger } = await import('@nestjs/common');
  const ana = await join('Ana');
  ana.send('porter:updateSettings', { target: 'nine' });
  expect(rejected(ana)).toEqual({
    rejected: 'porter:updateSettings',
    reason: { code: 'game', reason: 'invalidSettings' },
  });
  expect(Logger.prototype.error).not.toHaveBeenCalled();

  manager.updateSettings = () => {
    throw new Error('boom');
  };
  ana.send('porter:updateSettings', { target: 1 });
  expect(rejected(ana).reason).toBe('failed');
  expect(ana.sink.events()).not.toContain('porter:settingsUpdated');
  expect(Logger.prototype.error).toHaveBeenCalledWith(
    `room=${ana.roomId} game=counter method=updateSettings`,
    expect.stringContaining('boom'),
  );
});

test('changing the Game discards everything of the previous one and announces the new default settings', async () => {
  const { join } = setup();
  const ana = await join('Ana');
  const bea = await join('Bea', ana.roomId);
  ana.send('porter:changeGame', { game: 'other' });
  await vi.advanceTimersByTimeAsync(0);

  expect(bea.sink.messages.at(-1)).toEqual({
    event: 'porter:gameChanged',
    data: { game: 'other', settings: { speed: 9 } },
  });
  expect(bea.joined().game).toEqual({
    name: 'other',
    settings: { speed: 9 },
    state: { laps: 0 },
    userData: { Ana: { lane: 0 }, Bea: { lane: 0 } },
    match: { status: 'idle' },
  });
});

test('changing to the Game already active goes back to its defaults', async () => {
  const { join } = setup();
  const ana = await join('Ana');
  ana.send('porter:updateSettings', { target: 99 });
  ana.send('porter:changeGame', { game: 'counter' });
  await vi.advanceTimersByTimeAsync(0);
  expect(ana.sink.last('porter:gameChanged')).toEqual({ game: 'counter', settings: { target: 5 } });
  expect(ana.joined().game.settings).toEqual({ target: 5 });
});

test('changing the Game: unknown name is notFound, a Match under way is notAllowedNow first', async () => {
  const { join } = setup();
  const ana = await join('Ana');
  await join('Bea', ana.roomId);
  ana.send('porter:changeGame', { game: 'chess' });
  expect(rejected(ana).reason).toBe('notFound');
  ana.send('porter:startMatch');
  ana.send('porter:changeGame', { game: 'chess' });
  expect(rejected(ana).reason).toBe('notAllowedNow');
});

test('when the new Game cannot supply its default settings the room keeps the previous Game', async () => {
  const { join, otherManager } = setup();
  const ana = await join('Ana');
  otherManager.defaultSettings = () => Promise.reject(new Error('down'));
  ana.send('porter:changeGame', { game: 'other' });
  await vi.advanceTimersByTimeAsync(0);
  expect(rejected(ana)).toEqual({ rejected: 'porter:changeGame', reason: 'failed' });
  expect(ana.sink.events()).not.toContain('porter:gameChanged');
  expect(ana.joined().game.name).toBe('counter');
});

test('a Match that starts while the new default settings load refuses the change', async () => {
  const { join, otherManager } = setup();
  const ana = await join('Ana');
  await join('Bea', ana.roomId);
  let resolve!: (settings: { speed: number }) => void;
  otherManager.defaultSettings = () => new Promise((r) => (resolve = r));
  ana.send('porter:changeGame', { game: 'other' });
  ana.send('porter:startMatch');
  resolve({ speed: 1 });
  await vi.advanceTimersByTimeAsync(0);
  expect(rejected(ana)).toEqual({ rejected: 'porter:changeGame', reason: 'notAllowedNow' });
  expect(ana.sink.events()).not.toContain('porter:gameChanged');
});

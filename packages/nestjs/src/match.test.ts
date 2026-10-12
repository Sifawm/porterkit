import { Logger } from '@nestjs/common';
import { expect, test, vi } from 'vitest';
import { counter, setup } from './testing';

const rejected = (who: { sink: { last(event: string): any } }) => who.sink.last('porter:messageRejected');

async function started(options?: Parameters<typeof setup>[0]) {
  const s = setup(options);
  const ana = await s.join('Ana');
  const bea = await s.join('Bea', ana.roomId);
  ana.send('porter:startMatch');
  return { ...s, ana, bea };
}

test('starting a Match needs the minimum of Users, pending ones not counted', async () => {
  const { join, login } = setup();
  const ana = await join('Ana');
  await login('Bea', ana.roomId);
  ana.send('porter:startMatch');
  expect(rejected(ana)).toEqual({ rejected: 'porter:startMatch', reason: 'belowMinPlayers' });
});

test('a start makes state, per-User data and memory new, keeps the settings and announces before onStart', async () => {
  const { join, manager } = setup();
  const ana = await join('Ana');
  const bea = await join('Bea', ana.roomId);
  ana.send('porter:updateSettings', { target: 2 });
  manager.onStart = (ctx) => {
    manager.calls.push('onStart');
    ctx.room.broadcast('incremented', 0);
    expect(ctx.memory).toEqual({ secret: 42 });
  };
  ana.send('porter:startMatch');
  expect(bea.sink.events().slice(-2)).toEqual(['porter:matchStarted', 'incremented']);
  expect(manager.calls).toEqual(['canStart', 'onStart']);

  bea.send('increment');
  ana.send('increment'); // reaches the target: the Game ends the Match
  expect(ana.joined().game.match).toEqual({ status: 'ended', reason: { by: 'game', reason: { winner: 'Ana' } } });

  // Playing again is porter:startMatch: everything but the settings is new.
  ana.send('porter:startMatch');
  expect(ana.joined().game).toEqual({
    name: 'counter',
    settings: { target: 2 },
    state: { count: 0 },
    userData: { Ana: { clicks: 0 }, Bea: { clicks: 0 } },
    match: { status: 'running', timers: {} },
  });
});

test('the Game vetoes a start with its own reason, and nothing else happens', async () => {
  const { join, manager } = setup();
  const ana = await join('Ana');
  await join('Bea', ana.roomId);
  manager.canStart = (ctx) => {
    throw ctx.reject('invalidSettings');
  };
  ana.send('porter:startMatch');
  expect(rejected(ana)).toEqual({ rejected: 'porter:startMatch', reason: { code: 'game', reason: 'invalidSettings' } });
  expect(ana.sink.events()).not.toContain('porter:matchStarted');
});

test('the situation decides which Match messages are allowed', async () => {
  const { ana } = await started();
  const refused = (event: string) => {
    ana.sink.clear();
    ana.send(event, {});
    return rejected(ana)?.reason;
  };
  expect(refused('porter:startMatch')).toBe('notAllowedNow');
  expect(refused('porter:continueMatch')).toBe('notAllowedNow');
  expect(refused('porter:pauseMatch')).toBeUndefined();
  expect(refused('porter:pauseMatch')).toBe('notAllowedNow');
  expect(refused('porter:continueMatch')).toBeUndefined();
  expect(refused('porter:endMatch')).toBeUndefined();
  expect(refused('porter:endMatch')).toBe('notAllowedNow');
  expect(refused('porter:pauseMatch')).toBe('notAllowedNow');
});

test('a pause carries the reason given, null when absent, and the Game hears each step', async () => {
  const { ana, bea, manager } = await started();
  ana.send('porter:pauseMatch', { reason: 'break' });
  expect(bea.sink.messages.at(-1)).toEqual({ event: 'porter:matchPaused', data: { reason: 'break' } });
  expect(bea.joined().game.match).toEqual({ status: 'paused', reason: 'break', timers: {} });
  ana.send('porter:continueMatch');
  expect(bea.sink.messages.at(-1)).toEqual({ event: 'porter:matchContinued' });
  ana.send('porter:pauseMatch', {});
  expect(ana.sink.last('porter:matchPaused')).toEqual({ reason: null });
  ana.send('porter:endMatch');
  expect(ana.sink.last('porter:matchEnded')).toEqual({ reason: { by: 'admin' } });
  expect(manager.calls.slice(2)).toEqual(['onPause:"break"', 'onContinue', 'onPause:null', 'onEnd:{"by":"admin"}']);
});

test('ctx.endMatch without a Match under way does nothing', async () => {
  const { ana, manager } = await started();
  const ctx = manager.ctx!;
  ctx.endMatch({ winner: 'Ana' });
  ctx.endMatch({ winner: 'Bea' });
  expect(ana.sink.events().filter((e) => e === 'porter:matchEnded')).toHaveLength(1);
  expect(ana.sink.last('porter:matchEnded')).toEqual({ reason: { by: 'game', reason: { winner: 'Ana' } } });
  expect(manager.calls.filter((c) => c.startsWith('onEnd'))).toHaveLength(1);
});

test('a hook that throws is logged and changes nothing', async () => {
  const { join, manager } = setup();
  const ana = await join('Ana');
  await join('Bea', ana.roomId);
  manager.onStart = () => Promise.reject(new Error('no opening'));
  manager.onEnd = () => {
    throw new Error('no ending');
  };
  ana.send('porter:startMatch');
  await vi.advanceTimersByTimeAsync(0);
  ana.send('porter:endMatch');
  expect(ana.sink.events()).not.toContain('porter:messageRejected');
  expect(ana.sink.last('porter:matchEnded')).toEqual({ reason: { by: 'admin' } });
  expect(vi.mocked(Logger.prototype.error).mock.calls.map((c) => c[0])).toEqual([
    `room=${ana.roomId} game=counter method=onStart`,
    `room=${ana.roomId} game=counter method=onEnd`,
  ]);
});

test('the Game is told when a User drops and when it leaves, only with a Match under way', async () => {
  const { join, manager } = setup({ gracePeriod: 1000 });
  const ana = await join('Ana');
  const bea = await join('Bea', ana.roomId);
  const cleo = await join('Cleo', ana.roomId);
  cleo.connection.closed();
  expect(manager.calls).toEqual([]);
  ana.send('porter:startMatch');
  bea.connection.closed();
  vi.advanceTimersByTime(1000); // Cleo and Bea leave; two Users are needed
  expect(manager.calls).toEqual([
    'canStart',
    'onStart',
    'onUserDisconnected:Bea',
    'onUserLeft:Cleo',
    'onEnd:{"by":"minPlayers"}',
  ]);
  expect(ana.sink.events().slice(-2)).toEqual(['porter:userLeft', 'porter:matchEnded']);
});

test('a User that joins with a Match under way gets new per-User data, and loses it on leaving', async () => {
  const { ana, bea, join } = await started();
  bea.send('increment');
  await join('Cleo', ana.roomId);
  expect(ana.joined().game.userData).toEqual({
    Ana: { clicks: 0 },
    Bea: { clicks: 1 },
    Cleo: { clicks: 0 },
  });
  ana.send('porter:kickUser', { name: 'Bea' });
  expect(Object.keys(ana.joined().game.userData)).toEqual(['Ana', 'Cleo']);
});

test('what the context shows of the room', async () => {
  const { ana, bea, login, manager } = await started();
  await login('Cleo', ana.roomId);
  bea.connection.closed();
  const { room } = manager.ctx!;
  expect(room.id).toBe(ana.roomId);
  expect(room.admin).toBe('Ana');
  expect(room.users.map((u: { name: string; status: string }) => [u.name, u.status])).toEqual([
    ['Ana', 'connected'],
    ['Bea', 'reconnecting'],
  ]);
  expect(room.connected.map((u: { name: string }) => u.name)).toEqual(['Ana']);
  expect(room.user('Bea')?.data).toEqual({ clicks: 0 });
  expect(room.user('Cleo')).toBeUndefined();
  expect(() => room.user('Bea')!.send('peeked')).not.toThrow();
  expect(manager.ctx).toBe(manager.ctx);
});

test('when the last User leaves with a Match under way the Game still hears its end', async () => {
  const { join, manager } = setup({ gracePeriod: 1000 });
  counter.minPlayers = 1;
  try {
    const ana = await join('Ana');
    ana.send('porter:startMatch');
    ana.connection.closed();
    vi.advanceTimersByTime(1000);
    expect(manager.calls.slice(-2)).toEqual(['onUserDisconnected:Ana', 'onEnd:{"by":"minPlayers"}']);
  } finally {
    counter.minPlayers = 2;
  }
});

test('a guard that throws answers failed', async () => {
  const { ana } = await started();
  const { manager } = await started();
  void manager;
  ana.send('explode', 1);
  expect(ana.sink.last('porter:messageRejected')).toEqual({ rejected: 'explode', reason: 'failed' });
});

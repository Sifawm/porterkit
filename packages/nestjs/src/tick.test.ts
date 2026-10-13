import { Logger } from '@nestjs/common';
import { expect, test, vi } from 'vitest';
import { GameManager } from './decorators';
import { Porter } from './porter';
import { counter, CounterManager, type Ctx, setup } from './testing';

/** Twenty Ticks a second: one every 50 ms. */
@GameManager({ ...counter, tickRate: 20 })
class Ticker extends CounterManager {
  ticks = 0;
  onTick(_ctx: Ctx): void {
    this.ticks += 1;
  }
}

/** Thirty a second: one every 33.3 ms, which no timer keeps. */
@GameManager({ ...counter, tickRate: 30 })
class ThirtyTicker extends Ticker {}

async function joined(manager = new Ticker()) {
  const s = setup({}, manager);
  const ana = await s.join('Ana');
  const bea = await s.join('Bea', ana.roomId);
  return { ...s, manager, ana, bea };
}

async function started(manager = new Ticker()) {
  const s = await joined(manager);
  s.ana.send('porter:startMatch');
  s.ana.sink.clear();
  return s;
}

test('Ticks come at the rate of the Game definition, only with a Match running, and announce nothing', async () => {
  const { ana, manager } = await joined();
  vi.advanceTimersByTime(1000);
  expect(manager.ticks).toBe(0);

  ana.send('porter:startMatch');
  ana.sink.clear();
  vi.advanceTimersByTime(49);
  expect(manager.ticks).toBe(0);
  vi.advanceTimersByTime(1);
  expect(manager.ticks).toBe(1);
  vi.advanceTimersByTime(950);
  expect(manager.ticks).toBe(20);
  expect(ana.sink.messages).toEqual([]);
});

test('a rate whose length is not a whole number of milliseconds is kept all the same', async () => {
  const { manager } = await started(new ThirtyTicker());
  vi.advanceTimersByTime(10_000);
  // The last firing came a moment before the three-hundredth Tick was owed.
  expect(manager.ticks).toBe(299);
  vi.advanceTimersByTime(50_000);
  expect(manager.ticks).toBe(1799);
});

test('a Tick receives the context and what it broadcasts reaches the Users', async () => {
  const { ana, manager } = await started();
  manager.onTick = (ctx) => ctx.room.broadcast('incremented', (ctx.game.state.count += 1));
  vi.advanceTimersByTime(100);
  expect(ana.sink.messages).toEqual([
    { event: 'incremented', data: 1 },
    { event: 'incremented', data: 2 },
  ]);
});

test('a pause stops the Ticks and the time paused is not made up for', async () => {
  const { ana, manager } = await started();
  vi.advanceTimersByTime(120);
  expect(manager.ticks).toBe(2);
  ana.send('porter:pauseMatch', {});
  vi.advanceTimersByTime(5000);
  expect(manager.ticks).toBe(2);
  ana.send('porter:continueMatch');
  vi.advanceTimersByTime(49);
  expect(manager.ticks).toBe(2);
  vi.advanceTimersByTime(1);
  expect(manager.ticks).toBe(3);
});

test('Ticks that are late are made up for, five at most, and the rest are dropped', async () => {
  const { manager } = await started();
  // The process was busy for 200 ms: the clock moved and no timer ran.
  vi.setSystemTime(Date.now() + 200);
  vi.advanceTimersByTime(50);
  expect(manager.ticks).toBe(5);
  vi.advanceTimersByTime(50);
  expect(manager.ticks).toBe(5 + 1);

  vi.setSystemTime(Date.now() + 250);
  vi.advanceTimersByTime(50);
  expect(manager.ticks).toBe(6 + 5);
  vi.advanceTimersByTime(50);
  expect(manager.ticks).toBe(6 + 5 + 1);
});

test('when the Match ends the Ticks stop, also from inside a Tick that was making up for lost time', async () => {
  const { ana, manager } = await started();
  manager.onTick = (ctx) => {
    manager.ticks += 1;
    if (manager.ticks === 2) ctx.endMatch({ winner: 'Ana' });
  };
  vi.setSystemTime(Date.now() + 200);
  vi.advanceTimersByTime(1000);
  expect(manager.ticks).toBe(2);
  expect(ana.sink.events()).toEqual(['porter:matchEnded']);
});

test('when Porter is destroyed with a Match running its Ticks go with the room', async () => {
  const { manager, porter } = await started();
  vi.advanceTimersByTime(100);
  porter.destroy();
  vi.advanceTimersByTime(1000);
  expect(manager.ticks).toBe(2);
});

test('a Tick that throws or rejects is logged and the Ticks go on', async () => {
  const { ana, manager } = await started();
  manager.onTick = () => {
    manager.ticks += 1;
    if (manager.ticks === 1) throw new Error('sync');
    if (manager.ticks === 2) return Promise.reject(new Error('async')) as never;
  };
  await vi.advanceTimersByTimeAsync(150);
  expect(manager.ticks).toBe(3);
  expect(vi.mocked(Logger.prototype.error).mock.calls.map((c) => c[0])).toEqual([
    `room=${ana.roomId} game=counter method=onTick`,
    `room=${ana.roomId} game=counter method=onTick`,
  ]);
  expect(ana.sink.events()).not.toContain('porter:matchEnded');
});

test('a Game without a tickRate has no Tick', async () => {
  const s = setup();
  // Too late to count: Porter looked for `onTick` when it started.
  const onTick = vi.fn();
  Object.assign(s.manager, { onTick });
  const ana = await s.join('Ana');
  await s.join('Bea', ana.roomId);
  ana.send('porter:startMatch');
  vi.advanceTimersByTime(1000);
  expect(onTick).not.toHaveBeenCalled();
});

const start = (manager: object) => () => new Porter({ initialGame: 'counter' }, [manager]);

test('a tickRate without onTick, and onTick without a tickRate, stop Porter from starting', () => {
  @GameManager({ ...counter, tickRate: 20 })
  class NoHook extends CounterManager {}
  @GameManager(counter)
  class NoRate extends Ticker {}
  expect(start(new NoHook())).toThrow(/counter.*tickRate.*onTick/);
  expect(start(new NoRate())).toThrow(/counter.*onTick.*tickRate/);
});

test.each([0, -1, NaN, Infinity, 1001, '20'])('a tickRate of %j stops Porter from starting', (tickRate) => {
  @GameManager({ ...counter, tickRate: tickRate as number })
  class Wrong extends Ticker {}
  expect(start(new Wrong())).toThrow(/counter.*tickRate/);
});

test('a thousand Ticks a second is the most a Game may have', () => {
  @GameManager({ ...counter, tickRate: 1000 })
  class Fastest extends Ticker {}
  expect(start(new Fastest())).not.toThrow();
});

import { Logger } from '@nestjs/common';
import { expect, test, vi } from 'vitest';
import { setup } from './testing';

async function started() {
  const s = setup();
  const ana = await s.join('Ana');
  const bea = await s.join('Bea', ana.roomId);
  ana.send('porter:startMatch');
  ana.sink.clear();
  return { ...s, ana, bea, timers: s.manager.ctx!.timers };
}

test('a timer is announced, fires once and is announced cleared before its callback', async () => {
  const { ana, timers, manager } = await started();
  timers.set('round', 1000, () => manager.ctx!.room.broadcast('incremented', 7));
  expect(ana.sink.messages).toEqual([{ event: 'porter:timerSet', data: { name: 'round', remaining: 1000 } }]);
  vi.advanceTimersByTime(999);
  expect(ana.sink.messages).toHaveLength(1);
  vi.advanceTimersByTime(1);
  expect(ana.sink.events()).toEqual(['porter:timerSet', 'porter:timerCleared', 'incremented']);
  vi.advanceTimersByTime(5000);
  expect(ana.sink.messages).toHaveLength(3);
});

test('a callback may set a timer of the same name', async () => {
  const { ana, timers } = await started();
  timers.set('again', 100, () => timers.set('again', 100, () => {}));
  vi.advanceTimersByTime(100);
  expect(ana.sink.events()).toEqual(['porter:timerSet', 'porter:timerCleared', 'porter:timerSet']);
});

test('a timer of the same name is replaced; clearing one that does not exist sends nothing', async () => {
  const { ana, timers } = await started();
  const first = vi.fn();
  timers.set('round', 100, first);
  timers.set('round', 500, () => {});
  vi.advanceTimersByTime(100);
  expect(first).not.toHaveBeenCalled();
  timers.clear('round');
  timers.clear('round');
  timers.clear('ghost');
  expect(ana.sink.events()).toEqual(['porter:timerSet', 'porter:timerSet', 'porter:timerCleared']);
});

test('a pause stops every timer and continuing resumes each with what it had left', async () => {
  const { ana, timers } = await started();
  const fired = vi.fn();
  timers.set('round', 1000, fired);
  vi.advanceTimersByTime(400);
  expect(ana.joined().game.match.timers).toEqual({ round: 600 });

  ana.send('porter:pauseMatch', {});
  timers.set('bonus', 300, fired); // created stopped
  vi.advanceTimersByTime(5000);
  expect(fired).not.toHaveBeenCalled();
  expect(ana.joined().game.match.timers).toEqual({ round: 600, bonus: 300 });

  ana.send('porter:continueMatch');
  vi.advanceTimersByTime(300);
  expect(fired).toHaveBeenCalledTimes(1);
  vi.advanceTimersByTime(300);
  expect(fired).toHaveBeenCalledTimes(2);
});

test('when the Match ends its timers cease to exist without any announcement', async () => {
  const { ana, timers } = await started();
  const fired = vi.fn();
  timers.set('round', 1000, fired);
  ana.send('porter:endMatch');
  vi.advanceTimersByTime(1000);
  expect(fired).not.toHaveBeenCalled();
  expect(ana.sink.events()).toEqual(['porter:timerSet', 'porter:matchEnded']);
});

test('set throws without a Match under way, also inside onEnd, and for a time that is not positive', async () => {
  const { ana, timers, manager } = await started();
  expect(() => timers.set('round', 0, () => {})).toThrow();
  expect(() => timers.set('round', Infinity, () => {})).toThrow();
  manager.onEnd = (ctx) => ctx.timers.set('late', 100, () => {});
  ana.send('porter:endMatch');
  expect(Logger.prototype.error).toHaveBeenCalledWith(
    `room=${ana.roomId} game=counter method=onEnd`,
    expect.any(String),
  );
  expect(() => timers.set('round', 100, () => {})).toThrow();
});

test('a callback that throws or rejects is logged and the Match goes on', async () => {
  const { ana, timers } = await started();
  timers.set('a', 100, () => {
    throw new Error('sync');
  });
  timers.set('b', 100, () => Promise.reject(new Error('async')));
  await vi.advanceTimersByTimeAsync(100);
  expect(vi.mocked(Logger.prototype.error).mock.calls.map((c) => c[0])).toEqual([
    `room=${ana.roomId} game=counter timer=a`,
    `room=${ana.roomId} game=counter timer=b`,
  ]);
  expect(ana.sink.events()).not.toContain('porter:matchEnded');
});

test('when the room ceases to exist its timers go with it', async () => {
  const { ana, bea, timers } = await started();
  const fired = vi.fn();
  timers.set('round', 60_000, fired);
  ana.connection.closed();
  bea.connection.closed();
  vi.advanceTimersByTime(60_000);
  expect(fired).not.toHaveBeenCalled();
  expect(vi.getTimerCount()).toBe(0);
});

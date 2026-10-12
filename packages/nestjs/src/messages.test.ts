import { Logger } from '@nestjs/common';
import { expect, test, vi } from 'vitest';
import { setup } from './testing';

const rejected = (who: { sink: { last(event: string): any } }) => who.sink.last('porter:messageRejected');

async function started() {
  const s = setup();
  const ana = await s.join('Ana');
  const bea = await s.join('Bea', ana.roomId);
  ana.send('porter:startMatch');
  return { ...s, ana, bea };
}

test('a Game message reaches its handler with the context, the data and the sender', async () => {
  const { ana, bea } = await started();
  bea.send('increment');
  expect(ana.sink.messages.at(-1)).toEqual({ event: 'incremented', data: 1 });
  expect(ana.joined().game).toMatchObject({
    state: { count: 1 },
    userData: { Ana: { clicks: 0 }, Bea: { clicks: 1 } },
  });
});

test('the checks run in order: handler, Admin, guard, Match', async () => {
  const { join } = setup();
  const ana = await join('Ana');
  const bea = await join('Bea', ana.roomId);
  const reason = (who: typeof ana, event: string, data?: unknown) => {
    who.send(event, data);
    return rejected(who);
  };
  expect(reason(bea, 'dance')).toEqual({ rejected: 'dance', reason: 'unhandled' });
  expect(reason(bea, 'reset')).toEqual({ rejected: 'reset', reason: 'notAdmin' });
  expect(reason(ana, 'add', { by: 'two' })).toEqual({ rejected: 'add', reason: 'malformed' });
  expect(reason(ana, 'add', { by: 2 })).toEqual({ rejected: 'add', reason: 'notAllowedNow' });
});

test('@AnyTime delivers a message without a Match under way; user.send reaches only that User', async () => {
  const { join } = setup();
  const ana = await join('Ana');
  const bea = await join('Bea', ana.roomId);
  bea.send('peek');
  expect(bea.sink.messages.at(-1)).toEqual({ event: 'peeked' });
  expect(ana.sink.events()).not.toContain('peeked');
});

test('a pause does not hold Game messages back', async () => {
  const { ana, bea } = await started();
  ana.send('porter:pauseMatch', {});
  bea.send('increment');
  expect(ana.sink.messages.at(-1)).toEqual({ event: 'incremented', data: 1 });
});

test('a handler rejects with a reason of the Game; anything else it throws is failed and logged', async () => {
  const { ana } = await started();
  ana.send('add', { by: 11 });
  expect(rejected(ana)).toEqual({ rejected: 'add', reason: { code: 'game', reason: 'tooBig' } });
  expect(Logger.prototype.error).not.toHaveBeenCalled();

  ana.send('add', { by: -1 });
  expect(rejected(ana)).toEqual({ rejected: 'add', reason: 'failed' });
  ana.send('slow');
  await vi.advanceTimersByTimeAsync(0);
  expect(rejected(ana)).toEqual({ rejected: 'slow', reason: 'failed' });
  expect(vi.mocked(Logger.prototype.error).mock.calls.map((c) => c[0])).toEqual([
    `room=${ana.roomId} game=counter message=add`,
    `room=${ana.roomId} game=counter message=slow`,
  ]);
});

test('a Game message goes to the active Game only', async () => {
  const { join } = setup();
  const ana = await join('Ana');
  ana.send('porter:changeGame', { game: 'other' });
  await vi.advanceTimersByTimeAsync(0);
  ana.send('peek');
  expect(rejected(ana)).toEqual({ rejected: 'peek', reason: 'unhandled' });
});

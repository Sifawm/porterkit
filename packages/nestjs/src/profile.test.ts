import { Logger } from '@nestjs/common';
import { expect, test, vi } from 'vitest';
import { setup } from './testing';

const rejected = (who: { sink: { last(event: string): any } }) => who.sink.last('porter:messageRejected');

test('any User updates its own Profile, at any time, and everyone is told', async () => {
  const { join } = setup();
  const ana = await join('Ana');
  const bea = await join('Bea', ana.roomId);
  ana.send('porter:startMatch');

  bea.send('porter:updateProfile', { profile: { avatar: 'fox' } });
  for (const who of [ana, bea]) {
    expect(who.sink.messages.at(-1)).toEqual({
      event: 'porter:profileUpdated',
      data: { name: 'Bea', profile: { avatar: 'fox' } },
    });
  }
  expect(ana.joined().users[1].profile).toEqual({ avatar: 'fox' });

  // An absent Profile is `null`, as at login.
  bea.send('porter:updateProfile', {});
  expect(ana.sink.last('porter:profileUpdated')).toEqual({ name: 'Bea', profile: null });

  // A Profile that changes nothing is announced again.
  ana.sink.clear();
  bea.send('porter:updateProfile', { profile: 'same' });
  bea.send('porter:updateProfile', { profile: 'same' });
  expect(ana.sink.events()).toEqual(['porter:profileUpdated', 'porter:profileUpdated']);

  // Whoever connects later gets the Profile as it is now.
  const cleo = await join('Cleo', ana.roomId);
  expect(cleo.sink.last('porter:joined').users[1].profile).toBe('same');
});

test('data that is not an object is malformed', async () => {
  const { join } = setup();
  const ana = await join('Ana');
  ana.send('porter:updateProfile', 'fox');
  expect(rejected(ana)).toEqual({ rejected: 'porter:updateProfile', reason: 'malformed' });
});

test('a Profile over the maximum size or refused by the validator is invalidProfile, and nobody is told', async () => {
  const seen: unknown[][] = [];
  const { join, login } = setup({
    maxProfileSize: 20,
    validateProfile: (profile, others) => {
      seen.push([profile, others]);
      return !others.some((other) => JSON.stringify(other) === JSON.stringify(profile));
    },
  });
  const ana = await join('Ana');
  const bea = await join('Bea', ana.roomId);
  await login('Cleo', ana.roomId); // pending, and counted all the same
  seen.length = 0;
  ana.sink.clear();

  bea.send('porter:updateProfile', { profile: 'x'.repeat(30) });
  expect(rejected(bea)).toEqual({ rejected: 'porter:updateProfile', reason: 'invalidProfile' });
  bea.send('porter:updateProfile', { profile: { avatar: 'Cleo' } });
  expect(rejected(bea)).toEqual({ rejected: 'porter:updateProfile', reason: 'invalidProfile' });
  // The validator sees the others' Profiles, not the sender's own.
  expect(seen).toEqual([[{ avatar: 'Cleo' }, [{ avatar: 'Ana' }, { avatar: 'Cleo' }]]]);
  expect(ana.sink.events()).toEqual([]);
});

test('a validator that throws refuses the Profile, and the error is logged', async () => {
  const error = vi.spyOn(Logger.prototype, 'error').mockImplementation(() => {});
  const { join } = setup({
    validateProfile: (profile) => {
      if (profile === 'bug') throw new Error('validator bug');
      return true;
    },
  });
  const ana = await join('Ana');
  ana.send('porter:updateProfile', { profile: 'bug' });
  expect(rejected(ana)).toEqual({ rejected: 'porter:updateProfile', reason: 'invalidProfile' });
  expect(error).toHaveBeenCalledWith(
    expect.stringContaining('validateProfile'),
    expect.stringContaining('validator bug'),
  );
  error.mockRestore();
});

test('at login the validator sees the Profiles of the room joined, and none for a new room', async () => {
  const seen: unknown[] = [];
  const { porter, login } = setup({
    validateProfile: (_profile, others) => {
      seen.push(others);
      return true;
    },
  });
  const { roomId } = await login('Ana');
  await login('Bea', roomId);
  await porter.login({ name: 'Cleo', roomId: 'zzzzzzzzzz' });
  expect(seen).toEqual([[], [{ avatar: 'Ana' }], []]);
});

test('a Profile refused at login is replaced by the fallback, which is checked in turn', async () => {
  const taken = (profile: unknown, others: unknown[]) =>
    others.some((other) => JSON.stringify(other) === JSON.stringify(profile));
  const { porter, join, connect } = setup({
    maxProfileSize: 20,
    validateProfile: (profile, others) => profile !== 'no' && !taken(profile, others),
    fallbackProfile: (others) => (others.length < 2 ? { avatar: `spare${others.length}` } : 'no'),
  });
  const { roomId } = await join('Ana');

  const bea = await porter.login({ name: 'Bea', profile: { avatar: 'Ana' }, roomId });
  expect(connect((bea.body as { token: string }).token).joined().users[1].profile).toEqual({ avatar: 'spare1' });
  // The fallback also stands in for a Profile too large.
  expect(await porter.login({ name: 'Cleo', profile: 'x'.repeat(30) })).toMatchObject({ status: 200 });
  // A fallback the validator refuses refuses the login.
  expect(await porter.login({ name: 'Dan', profile: { avatar: 'Ana' }, roomId })).toEqual({
    status: 400,
    body: { reason: 'invalidProfile' },
  });
  // A Profile the validator accepts is kept as sent.
  const eve = await porter.login({ name: 'Eve', profile: { avatar: 'eve' }, roomId });
  expect(eve).toMatchObject({ status: 200 });
});

test('a fallback that throws refuses the login, and the error is logged', async () => {
  const error = vi.spyOn(Logger.prototype, 'error').mockImplementation(() => {});
  const { porter } = setup({
    validateProfile: () => false,
    fallbackProfile: () => {
      throw new Error('fallback bug');
    },
  });
  expect(await porter.login({ name: 'Ana' })).toEqual({ status: 400, body: { reason: 'invalidProfile' } });
  expect(error).toHaveBeenCalledWith(
    expect.stringContaining('fallbackProfile'),
    expect.stringContaining('fallback bug'),
  );
  error.mockRestore();
});

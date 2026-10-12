import { expect, test, vi } from 'vitest';
import { setup } from './testing';

test('a login without roomId creates a room and returns its Token', async () => {
  const { porter } = setup();
  const { status, body } = await porter.login({ name: 'Ana', profile: null });
  expect(status).toBe(200);
  expect(body).toEqual({ roomId: expect.stringMatching(/^[a-z0-9]{10}$/), token: expect.any(String) });
  const { roomId, token } = body as { roomId: string; token: string };
  expect(token).toMatch(/^[a-z0-9]{10}\.[A-Za-z0-9_-]{43}$/);
  expect(token.startsWith(`${roomId}.`)).toBe(true);
  expect(porter.roomExists(roomId)).toBe(true);
  expect(porter.roomExists('zzzzzzzzzz')).toBe(false);
});

test.each([
  ['a body that is not an object', 'Ana'],
  ['an array', []],
  ['null', null],
  ['a name that is not a string', { name: 7 }],
  ['a name empty after trimming', { name: '   ' }],
  ['a name over the maximum', { name: 'x'.repeat(21) }],
])('%s is invalidName', async (_, body) => {
  const { porter } = setup();
  expect(await porter.login(body)).toEqual({ status: 400, body: { reason: 'invalidName' } });
});

test('a name is trimmed before it is measured, and stored as written', async () => {
  const { porter, connect } = setup({ maxNameLength: 3 });
  const { body } = await porter.login({ name: '  Ana  ' });
  expect(connect((body as { token: string }).token).sink.last('porter:joined').you).toBe('Ana');
});

test('a Profile over the maximum size or refused by the validator is invalidProfile', async () => {
  const seen: unknown[] = [];
  const { porter } = setup({
    maxProfileSize: 10,
    validateProfile: (p: unknown) => {
      seen.push(p);
      return p !== 'no';
    },
  });
  const refused = { status: 400, body: { reason: 'invalidProfile' } };
  expect(await porter.login({ name: 'Ana', profile: 'ñññññ' })).toEqual(refused); // 12 bytes with its quotes
  expect(await porter.login({ name: 'Ana', profile: 'ññññ' })).toMatchObject({ status: 200 });
  expect(await porter.login({ name: 'Ana', profile: 'no' })).toEqual(refused);
  expect(await porter.login({ name: 'Ana' })).toMatchObject({ status: 200 });
  expect(seen).toEqual(['ññññ', 'no', null]);
});

test.each([[null], [''], [7], ['ABCDEFGHIJ'], ['aaaaaaaaaa']])('roomId %j is roomNotFound', async (roomId) => {
  const { porter } = setup();
  expect(await porter.login({ name: 'Ana', roomId })).toEqual({ status: 404, body: { reason: 'roomNotFound' } });
});

test('a room refuses a name already taken, whatever its case', async () => {
  const { porter, login } = setup();
  const { roomId } = await login('Ana');
  expect(await porter.login({ name: 'ana', roomId })).toEqual({ status: 409, body: { reason: 'nameTaken' } });
  expect(await porter.login({ name: 'Bea', roomId })).toMatchObject({ status: 200 });
});

test('a room at capacity is roomFull, counting pending Users', async () => {
  const { porter, login } = setup({ capacity: 2 });
  const { roomId } = await login('Ana');
  await login('Bea', roomId);
  expect(await porter.login({ name: 'Cleo', roomId })).toEqual({ status: 409, body: { reason: 'roomFull' } });
});

test('a locked room refuses logins, before capacity and name', async () => {
  const { porter, join, login } = setup({ capacity: 1 });
  const ana = await join('Ana');
  ana.send('porter:lockRoom', { locked: true });
  expect(await porter.login({ name: 'Ana', roomId: ana.roomId })).toEqual({
    status: 409,
    body: { reason: 'roomLocked' },
  });
  expect(await porter.login({ name: '', roomId: ana.roomId })).toMatchObject({ body: { reason: 'invalidName' } });
  ana.send('porter:lockRoom', { locked: false });
  expect(await porter.login({ name: 'Ana', roomId: ana.roomId })).toMatchObject({ body: { reason: 'roomFull' } });
  void login;
});

test('when the initial Game cannot supply its default settings the login fails and no room exists', async () => {
  const { porter, manager } = setup();
  manager.defaultSettings = () => Promise.reject(new Error('db down'));
  expect(await porter.login({ name: 'Ana' })).toEqual({ status: 500, body: { reason: 'failed' } });
});

test('a pending User whose Grace period runs out leaves, and its room goes with it', async () => {
  const { porter, login, connect } = setup({ gracePeriod: 1000 });
  const { roomId, token } = await login('Ana');
  vi.advanceTimersByTime(999);
  expect(porter.roomExists(roomId)).toBe(true);
  vi.advanceTimersByTime(1);
  expect(porter.roomExists(roomId)).toBe(false);
  const { sink } = connect(token);
  expect(sink.messages).toEqual([{ event: 'porter:rejected', data: { reason: 'roomNotFound' } }]);
  expect(sink.isClosed).toBe(true);
});

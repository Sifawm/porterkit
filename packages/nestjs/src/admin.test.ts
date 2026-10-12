import { expect, test, vi } from 'vitest';
import { setup } from './testing';

const admin = (who: { sink: { last(event: string): any } }) => who.sink.last('porter:adminChanged')?.admin;

test('when the Admin drops, the first connected User becomes the Admin at once', async () => {
  const { join } = setup();
  const ana = await join('Ana');
  const bea = await join('Bea', ana.roomId);
  const cleo = await join('Cleo', ana.roomId);

  ana.connection.closed();
  expect(bea.sink.events().slice(-2)).toEqual(['porter:userDisconnected', 'porter:adminChanged']);
  expect(admin(bea)).toBe('Bea');
  expect(admin(cleo)).toBe('Bea');
});

test('a former Admin recovers it on coming back, by its place in the line', async () => {
  const { join, connect } = setup();
  const ana = await join('Ana');
  const bea = await join('Bea', ana.roomId);
  const cleo = await join('Cleo', ana.roomId);

  ana.connection.closed(); // Bea
  bea.connection.closed(); // Cleo
  expect(admin(cleo)).toBe('Cleo');

  const beaBack = connect(bea.token);
  expect(beaBack.sink.last('porter:joined').admin).toBe('Bea');
  expect(admin(cleo)).toBe('Bea');

  const anaBack = connect(ana.token);
  expect(anaBack.sink.last('porter:joined').admin).toBe('Ana');
  expect(admin(cleo)).toBe('Ana');
});

test('a User behind the one that recovered does not recover on coming back', async () => {
  const { join, connect } = setup();
  const ana = await join('Ana');
  const bea = await join('Bea', ana.roomId);
  const cleo = await join('Cleo', ana.roomId);

  ana.connection.closed();
  bea.connection.closed();
  connect(ana.token);
  expect(admin(cleo)).toBe('Ana');
  connect(bea.token);
  expect(admin(cleo)).toBe('Ana');
});

test('with nobody connected the Admin stays, until someone else connects first', async () => {
  const { join, login, connect } = setup();
  const ana = await join('Ana');
  const { token } = await login('Bea', ana.roomId);
  ana.connection.closed();

  const bea = connect(token);
  expect(bea.sink.last('porter:joined').admin).toBe('Bea');
  expect(bea.sink.events()).toEqual(['porter:joined', 'porter:adminChanged']);
});

test('an Admin still pending loses it to whoever connects before it', async () => {
  const { login, connect } = setup();
  const ana = await login('Ana');
  const bea = await login('Bea', ana.roomId);
  expect(connect(bea.token).sink.last('porter:joined').admin).toBe('Bea');
  // Ana was the Admin before Bea: it is earlier in the line.
  expect(connect(ana.token).sink.last('porter:joined').admin).toBe('Ana');
});

test('when the Admin leaves with nobody connected, the first User left is the Admin while it is away', async () => {
  const { join, login, connect } = setup({ gracePeriod: 1000 });
  const ana = await join('Ana');
  ana.connection.closed();
  vi.advanceTimersByTime(500);
  const bea = await login('Bea', ana.roomId);
  const cleo = await login('Cleo', ana.roomId);
  vi.advanceTimersByTime(500); // Ana is out; Bea and Cleo are pending

  // Cleo connects while Bea, the Admin, is still away.
  const cleoIn = connect(cleo.token);
  expect(cleoIn.sink.last('porter:joined').users.map((u: { name: string }) => u.name)).toEqual(['Cleo']);
  expect(cleoIn.sink.last('porter:joined').admin).toBe('Cleo');

  // Bea was the Admin before Cleo, so it recovers on connecting.
  expect(connect(bea.token).sink.last('porter:joined').admin).toBe('Bea');
  expect(admin(cleoIn)).toBe('Bea');
});

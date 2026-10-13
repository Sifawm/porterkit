import 'reflect-metadata';
import type { INestApplication } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { FastifyAdapter } from '@nestjs/platform-fastify';
import { WsAdapter } from '@nestjs/platform-ws';
import { counter, type Games, type Profile } from '@porterkit/example-game';
import { createPorter, defineGame, type Porter, type Transport } from '@porterkit/react';
import { afterEach, beforeEach, expect, test } from 'vitest';
import { AppModule } from './app.module';

let app: INestApplication;
let port: number;
const clients: Porter<Games, Profile>[] = [];

beforeEach(async () => {
  app = await NestFactory.create(AppModule, new FastifyAdapter(), { logger: false });
  app.useWebSocketAdapter(new WsAdapter(app));
  await app.listen(0, '127.0.0.1');
  port = app.getHttpServer().address().port;
});
afterEach(async () => {
  for (const client of clients.splice(0)) client.leave();
  await app.close();
});

/** The real client, as the example front creates it, with nothing mounted. */
function client(transport: Transport, stored = new Map<string, string>()) {
  const porter = createPorter<Games, Profile>({
    httpUrl: `http://127.0.0.1:${port}`,
    wsUrl: `ws://127.0.0.1:${port}/porter/ws`,
    transport: () => transport,
    storage: {
      getItem: (key) => stored.get(key) ?? null,
      setItem: (key, value) => void stored.set(key, value),
      removeItem: (key) => void stored.delete(key),
    },
    games: {
      counter: defineGame<Games, 'counter'>(counter, {
        incremented: (game, { by, count }) => ({
          ...game,
          state: { count },
          userData: { ...game.userData, [by]: { clicks: game.userData[by].clicks + 1 } },
        }),
      }),
    },
  });
  clients.push(porter);
  return Object.assign(porter, { stored });
}

/** Resolves once the client's state satisfies the check. */
function until(porter: Porter<Games, Profile>, check: () => boolean) {
  return new Promise<void>((resolve) => {
    if (check()) return resolve();
    const stop = porter.subscribe(() => {
      if (!check()) return;
      stop();
      resolve();
    });
  });
}

test.each<Transport>(['ws', 'sse'])('a whole Match over %s', async (transport) => {
  const ana = client(transport);
  const bea = client(transport);

  const created = await ana.login({ name: 'Ana', profile: null });
  if (!created.ok) throw new Error(created.reason);
  expect(await ana.roomExists(created.roomId)).toBe(true);
  await until(ana, () => ana.connection.status === 'connected');

  expect(await bea.login({ name: 'ana', profile: null, roomId: created.roomId })).toEqual({
    ok: false,
    reason: 'nameTaken',
  });
  expect(await bea.login({ name: 'Bea', profile: null, roomId: created.roomId })).toMatchObject({ ok: true });
  await until(ana, () => ana.room!.users.length === 2);
  await until(bea, () => bea.connection.status === 'connected');
  expect(bea.room).toMatchObject({ admin: 'Ana', isAdmin: false });

  const rejections: unknown[] = [];
  const bothRejected = new Promise<void>((resolve) => {
    bea.on('porter:messageRejected', (rejection) => rejections.push(rejection) === 2 && resolve());
  });
  bea.send('porter:startMatch');
  bea.send('increment');
  await bothRejected;
  expect(rejections).toEqual([
    { rejected: 'porter:startMatch', reason: 'notAdmin' },
    { rejected: 'increment', reason: 'notAllowedNow' },
  ]);
  ana.send('porter:updateSettings', { target: 3 });
  await until(bea, () => bea.game('counter').settings.target === 3);

  ana.send('porter:startMatch');
  await until(bea, () => bea.game().match.status === 'running');
  bea.send('increment');
  await until(ana, () => ana.game('counter').state.count === 1);
  ana.send('increment');
  await until(bea, () => bea.game('counter').state.count === 2);
  bea.send('increment');
  await until(ana, () => ana.game().match.status === 'ended');

  const game = ana.game('counter');
  expect(game.match).toEqual({ status: 'ended', reason: { by: 'game', reason: { reachedBy: 'Bea' } } });
  expect(game.state).toEqual({ count: 3 });
  expect(game.userData).toEqual({ Ana: { clicks: 1 }, Bea: { clicks: 2 } });

  // The same Token on another connection, as a second tab would: it replaces the first, across transports.
  const other = client(transport === 'ws' ? 'sse' : 'ws', new Map(bea.stored));
  expect(other.resume()).toBe(true);
  await until(bea, () => bea.connection.status === 'closed');
  expect(bea.connection).toEqual({ status: 'closed', reason: 'replaced' });
  await until(other, () => other.connection.status === 'connected');
  expect(other.game('counter').state).toEqual({ count: 3 });
});

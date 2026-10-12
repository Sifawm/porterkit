import { Module } from '@nestjs/common';
import type { INestApplication } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { ExpressAdapter } from '@nestjs/platform-express';
import { FastifyAdapter } from '@nestjs/platform-fastify';
import { WsAdapter } from '@nestjs/platform-ws';
import { Test } from '@nestjs/testing';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { WebSocket } from 'ws';
import { PorterModule } from './porter.module';
import { CounterManager, type Games } from './testing';

// The Game's module does not import PorterModule: Porter discovers the Manager.
@Module({ providers: [CounterManager] })
class CounterModule {}

type Message = { event: string; data?: any };

/** Collects envelopes as they arrive and lets a test wait for one. */
function inbox() {
  const messages: Message[] = [];
  let wake = () => {};
  return {
    messages,
    push(message: Message) {
      messages.push(message);
      wake();
    },
    async next(event: string): Promise<Message> {
      for (;;) {
        const found = messages.find((m) => m.event === event);
        if (found) return found;
        await new Promise<void>((resolve) => (wake = resolve));
      }
    },
  };
}

/** Reads an SSE stream as protocol.md describes it. */
function openSse(url: string) {
  const box = inbox();
  const abort = new AbortController();
  const raw: string[] = [];
  const done = (async () => {
    const response = await fetch(url, { signal: abort.signal });
    let buffer = '';
    for await (const chunk of response.body!.pipeThrough(new TextDecoderStream())) {
      raw.push(chunk);
      buffer += chunk;
      const events = buffer.split('\n\n');
      buffer = events.pop()!;
      for (const event of events) {
        const data = event
          .split('\n')
          .filter((line) => line.startsWith('data:'))
          .map((line) => line.slice(5).replace(/^ /, ''))
          .join('\n');
        if (data !== '' && !data.startsWith(':')) box.push(JSON.parse(data));
      }
    }
  })().catch(() => {});
  return { ...box, raw, done, close: () => abort.abort() };
}

function openWs(url: string) {
  const box = inbox();
  const socket = new WebSocket(url);
  socket.on('message', (data) => box.push(JSON.parse(data.toString())));
  const closed = new Promise<void>((resolve) => socket.on('close', () => resolve()));
  return { ...box, socket, closed, send: (message: Message) => socket.send(JSON.stringify(message)) };
}

describe.each([
  ['Fastify', () => new FastifyAdapter()],
  ['Express', () => new ExpressAdapter()],
])('on %s', (_, adapter) => {
  let app: INestApplication;
  let http: string;
  let ws: string;

  beforeEach(async () => {
    vi.useRealTimers();
    const module = await Test.createTestingModule({
      imports: [PorterModule.forRoot<Games>({ initialGame: 'counter' }), CounterModule],
    }).compile();
    app = module.createNestApplication(adapter());
    app.useWebSocketAdapter(new WsAdapter(app));
    app.setGlobalPrefix('api');
    await app.listen(0, '127.0.0.1');
    const { port } = app.getHttpServer().address();
    http = `http://127.0.0.1:${port}/api/porter`;
    ws = `ws://127.0.0.1:${port}/porter/ws`;
  });
  afterEach(() => app.close());

  const login = async (body: unknown) => {
    const response = await fetch(`${http}/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    return { status: response.status, body: (await response.json()) as any };
  };
  const command = (token: string | undefined, message: Message) =>
    fetch(`${http}/commands`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...(token && { authorization: `Bearer ${token}` }) },
      body: JSON.stringify(message),
    });

  test('a login, a room check, and their rejections', async () => {
    const ok = await login({ name: 'Ana', profile: null });
    expect(ok).toEqual({ status: 200, body: { token: expect.any(String), roomId: expect.any(String) } });
    expect(await login({ name: '' })).toEqual({ status: 400, body: { reason: 'invalidName' } });
    expect(await login([])).toEqual({ status: 400, body: { reason: 'invalidName' } });
    expect(await login({ name: 'Bea', roomId: 'nope' })).toEqual({ status: 404, body: { reason: 'roomNotFound' } });

    expect((await fetch(`${http}/rooms/${ok.body.roomId}`, { method: 'HEAD' })).status).toBe(200);
    expect((await fetch(`${http}/rooms/aaaaaaaaaa`, { method: 'HEAD' })).status).toBe(404);
  });

  test('a connection over SSE, with its commands over HTTP', async () => {
    const { token } = (await login({ name: 'Ana' })).body;
    const ana = openSse(`${http}/events?token=${token}`);
    expect((await ana.next('porter:joined')).data).toMatchObject({ you: 'Ana', admin: 'Ana' });
    expect(ana.raw.join('')).toContain(' '.repeat(2048));
    expect(ana.raw.join('').indexOf(' '.repeat(2048))).toBeLessThan(ana.raw.join('').indexOf('porter:joined'));

    const response = await command(token, { event: 'porter:lockRoom', data: { locked: true } });
    expect(response.status).toBe(202);
    expect(await response.text()).toBe('');
    expect((await ana.next('porter:roomLocked')).data).toEqual({ locked: true });

    const refused = await command(undefined, { event: 'porter:pong' });
    expect([refused.status, await refused.json()]).toEqual([401, { reason: 'invalidToken' }]);
    ana.close();
  });

  test('a connection over WebSocket, beside one over SSE that then drops', async () => {
    const first = (await login({ name: 'Ana' })).body;
    const second = (await login({ name: 'Bea', roomId: first.roomId })).body;
    const ana = openWs(`${ws}?token=${first.token}`);
    await ana.next('porter:joined');
    const bea = openSse(`${http}/events?token=${second.token}`);
    expect((await ana.next('porter:userJoined')).data.user.name).toBe('Bea');
    await bea.next('porter:joined');

    ana.send({ event: 'porter:lockRoom', data: { locked: true } });
    expect((await bea.next('porter:roomLocked')).data).toEqual({ locked: true });
    ana.socket.send('not json');
    expect((await ana.next('porter:messageRejected')).data).toEqual({ rejected: '', reason: 'malformed' });

    bea.close();
    expect((await ana.next('porter:userDisconnected')).data).toEqual({ name: 'Bea' });
  });

  test('a refused connection gets porter:rejected and is closed, on both transports', async () => {
    const overWs = openWs(`${ws}?token=nonsense`);
    expect((await overWs.next('porter:rejected')).data).toEqual({ reason: 'invalidToken' });
    await overWs.closed;

    const overSse = openSse(`${http}/events`);
    expect((await overSse.next('porter:rejected')).data).toEqual({ reason: 'invalidToken' });
    await overSse.done;
  });
});

test('an initialGame that names no Game stops the application from starting', async () => {
  vi.useRealTimers();
  @Module({
    imports: [PorterModule.forRootAsync({ useFactory: () => ({ initialGame: 'chess' }) }), CounterModule],
  })
  class AppModule {}
  const app = await NestFactory.create(AppModule, new FastifyAdapter(), { abortOnError: false, logger: false });
  app.useWebSocketAdapter(new WsAdapter(app));
  await expect(app.init()).rejects.toThrow(/initialGame "chess"/);
});

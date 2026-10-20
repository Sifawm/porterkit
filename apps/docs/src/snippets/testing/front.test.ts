// #region test
import { createPorter, defineGame } from '@porterkit/client';
import { FakeSocket, memoryStorage } from '@porterkit/client/testing';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { type Games, misfit } from '../misfit/game';

beforeEach(() => {
  FakeSocket.all = [];
  vi.stubGlobal('WebSocket', FakeSocket);
});
afterEach(() => vi.unstubAllGlobals());

test('a dealt card reaches the state', () => {
  const storage = memoryStorage();
  storage.setItem('porter', JSON.stringify({ token: 'any', roomId: 'abcdefghij' }));
  const porter = createPorter<Games, null>({
    httpUrl: 'http://test',
    wsUrl: 'ws://test/porter/ws',
    storage,
    games: {
      misfit: defineGame<Games, 'misfit'>(misfit, {
        cardDealt: (game, { card }) => ({ ...game, state: { ...game.state, card } }),
      }),
    },
  });

  porter.resume();
  FakeSocket.last.emit('porter:joined', {
    roomId: 'abcdefghij',
    you: 'Ana',
    admin: 'Ana',
    locked: false,
    pingInterval: 30_000,
    users: [{ name: 'Ana', profile: null, status: 'connected' }],
    game: {
      name: 'misfit',
      settings: { roundTime: 30_000, maxPoints: 10 },
      state: { turn: 'Ana' },
      userData: { Ana: { answer: '', status: 'idle', points: 0 } },
      match: { status: 'running', timers: {} },
    },
  });
  FakeSocket.last.emit('cardDealt', { card: { category: 'basics', question: 'Which one?' } });

  expect(porter.connection.status).toBe('connected');
  expect(porter.game('misfit').state.card?.question).toBe('Which one?');

  porter.send('answer', { answer: 'the owl' });
  expect(FakeSocket.last.sent).toContainEqual({ event: 'answer', data: { answer: 'the owl' } });
});
// #endregion

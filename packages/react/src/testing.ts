import { createPorter, defineGame } from '@porterkit/client';
import { FakeSocket, memoryStorage } from '@porterkit/client/testing';
import type { GameDefinition, Joined } from '@porterkit/contracts';
import { vi } from 'vitest';

/** The Games the tests play. */
export type Games = {
  counter: {
    settings: { target: number };
    state: { count: number };
    userData: { clicks: number };
    client: { increment: undefined };
    server: { incremented: { by: string; count: number }; cheered: string };
    pauseReason: null;
    endReason: null;
    rejectReason: never;
  };
  quiz: {
    settings: { rounds: number };
    state: { question: string };
    userData: { answer: string };
    client: { answer: { answer: string } };
    server: { asked: { question: string } };
    pauseReason: null;
    endReason: null;
    rejectReason: never;
  };
};
export type Profile = { avatar: string };

const counter = {
  name: 'counter',
  minPlayers: 2,
  createSettings: () => ({ target: 3, set() {} }),
  createState: () => ({ count: 0 }),
  createUserData: () => ({ clicks: 0 }),
} satisfies GameDefinition<Games, 'counter'>;

const quiz = {
  name: 'quiz',
  minPlayers: 1,
  createSettings: () => ({ rounds: 5, set() {} }),
  createState: () => ({ question: '' }),
  createUserData: () => ({ answer: '' }),
} satisfies GameDefinition<Games, 'quiz'>;

export const joined = (): Joined<Games, Profile> => ({
  roomId: 'room000001',
  you: 'Ana',
  admin: 'Ana',
  locked: false,
  pingInterval: 30_000,
  users: [
    { name: 'Ana', profile: { avatar: 'fox' }, status: 'connected' },
    { name: 'Bea', profile: { avatar: 'owl' }, status: 'connected' },
  ],
  game: {
    name: 'counter',
    settings: { target: 3 },
    state: { count: 0 },
    userData: { Ana: { clicks: 0 }, Bea: { clicks: 0 } },
    match: { status: 'idle' },
  },
});

/** The real client over a fake WebSocket. */
export function setup() {
  FakeSocket.all = [];
  vi.stubGlobal('WebSocket', FakeSocket);
  const storage = memoryStorage();
  const porter = createPorter<Games, Profile>({
    httpUrl: '/api',
    wsUrl: 'ws://test/porter/ws',
    storage,
    games: {
      counter: defineGame<Games, 'counter'>(counter, {
        incremented: (game, { by, count }) => ({
          ...game,
          state: { count },
          userData: { ...game.userData, [by]: { clicks: game.userData[by].clicks + 1 } },
        }),
      }),
      quiz: defineGame<Games, 'quiz'>(quiz, {}),
    },
  });

  /** Resumes with a stored Token and receives `porter:joined`. */
  const connected = () => {
    storage.map.set('porter', '{"token":"room000001.secret","roomId":"room000001"}');
    porter.resume();
    FakeSocket.last.emit('porter:joined', joined());
    return FakeSocket.last;
  };
  return { porter, storage, connected };
}

import { counter, type Games, type Profile } from '@porterkit/example-game';
import { createPorter, defineGame, type Transport } from '@porterkit/client';
import { createHooks } from '@porterkit/react';

/** What the login screen's selector chose. Read before every connection attempt. */
export const transport: { current: Transport } = { current: 'ws' };

export const porter = createPorter<Games, Profile>({
  httpUrl: 'http://localhost:3000',
  wsUrl: 'ws://localhost:3000/porter/ws',
  transport: () => transport.current,
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

export const { useConnection, useRoom, useGame, useEvent } = createHooks(porter);

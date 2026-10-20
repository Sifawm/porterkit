import { createPorter, defineGame } from '@porterkit/client';
import { type Chase, chase } from './chase/game';
import { type Misfit, misfit, type Profile } from './misfit/game';

// #region map
export type Games = { misfit: Misfit; chase: Chase };
// #endregion

// #region client
const porter = createPorter<Games, Profile>({
  httpUrl: '/api',
  wsUrl: 'wss://example.com/porter/ws',
  games: {
    misfit: defineGame<Games, 'misfit'>(misfit, {
      turnChanged: (game, name) => ({ ...game, state: { ...game.state, turn: name } }),
    }),
    chase: defineGame<Games, 'chase'>(chase, {
      caught: (game, { who }) => ({ ...game, state: { ...game.state, it: who } }),
    }),
  },
});
// #endregion

// #region change
porter.send('porter:changeGame', { game: 'chase' });
// #endregion

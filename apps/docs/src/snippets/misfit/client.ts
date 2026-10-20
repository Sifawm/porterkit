// #region appliers
import { defineGame } from '@porterkit/client';
import { type Games, misfit } from './game';

export const misfitClient = defineGame<Games, 'misfit'>(misfit, {
  turnChanged: (game, name) => ({ ...game, state: { ...game.state, turn: name } }),

  cardDealt: (game, { card }) => ({
    ...game,
    state: { ...game.state, card },
    userData: Object.fromEntries(
      Object.entries(game.userData).map(([name, data]) => [name, { ...data, answer: '', status: 'idle' as const }]),
    ),
  }),
  // roundEnded, preStarted: no Applier. The state has nowhere to keep them,
  // so the front listens with `on`.
});
// #endregion

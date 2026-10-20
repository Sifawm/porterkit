// #region instance
import { createPorter } from '@porterkit/client';
import { createHooks } from '@porterkit/react';
import { misfitClient } from './client';
import type { Games, Profile } from './game';

export const porter = createPorter<Games, Profile>({
  httpUrl: '/api',
  wsUrl: 'wss://example.com/porter/ws',
  games: { misfit: misfitClient },
});
// #endregion

// #region hooks
export const { useConnection, useRoom, useGame, useTimer, useEvent } = createHooks(porter);

/** The Integrator's own alias, as it writes `Ctx` on the server. */
export const useMisfit = () => useGame('misfit');
// #endregion

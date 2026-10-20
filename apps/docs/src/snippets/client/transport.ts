import { createPorter } from '@porterkit/client';
import { misfitClient } from '../misfit/client';
import type { Games, Profile } from '../misfit/game';

// #region fallback
export const porter = createPorter<Games, Profile>({
  httpUrl: 'https://example.com/api',
  wsUrl: 'wss://example.com/porter/ws',
  // WebSocket three times in a row, then SSE until the next porter:joined.
  transport: ({ attempt }) => (attempt < 3 ? 'ws' : 'sse'),
  games: { misfit: misfitClient },
});
// #endregion

// #region sse
export const ssePorter = createPorter<Games, Profile>({
  httpUrl: 'https://example.com/api',
  transport: 'sse',
  games: { misfit: misfitClient },
});
// #endregion

// #region storage
export const tabPorter = createPorter<Games, Profile>({
  httpUrl: 'https://example.com/api',
  wsUrl: 'wss://example.com/porter/ws',
  // Kept after the tab closes, and shared by every tab of the site.
  storage: localStorage,
  maxRetries: 20,
  games: { misfit: misfitClient },
});
// #endregion

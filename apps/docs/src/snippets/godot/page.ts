// #region page
import { createPorter } from '@porterkit/client';
import { exposeToGodot } from '@porterkit/godot';
import { misfitClient } from '../misfit/client';
import type { Games, Profile } from '../misfit/game';

/** Godot's loader, from the classic script the web export writes. */
declare const Engine: new (config: object) => { startGame(): Promise<void> };

const porter = createPorter<Games, Profile>({
  httpUrl: '/api',
  wsUrl: 'wss://example.com/porter/ws',
  games: { misfit: misfitClient },
});

// Before the engine starts: the addon looks for the facade when it loads.
exposeToGodot(porter);

await new Engine({ executable: '/godot/index', canvas: document.getElementById('canvas') }).startGame();
// #endregion

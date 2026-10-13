import { createPorter, defineGame } from '@porterkit/client';
import { counter, type Games, type Profile } from '@porterkit/example-game';
import { exposeToGodot } from '@porterkit/godot';

/** Godot's loader, from the classic script of `index.html`. */
declare const Engine: new (config: object) => { startGame(): Promise<void> };

const porter = createPorter<Games, Profile>({
  httpUrl: 'http://localhost:3000',
  wsUrl: 'ws://localhost:3000/porter/ws',
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

// Before the engine starts: the addon looks for the facade when it loads.
exposeToGodot(porter);

await new Engine({
  executable: '/godot/index',
  canvas: document.getElementById('canvas'),
  canvasResizePolicy: 2,
  focusCanvas: true,
}).startGame();

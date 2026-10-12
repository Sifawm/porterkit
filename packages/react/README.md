# @porterkit/react

Porter's client: it logs a User into a room, keeps its connection alive over WebSocket or SSE, holds the state of the room and of its active Game, and exposes both to React through hooks.

```ts
export const porter = createPorter<Games, Profile>({
  httpUrl: '/api',
  wsUrl: 'wss://example.com/porter/ws',
  games: { misfit: misfitClient },
});

export const { useConnection, useRoom, useGame, useTimer, useEvent } = porter.hooks;
```

See the [specification](https://github.com/Sifawm/porter/blob/main/docs/spec/react.md).

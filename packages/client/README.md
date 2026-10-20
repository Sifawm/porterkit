# @porterkit/client

Porter's client: it logs a User into a room, keeps its connection alive over WebSocket or SSE and holds the state of the room and of its active Game. A Binding such as `@porterkit/react` exposes it to a framework.

```ts
export const porter = createPorter<Games, Profile>({
  httpUrl: '/api',
  wsUrl: 'wss://example.com/porter/ws',
  games: { misfit: misfitClient },
});
```

See the [guide](https://sifawm.github.io/porterkit/start/client/).

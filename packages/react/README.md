# @porterkit/react

Porter's Binding for React: it exposes the client of `@porterkit/client` (login, connection, the state of the room and of its active Game) to React through hooks.

```ts
import { createPorter } from '@porterkit/client';
import { createHooks } from '@porterkit/react';

export const porter = createPorter<Games, Profile>({
  httpUrl: '/api',
  wsUrl: 'wss://example.com/porter/ws',
  games: { misfit: misfitClient },
});

export const { useConnection, useRoom, useGame, useTimer, useEvent } = createHooks(porter);
```

See the [specification](https://github.com/Sifawm/porter/blob/main/docs/spec/react.md).

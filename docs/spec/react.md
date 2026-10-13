# `@porterkit/react`

## Purpose

The Binding for React: it exposes the client of [client.md](client.md) to React through hooks. Everything the client does (login, connection, state, Appliers) is in that file; this one says what the hooks add.

- Dependencies: `@porterkit/client` and `@porterkit/contracts`.
- Peer dependency: `react` `^18.0.0 || ^19.0.0`, and nothing else.
- One entry point, the package root. Importing it loads `react`; nothing calls React until a component uses a hook, so the instance works in Node with nothing mounted.
- It uses no state library, no dependency injection and no router.
- It exports no component and no route guard: `createPorter`, and everything `@porterkit/client` exports.

## Public API

Everything exported is below, besides what `@porterkit/client` exports, which this package exports again unchanged.

```ts
import type { GameName, GamesMap } from '@porterkit/contracts';
import type {
  AnyGameView,
  Connection,
  GameView,
  Incoming,
  Porter as Client,
  PorterOptions,
  RoomView,
  Timer,
} from '@porterkit/client';

export interface Hooks<Games extends GamesMap, Profile> {
  useConnection(): Connection;
  useRoom(): RoomView<Games, Profile>;
  useGame(): AnyGameView<Games, Profile>;
  useGame<Name extends GameName<Games>>(name: Name): GameView<Games, Name, Profile>;
  useTimer(name: string): Timer | null;
  useEvent<E extends keyof Incoming<Games, Profile> & string>(
    event: E,
    listener: (data: Incoming<Games, Profile>[E]) => void,
  ): void;
}

/** The client's instance, with its hooks. */
export interface Porter<Games extends GamesMap, Profile> extends Client<Games, Profile> {
  readonly hooks: Hooks<Games, Profile>;
}

export declare function createPorter<Games extends GamesMap, Profile = unknown>(
  options: PorterOptions<Games>,
): Porter<Games, Profile>;
```

## Behaviour

### Hooks

- `createPorter` creates the client's instance and adds `hooks` to it. It has no other effect.
- There is no Provider. The hooks read the instance they were made for, from any component.
- `hooks` is a thin layer: each hook reads the same values as the member of the instance it is named after, and re-renders when they change.
- Every hook that reads state re-renders after every message that changed something. The state keeps the identity of what did not change ([client.md](client.md#state)), so `memo` on any piece of it is safe.

### Reading

- `useConnection()` returns the connection.
- `useRoom()` returns the room.
- `useGame(name)` returns what `game(name)` does, and throws as it does if the active Game is another one. `useGame()` without a name returns the same for whichever Game is active, discriminated by `name`.
- `useRoom()` and `useGame()` throw before the first `porter:joined` and after `leave()`. They are used below a check that the connection is `connected`; `leave()` changes the connection in the same notification, so such a tree never renders them without a room.
- `useEvent(event, listener)` is for effects only: navigating, opening a modal, showing a toast. The listener is the latest one passed, without re-subscribing on every render.
- `resume()` in an effect is safe under StrictMode, which runs it twice ([client.md](client.md#calls-out-of-place)).

### Match timers

- `useTimer(name)` returns `null` when the active Match has no timer of that name.
- The tick is the component's: it calls `remaining()` on its own interval. A countdown does not go through the store and re-renders only its own component.

### What stays with the Integrator

What [client.md](client.md#what-stays-with-the-integrator) leaves to the Integrator, in React's terms:

- **Drafts** are component state.
- **Effects** go in `useEvent`. What a component keeps from `useEvent` in its own state is lost on reconnecting.
- **Guards.** "Connected" is `useConnection().status === 'connected'`. Porter exports no guard component.
- **Rejections.** `porter:messageRejected` is shown by whoever sent the message, from `useEvent`.

## Usage

The Integrator's instance, written once, with the Game of [client.md](client.md#usage):

```ts
// porter.ts
import { createPorter } from '@porterkit/react';
import type { Games } from './misfit.game';
import { misfitClient } from './misfit.client';

export interface Profile {
  avatar: string;
}

export const porter = createPorter<Games, Profile>({
  httpUrl: '/api',
  wsUrl: 'wss://example.com/porter/ws',
  games: { misfit: misfitClient },
});

export const { useConnection, useRoom, useGame, useTimer, useEvent } = porter.hooks;

/** The Integrator's own alias, as it writes `Ctx` on the server. */
export const useMisfit = () => useGame('misfit');
```

A screen:

```ts
function Round() {
  const { state, you, users, match } = useMisfit();
  const clock = useTimer('round');

  useEvent('roundEnded', (answers) => showAnswers(answers));
  useEvent('porter:messageRejected', ({ reason }) => showRejection(reason));

  const answer = (text: string) => porter.send('answer', { answer: text });
  // ...
}
```

## Verify during construction

- **React Compiler.** That the example front behaves the same with React Compiler on. If a component shows stale data, the piece of state it reads is not keeping the identity rule of [client.md](client.md#state), and the store is fixed.
- **Coarse notification.** That the four messages of a Match start give one render and that a countdown re-renders only its component. If the example front proves too slow, selectors are added to the hooks; the state stays plain data.

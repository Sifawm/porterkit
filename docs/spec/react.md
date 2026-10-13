# `@porterkit/react`

## Purpose

The Binding for React: it exposes the client of [client.md](client.md) to React through hooks. Everything the client does (login, connection, state, Appliers) is in that file; this one says what the hooks add.

- Dependency: `@porterkit/contracts`.
- Peer dependencies: `react` `^18.0.0 || ^19.0.0` and `@porterkit/client`, and nothing else.
- It does not create the client's instance: it is given one ([ADR 0007](../adr/0007-a-binding-is-given-the-instance.md)). It imports only types from `@porterkit/client` and runs none of its code.
- One entry point, the package root.
- It uses no state library, no dependency injection and no router.
- It exports no component and no route guard: `createHooks` and the type of what it returns.

## Public API

Everything exported is below. The types of `@porterkit/client` are imported from that package, not from this one.

```ts
import type { GameName, GamesMap } from '@porterkit/contracts';
import type {
  AnyGameView,
  Connection,
  GameView,
  Incoming,
  Porter,
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

export declare function createHooks<Games extends GamesMap, Profile>(
  porter: Porter<Games, Profile>,
): Hooks<Games, Profile>;
```

## Behaviour

### Hooks

- `createHooks(porter)` returns the hooks of that instance, typed from it: the type parameters are written only at `createPorter`. It has no effect, and it changes nothing in the instance.
- The Integrator calls it once, next to `createPorter`. Calling it again gives hooks that read the same instance.
- There is no Provider. The hooks read the instance they were made for, from any component.
- The hooks are a thin layer: each one reads the same values as the member of the instance it is named after, and re-renders when they change.
- The instance stays the Integrator's: it logs in, sends and leaves through it, and may hand it to another Binding at the same time.
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
- The refresh is the component's: it calls `remaining()` on its own interval. A countdown does not go through the store and re-renders only its own component.

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
import { createPorter } from '@porterkit/client';
import { createHooks } from '@porterkit/react';
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

export const { useConnection, useRoom, useGame, useTimer, useEvent } = createHooks(porter);

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

import type { GameName, GamesMap } from '@porterkit/contracts';
import type { AnyGameView, Connection, GameView, Incoming, Porter, RoomView, Timer } from '@porterkit/client';
import { useEffect, useRef, useSyncExternalStore } from 'react';

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

export function createHooks<Games extends GamesMap, Profile>(porter: Porter<Games, Profile>): Hooks<Games, Profile> {
  const on = porter.on as (event: string, listener: (data: any) => void) => () => void;
  const useStore = <T>(read: () => T) => useSyncExternalStore(porter.subscribe, read, read);
  const hooks = {
    useConnection: () => useStore(() => porter.connection),
    useRoom() {
      const room = useStore(() => porter.room);
      if (!room) throw new Error('Porter: useRoom() without a room; render it only while connected');
      return room;
    },
    useGame(name?: GameName<Games>) {
      // `game()` throws without a room, and a snapshot must not.
      useStore(() => (porter.room ? porter.game() : null));
      return name === undefined ? porter.game() : porter.game(name);
    },
    useTimer: (name: string) => useStore(() => porter.timer(name)),
    useEvent(event: string, listener: (data: any) => void) {
      const latest = useRef(listener);
      useEffect(() => {
        latest.current = listener;
      });
      useEffect(() => on(event, (data) => latest.current(data)), [event]);
    },
  };
  return hooks as unknown as Hooks<Games, Profile>;
}

import type { GameDefinition } from '@porterkit/contracts';

/** The Game's entry in the games map: a counter everyone pushes up to a target. */
export type Counter = {
  settings: { target: number };
  state: { count: number };
  userData: { clicks: number };
  client: { increment: undefined };
  server: { incremented: { by: string; count: number } };
  pauseReason: null;
  endReason: { reachedBy: string };
  rejectReason: 'invalidTarget';
};

export type Games = { counter: Counter };

/** This example has no Profile: every User logs in with `null`. */
export type Profile = null;

class CounterSettings {
  target = 10;

  set(data: Counter['settings']) {
    this.target = data.target;
  }
}

export const counter = {
  name: 'counter',
  minPlayers: 1,
  createSettings: () => new CounterSettings(),
  createState: () => ({ count: 0 }),
  createUserData: () => ({ clicks: 0 }),
} satisfies GameDefinition<Games, 'counter'>;

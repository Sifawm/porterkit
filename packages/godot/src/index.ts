import type { Porter } from '@porterkit/client';

const PARTS = ['connection', 'room', 'game'] as const;
export type Part = (typeof PARTS)[number];

/**
 * What the addon calls. Only strings, numbers, booleans and `null` cross to Godot as they are,
 * so everything else travels as JSON.
 */
export interface GodotFacade {
  /**
   * Tells the three parts at once, and from then on the parts whose JSON changed: one call per change of
   * the instance, with the JSON of an object that has only those parts.
   */
  subscribe(onChange: (json: string) => void): void;
  /** Returns the number that takes the listener off. */
  on(event: string, listener: (json: string) => void): number;
  off(listener: number): void;
  send(event: string, json?: string): boolean;
  /** Answers with the JSON of the login's result, or of `null` when the request itself failed. */
  login(json: string, done: (json: string) => void): void;
  /** Answers `null` when the request itself failed. */
  roomExists(roomId: string, done: (exists: boolean | null) => void): void;
  resume(): boolean;
  reconnect(): void;
  leave(): void;
  /** Milliseconds, or -1 when the active Match has no timer of that name. */
  timerRemaining(name: string): number;
}

/** Leaves the facade of this instance at `globalThis.porterGodot`, where the addon looks for it. */
export function exposeToGodot(porter: Porter<any, any>): GodotFacade {
  const on = porter.on as (event: string, listener: (data: unknown) => void) => () => void;
  const send = porter.send as (event: string, data?: unknown) => boolean;
  const listeners = new Map<number, () => void>();
  let lastListener = 0;

  const read = (part: Part) =>
    // `game()` throws without a room.
    JSON.stringify(part === 'game' ? (porter.room ? porter.game() : null) : porter[part]);

  const facade: GodotFacade = {
    subscribe(onChange) {
      const told: Partial<Record<Part, string>> = {};
      // ponytail: every change serializes the three parts to compare them, because what `game()`
      // returns is new after every change. Compare identities first if a state grows large.
      const tell = () => {
        const changed = PARTS.filter((part) => told[part] !== (told[part] = read(part)));
        if (changed.length) onChange(`{${changed.map((part) => `"${part}":${told[part]}`).join()}}`);
      };
      tell();
      porter.subscribe(tell);
    },
    on(event, listener) {
      listeners.set(
        ++lastListener,
        on(event, (data) => listener(JSON.stringify(data ?? null))),
      );
      return lastListener;
    },
    off(listener) {
      listeners.get(listener)?.();
      listeners.delete(listener);
    },
    send: (event, json) => (json === undefined ? send(event) : send(event, JSON.parse(json))),
    login(json, done) {
      porter.login(JSON.parse(json)).then(
        (result) => done(JSON.stringify(result)),
        () => done('null'),
      );
    },
    roomExists(roomId, done) {
      porter.roomExists(roomId).then(done, () => done(null));
    },
    resume: () => porter.resume(),
    reconnect: () => porter.reconnect(),
    leave: () => porter.leave(),
    timerRemaining: (name) => porter.timer(name)?.remaining() ?? -1,
  };
  (globalThis as { porterGodot?: GodotFacade }).porterGodot = facade;
  return facade;
}

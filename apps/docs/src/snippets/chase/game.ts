import type { GameDefinition } from '@porterkit/contracts';

export type Direction = 'up' | 'down' | 'left' | 'right';
export type Position = { x: number; y: number };

export type Chase = {
  settings: { size: number };
  state: { it: string; positions: Record<string, Position> };
  userData: { direction: Direction };
  client: { steer: { direction: Direction } };
  server: { caught: { by: string; who: string }; moved: Record<string, Position> };
  pauseReason: null;
  endReason: null;
  rejectReason: never;
};

export type Games = { chase: Chase };

// #region definition
export const chase = {
  name: 'chase',
  minPlayers: 2,
  tickRate: 20,
  createSettings: () => ({
    size: 32,
    set(data: { size: number }) {
      this.size = data.size;
    },
  }),
  createState: () => ({ it: '', positions: {} as Record<string, Position> }),
  createUserData: () => ({ direction: 'right' as Direction }),
} satisfies GameDefinition<Games, 'chase'>;
// #endregion

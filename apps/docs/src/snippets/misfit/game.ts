// #region types
import type { GameDefinition } from '@porterkit/contracts';

export interface Card {
  category: 'basics' | 'spicy';
  question: string;
}

export interface MisfitSettingsData {
  roundTime: number; // ms, 0 = no limit
  maxPoints: number;
}

/** The Game's entry in the games map. */
export type Misfit = {
  settings: MisfitSettingsData;
  state: { turn: string; card?: Card };
  userData: { answer: string; status: 'idle' | 'editing' | 'ready'; points: number };
  // imperative: what a client asks for
  client: {
    answer: { answer: string };
    nextRound: undefined;
    preStart: undefined;
    takeBreak: undefined;
  };
  // past tense: what the server announces
  server: {
    turnChanged: string;
    cardDealt: { card: Card };
    roundEnded: Array<{ name: string; answer: string }>;
    preStarted: undefined;
  };
  pauseReason: 'break' | null;
  endReason: { winners: string[] };
  rejectReason: 'invalidSettings' | 'alreadyAnswered' | 'noBreakLeft';
};

/** The games map: one line per Game. */
export type Games = { misfit: Misfit };
// #endregion

// #region definition
export class MisfitSettings implements MisfitSettingsData {
  roundTime = 30_000;
  maxPoints = 10;

  set(data: MisfitSettingsData) {
    Object.assign(this, data);
  }
}

export class MisfitState {
  turn = '';
  card?: Card;
}

export class MisfitUserData {
  answer = '';
  status: 'idle' | 'editing' | 'ready' = 'idle';
  points = 0;
}

export const misfit = {
  name: 'misfit',
  minPlayers: 3,
  createSettings: () => new MisfitSettings(),
  createState: () => new MisfitState(),
  createUserData: () => new MisfitUserData(),
} satisfies GameDefinition<Games, 'misfit'>;
// #endregion

// #region aliases
export type Profile = { avatar: string };
// #endregion

// #region wire
import type { ClientMessage, ServerMessage } from '@porterkit/contracts';

export type Client = ClientMessage<Games, Profile>;
export type Server = ServerMessage<Games, Profile>;
// #endregion

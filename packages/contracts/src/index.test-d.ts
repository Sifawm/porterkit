import { expectTypeOf, test } from 'vitest';
import type { ClientMessage, GameDefinition, GamesMap, JoinedGame, PorterEvents, ServerMessage } from './index.js';

type Counter = {
  settings: { target: number };
  state: { count: number };
  userData: { clicks: number };
  client: { increment: undefined };
  server: { incremented: number };
  pauseReason: null;
  endReason: { winner: string };
  rejectReason: 'invalidSettings';
};
type Quiz = {
  settings: { rounds: number };
  state: { question: string };
  userData: { answer: string };
  client: { answer: { answer: string } };
  server: { asked: { question: string } };
  pauseReason: 'break';
  endReason: null;
  rejectReason: 'tooLate';
};
type Games = { counter: Counter; quiz: Quiz };
type Profile = { avatar: string };

test('a games map written as type aliases satisfies GamesMap', () => {
  expectTypeOf<Games>().toExtend<GamesMap>();
});

test('a Game event named porter:… does not satisfy GamesMap', () => {
  type Bad = { counter: Omit<Counter, 'client'> & { client: { 'porter:cheat': undefined } } };
  expectTypeOf<Bad>().not.toExtend<GamesMap>();
});

test('ClientMessage holds Porter commands and each Game event, without data when undefined', () => {
  type M = ClientMessage<Games>;
  expectTypeOf<{ event: 'increment' }>().toExtend<M>();
  expectTypeOf<{ event: 'answer'; data: { answer: string } }>().toExtend<M>();
  expectTypeOf<{ event: 'porter:startMatch' }>().toExtend<M>();
  expectTypeOf<Extract<M, { event: 'answer' }>>().toEqualTypeOf<{ event: 'answer'; data: { answer: string } }>();
  expectTypeOf<Extract<M, { event: 'increment' }>>().toEqualTypeOf<{ event: 'increment' }>();
  expectTypeOf<{ event: 'nope' }>().not.toExtend<M>();
});

test('ServerMessage discriminates by event', () => {
  type M = ServerMessage<Games, Profile>;
  expectTypeOf<Extract<M, { event: 'incremented' }>['data']>().toEqualTypeOf<number>();
  expectTypeOf<Extract<M, { event: 'asked' }>['data']>().toEqualTypeOf<{ question: string }>();
  expectTypeOf<Extract<M, { event: 'porter:joined' }>['data']['users'][number]['profile']>().toEqualTypeOf<Profile>();
});

test('JoinedGame and porter:gameChanged discriminate by Game name', () => {
  type Q = Extract<JoinedGame<Games>, { name: 'quiz' }>;
  expectTypeOf<Q['settings']>().toEqualTypeOf<{ rounds: number }>();
  expectTypeOf<Q['userData']>().toEqualTypeOf<Record<string, { answer: string }>>();
  type C = Extract<PorterEvents<Games, Profile>['porter:gameChanged'], { game: 'counter' }>;
  expectTypeOf<C['settings']>().toEqualTypeOf<{ target: number }>();
});

test('a class with methods beyond set satisfies GameDefinition', () => {
  class Settings {
    target = 10;
    set(data: { target: number }) {
      Object.assign(this, data);
    }
    double() {
      return this.target * 2;
    }
  }
  class UserData {
    clicks = 0;
    click() {
      this.clicks++;
    }
  }
  const counter = {
    name: 'counter',
    minPlayers: 1,
    createSettings: () => new Settings(),
    createState: () => ({ count: 0 }),
    createUserData: () => new UserData(),
  } satisfies GameDefinition<Games, 'counter'>;
  expectTypeOf(counter.createUserData()).toHaveProperty('click');
});

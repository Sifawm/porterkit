import { expectTypeOf, test } from 'vitest';
import type { Incoming, Outgoing, Porter } from './index.js';
import type { Games, Profile } from './testing.js';

declare const porter: Porter<Games, Profile>;

test('send is typed for Porter commands and the client events of every Game', () => {
  expectTypeOf(porter.send('increment')).toBeBoolean();
  porter.send('answer', { answer: 'x' });
  porter.send('porter:lockRoom', { locked: true });
  // @ts-expect-error data of the wrong shape
  porter.send('answer', { answer: 7 });
  // @ts-expect-error a message with data needs it
  porter.send('answer');
  // @ts-expect-error not an event of any Game
  porter.send('dance');
  // @ts-expect-error the pong cannot be sent
  porter.send('porter:pong');
});

test('on is typed for Porter events and the server events of every Game', () => {
  porter.on('incremented', (data) => expectTypeOf(data).toEqualTypeOf<{ by: string; count: number }>());
  porter.on('asked', (data) => expectTypeOf(data).toEqualTypeOf<{ question: string }>());
  porter.on('porter:userLeft', (data) => expectTypeOf(data.reason).toEqualTypeOf<'timeout' | 'kicked'>());
  // @ts-expect-error the ping cannot be listened to
  porter.on('porter:ping', () => {});
});

test('an event two Games share with different data is an error at the call, not any', () => {
  type Clash = {
    a: Games['counter'] & { client: { go: { speed: number } }; server: { went: number } };
    b: Games['quiz'] & { client: { go: { direction: string } }; server: { went: string } };
  };
  expectTypeOf<Outgoing<Clash>['go']>().not.toBeAny();
  expectTypeOf<Incoming<Clash, Profile>['went']>().toBeNever();
  expectTypeOf<Outgoing<Clash>['go']>().toEqualTypeOf<{ speed: number } & { direction: string }>();
});

test('game() is discriminated by name', () => {
  const game = porter.game();
  if (game.name === 'quiz') expectTypeOf(game.state).toEqualTypeOf<Readonly<{ question: string }>>();
  expectTypeOf(porter.game('counter').you.data).toEqualTypeOf<Readonly<{ clicks: number }>>();
  expectTypeOf(porter.game('counter').match).toExtend<{ status: string }>();
});

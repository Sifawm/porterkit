import { expect, test } from 'vitest';
import { GameManager } from './decorators';
import { Porter } from './porter';
import { counter, CounterManager, OtherManager } from './testing';

test.each([
  ['capacity', 0],
  ['capacity', 1.5],
  ['maxNameLength', null],
  ['maxProfileSize', 3],
  ['pingInterval', 0],
  ['gracePeriod', Infinity],
  ['validateProfile', 'yes'],
])('the option %s = %j stops Porter from starting, and the error names both', (option, value) => {
  expect(() => new Porter({ initialGame: 'counter', [option]: value }, [new CounterManager()])).toThrow(
    new RegExp(`${option}.*${String(value)}`),
  );
});

test('an option that is undefined takes its default, and a fractional interval is valid', async () => {
  const porter = new Porter({ initialGame: 'counter', capacity: undefined, pingInterval: 0.5 }, [new CounterManager()]);
  expect(await porter.login({ name: 'x'.repeat(20) })).toMatchObject({ status: 200 });
});

test('two Managers for the same Game stop Porter from starting, naming the Game and both classes', () => {
  @GameManager({ ...counter })
  class Twin {}
  expect(() => new Porter({ initialGame: 'counter' }, [new CounterManager(), new Twin()])).toThrow(
    /counter.*CounterManager.*Twin/,
  );
});

test('initialGame must name a registered Game; with no Manager the error says so', () => {
  expect(() => new Porter({ initialGame: 'chess' }, [new OtherManager()])).toThrow(/initialGame "chess"/);
  expect(() => new Porter({ initialGame: 'chess' }, [])).toThrow(/no Manager is registered/);
  // The options are checked before the Managers.
  expect(() => new Porter({ initialGame: 'chess', capacity: 0 }, [])).toThrow(/capacity/);
});

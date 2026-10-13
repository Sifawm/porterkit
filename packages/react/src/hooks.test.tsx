import { act, render, renderHook, screen } from '@testing-library/react';
import { memo, StrictMode, useEffect } from 'react';
import { afterEach, expect, test, vi } from 'vitest';
import { FakeSocket, joined, setup } from '../../client/src/testing.js';
import { createHooks } from './hooks.js';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

test('the hooks read what the instance holds and re-render when it changes', async () => {
  const { porter, connected } = setup();
  const hooks = createHooks(porter);
  const { useConnection, useRoom, useGame } = hooks;
  const connection = renderHook(() => useConnection());
  expect(connection.result.current).toEqual({ status: 'idle' });

  let socket!: FakeSocket;
  await act(async () => void (socket = await connected()));
  expect(connection.result.current).toEqual({ status: 'connected' });

  const room = renderHook(() => useRoom());
  const game = renderHook(() => useGame('counter'));
  expect(room.result.current).toBe(porter.room);
  expect(game.result.current.you.data).toEqual({ clicks: 0 });

  act(() => socket.emit('incremented', { by: 'Ana', count: 1 }));
  expect(game.result.current.state.count).toBe(1);
  expect(game.result.current.you.data).toEqual({ clicks: 1 });
  expect(room.result.current.you.data).toEqual({ clicks: 1 });
});

test('useRoom and useGame throw without a room, and useGame for a Game that is not the active one', async () => {
  const { porter, connected } = setup();
  const hooks = createHooks(porter);
  vi.spyOn(console, 'error').mockImplementation(() => {});
  expect(() => renderHook(() => hooks.useRoom())).toThrow();
  expect(() => renderHook(() => hooks.useGame())).toThrow();
  await act(async () => void (await connected()));
  expect(renderHook(() => hooks.useGame()).result.current.name).toBe('counter');
  expect(() => renderHook(() => hooks.useGame('quiz'))).toThrow(/counter/);
});

test('a memoized component re-renders only when its piece of the state changes', async () => {
  const { porter, connected } = setup();
  const hooks = createHooks(porter);
  const renders = vi.fn();
  const Row = memo(function Row({ user }: { user: { name: string; data: unknown } }) {
    renders(user.name);
    return <li>{`${user.name}:${JSON.stringify(user.data)}`}</li>;
  });
  function List() {
    const { users } = hooks.useGame('counter');
    return (
      <ul>
        {users.map((user) => (
          <Row key={user.name} user={user} />
        ))}
      </ul>
    );
  }
  let socket!: FakeSocket;
  await act(async () => void (socket = await connected()));
  render(<List />);
  renders.mockClear();

  act(() => socket.emit('incremented', { by: 'Bea', count: 1 }));
  expect(renders.mock.calls).toEqual([['Bea']]);
  expect(screen.getByText('Bea:{"clicks":1}')).toBeTruthy();
});

test('useTimer gives the timer of that name, or null', async () => {
  const { porter, connected } = setup();
  const hooks = createHooks(porter);
  let socket!: FakeSocket;
  await act(async () => void (socket = await connected()));
  const timer = renderHook(() => hooks.useTimer('round'));
  expect(timer.result.current).toBeNull();
  act(() => {
    socket.emit('porter:matchStarted');
    socket.emit('porter:timerSet', { name: 'round', remaining: 5000 });
  });
  expect(timer.result.current!.paused).toBe(false);
  expect(timer.result.current!.remaining()).toBeGreaterThan(4000);
});

test('useEvent calls the latest listener without subscribing again on every render', async () => {
  const { porter, connected } = setup();
  const hooks = createHooks(porter);
  let socket!: FakeSocket;
  await act(async () => void (socket = await connected()));
  const on = vi.spyOn(porter, 'on');
  const heard: string[] = [];
  const hook = renderHook(({ tag }) => hooks.useEvent('cheered', (who) => heard.push(`${tag}:${who}`)), {
    initialProps: { tag: 'first' },
  });
  hook.rerender({ tag: 'second' });
  act(() => socket.emit('cheered', 'Bea'));
  expect(heard).toEqual(['second:Bea']);
  hook.unmount();
  act(() => socket.emit('cheered', 'Bea'));
  expect(heard).toHaveLength(1);
  void on;
});

test('resume in an effect is safe under StrictMode', () => {
  const { porter, storage } = setup();
  const hooks = createHooks(porter);
  storage.map.set('porter', '{"token":"room000001.secret","roomId":"room000001"}');
  function Page() {
    useEffect(() => void porter.resume(), []);
    return <p>{hooks.useConnection().status}</p>;
  }
  render(
    <StrictMode>
      <Page />
    </StrictMode>,
  );
  expect(FakeSocket.all).toHaveLength(1);
  act(() => FakeSocket.last.emit('porter:joined', joined()));
  expect(screen.getByText('connected')).toBeTruthy();
});

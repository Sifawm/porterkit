import type { Transport } from '@porterkit/client';
import { type FormEvent, useEffect, useState } from 'react';
import { porter, transport, useConnection, useEvent, useGame, useRoom } from './porter';

export function App() {
  const connection = useConnection();
  useEffect(() => void porter.resume(), []);

  if (connection.status === 'connected') return <Room />;
  if (connection.status === 'connecting' || connection.status === 'reconnecting') return <p>Connecting…</p>;
  return (
    <>
      {connection.status === 'closed' && <p role="alert">Connection closed: {connection.reason}</p>}
      {connection.status === 'closed' && connection.reason === 'unreachable' ? (
        <button onClick={() => porter.reconnect()}>Try again</button>
      ) : (
        <Login />
      )}
    </>
  );
}

function Login() {
  const [name, setName] = useState('');
  const [roomId, setRoomId] = useState(() => location.hash.slice(1));
  const [error, setError] = useState('');

  async function submit(event: FormEvent) {
    event.preventDefault();
    try {
      const result = await porter.login({ name, profile: null, ...(roomId && { roomId }) });
      if (result.ok) location.hash = result.roomId;
      else setError(result.reason);
    } catch {
      setError('The server did not answer');
    }
  }

  return (
    <form onSubmit={submit}>
      <h1>Porter example</h1>
      <label>
        Name <input value={name} onChange={(e) => setName(e.target.value)} maxLength={20} required />
      </label>
      <label>
        Room <input value={roomId} onChange={(e) => setRoomId(e.target.value)} placeholder="empty creates one" />
      </label>
      <label>
        Transport{' '}
        <select defaultValue={transport.current} onChange={(e) => (transport.current = e.target.value as Transport)}>
          <option value="ws">WebSocket</option>
          <option value="sse">SSE</option>
        </select>
      </label>
      <button>{roomId ? 'Join' : 'Create room'}</button>
      {error && <p role="alert">{error}</p>}
    </form>
  );
}

function Room() {
  const room = useRoom();
  const game = useGame('counter');
  const [rejection, setRejection] = useState('');
  useEvent('porter:messageRejected', ({ rejected, reason }) =>
    setRejection(`${rejected}: ${typeof reason === 'string' ? reason : reason.reason}`),
  );

  const underWay = game.match.status === 'running' || game.match.status === 'paused';
  return (
    <main>
      <h1>Room {room.id}</h1>
      <button onClick={() => porter.leave()}>Leave</button>
      <ul>
        {game.users.map((user) => (
          <li key={user.name}>
            {user.name}
            {user.name === room.admin && ' (Admin)'}
            {user.status === 'reconnecting' && ' (away)'}: {user.data.clicks}
          </li>
        ))}
      </ul>

      {underWay ? (
        <Match />
      ) : (
        <section>
          {game.match.status === 'ended' && (
            <p>
              {game.match.reason.by === 'game'
                ? `${game.match.reason.reason.reachedBy} reached ${game.state.count}`
                : `Match ended (${game.match.reason.by})`}
            </p>
          )}
          <p>Target: {game.settings.target}</p>
          {room.isAdmin && (
            <>
              <button onClick={() => porter.send('porter:updateSettings', { target: game.settings.target + 5 })}>
                Target +5
              </button>
              <button onClick={() => porter.send('porter:startMatch')}>Start</button>
            </>
          )}
        </section>
      )}
      {rejection && <p role="alert">{rejection}</p>}
    </main>
  );
}

function Match() {
  const { isAdmin } = useRoom();
  const { state, settings, match } = useGame('counter');
  return (
    <section>
      <p>
        {state.count} / {settings.target}
        {match.status === 'paused' && ' (paused)'}
      </p>
      <button onClick={() => porter.send('increment')}>+1</button>
      {isAdmin && (
        <>
          {match.status === 'paused' ? (
            <button onClick={() => porter.send('porter:continueMatch')}>Continue</button>
          ) : (
            <button onClick={() => porter.send('porter:pauseMatch', { reason: null })}>Pause</button>
          )}
          <button onClick={() => porter.send('porter:endMatch')}>End</button>
        </>
      )}
    </section>
  );
}

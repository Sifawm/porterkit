import { useEffect } from 'react';
import { porter, useConnection, useRoom } from '../misfit/porter';

declare function Login(): React.JSX.Element;
declare function Round(): React.JSX.Element;

// #region app
export function App() {
  const connection = useConnection();
  // Safe under StrictMode, which runs the effect twice.
  useEffect(() => void porter.resume(), []);

  if (connection.status === 'connected') return <Room />;
  if (connection.status === 'connecting' || connection.status === 'reconnecting') return <p>Connecting…</p>;
  if (connection.status === 'closed' && connection.reason === 'unreachable') {
    return <button onClick={() => porter.reconnect()}>Try again</button>;
  }
  return <Login />;
}

// Rendered only while connected, so useRoom() always has a room.
function Room() {
  const room = useRoom();
  return (
    <main>
      <h1>Room {room.id}</h1>
      {room.isAdmin && <button onClick={() => porter.send('porter:startMatch')}>Start</button>}
      <Round />
    </main>
  );
}
// #endregion

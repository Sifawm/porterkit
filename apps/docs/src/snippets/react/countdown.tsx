import { useEffect, useState } from 'react';
import { useTimer } from '../misfit/porter';

// #region countdown
export function Countdown() {
  const timer = useTimer('round');
  const [, refresh] = useState(0);

  // The refresh is the component's own: only Countdown re-renders.
  useEffect(() => {
    const id = setInterval(() => refresh((n) => n + 1), 250);
    return () => clearInterval(id);
  }, []);

  if (!timer) return null;
  const seconds = Math.ceil(timer.remaining() / 1000);
  return <p>{timer.paused ? `${seconds} s (paused)` : `${seconds} s`}</p>;
}
// #endregion

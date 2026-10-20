import { porter, useEvent, useMisfit } from '../misfit/porter';

declare function showAnswers(answers: Array<{ name: string; answer: string }>): void;
declare function showRejection(reason: unknown): void;

// #region round
export function Round() {
  const { state, you, users, match } = useMisfit();

  useEvent('roundEnded', (answers) => showAnswers(answers));
  useEvent('porter:messageRejected', ({ reason }) => showRejection(reason));

  const answer = (text: string) => porter.send('answer', { answer: text });

  return (
    <section>
      <p>{state.card?.question}</p>
      {match.status === 'paused' && <p>Paused</p>}
      <ul>
        {users.map((user) => (
          <li key={user.name}>
            {user.name}: {user.data.points}
          </li>
        ))}
      </ul>
      {you.data.status !== 'ready' && <button onClick={() => answer('the owl')}>Answer</button>}
    </section>
  );
}
// #endregion

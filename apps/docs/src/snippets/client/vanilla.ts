import type { Connection } from '@porterkit/client';
import { porter } from '../misfit/porter';

declare function showConnection(connection: Connection): void;
declare function showRound(turn: string, card: string | undefined, points: number): void;
declare function showAnswers(answers: Array<{ name: string; answer: string }>): void;
declare function showRejection(reason: unknown): void;

// #region read
porter.subscribe(() => {
  if (porter.connection.status !== 'connected') return showConnection(porter.connection);
  const { state, you } = porter.game('misfit');
  showRound(state.turn, state.card?.question, you.data.points);
});
porter.on('roundEnded', (answers) => showAnswers(answers));
porter.on('porter:messageRejected', ({ reason }) => showRejection(reason));

const answer = (text: string) => porter.send('answer', { answer: text });
// #endregion

// #region admin
if (porter.room?.isAdmin) {
  porter.send('porter:updateSettings', { roundTime: 20_000, maxPoints: 5 });
  porter.send('porter:startMatch');
}
// #endregion

export { answer };

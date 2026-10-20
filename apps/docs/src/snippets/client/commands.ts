import { porter } from '../misfit/porter';

declare function showVeto(reason: string): void;

// #region send
porter.send('answer', { answer: 'the owl' });
porter.send('nextRound');
// #endregion

// #region profile
porter.send('porter:updateProfile', { profile: { avatar: 'owl' } });
// #endregion

// #region rejection
porter.on('porter:messageRejected', ({ rejected, reason }) => {
  if (rejected === 'porter:startMatch' && typeof reason === 'object') showVeto(reason.reason);
});
// #endregion

// #region lock
porter.send('porter:lockRoom', { locked: true });
// #endregion

// #region kick
porter.send('porter:kickUser', { name: 'Bea' });
// #endregion

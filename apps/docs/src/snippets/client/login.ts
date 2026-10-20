import { porter } from '../misfit/porter';

declare function showLoginError(reason: string): void;

// #region login
if (!porter.resume()) {
  const result = await porter.login({ name: 'Ana', profile: { avatar: 'fox' } });
  if (!result.ok) showLoginError(result.reason);
}
// #endregion

// #region join
const roomId = location.hash.slice(1);
if (roomId && !(await porter.roomExists(roomId))) showLoginError('roomNotFound');
else await porter.login({ name: 'Ana', profile: { avatar: 'fox' }, roomId });
// #endregion

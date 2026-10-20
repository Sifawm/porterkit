import { Injectable, Module } from '@nestjs/common';
import { PorterModule } from '@porterkit/nestjs';
import type { Games, Profile } from '../misfit/game';

const avatars = ['fox', 'owl', 'cat'];
const isProfile = (p: unknown): p is Profile => avatars.includes((p as Profile | null)?.avatar ?? '');
const avatarOf = (p: unknown) => (p as Profile).avatar;

// #region options
PorterModule.forRoot<Games>({
  initialGame: 'misfit',
  capacity: 8,
  maxNameLength: 16,
  maxProfileSize: 256,
  // Refuses a Profile that is not one of ours, or whose avatar someone in the room already has.
  validateProfile: (profile, others) => isProfile(profile) && !others.map(avatarOf).includes(profile.avatar),
  // At login, the first avatar left free. When none is left, the login is `invalidProfile`.
  fallbackProfile: (others) => ({ avatar: avatars.find((a) => !others.map(avatarOf).includes(a)) }),
  pingInterval: 15_000,
  gracePeriod: 60_000,
});
// #endregion

// #region async
@Injectable()
class Limits {
  capacity = Number(process.env.ROOM_CAPACITY ?? 16);
}

@Module({ providers: [Limits], exports: [Limits] })
class LimitsModule {}

PorterModule.forRootAsync<Games>({
  imports: [LimitsModule],
  inject: [Limits],
  useFactory: (limits: Limits) => ({ initialGame: 'misfit', capacity: limits.capacity }),
});
// #endregion

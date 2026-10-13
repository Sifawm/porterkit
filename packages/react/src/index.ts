import { createPorter as createClient, type Porter as Client, type PorterOptions } from '@porterkit/client';
import type { GamesMap } from '@porterkit/contracts';
import { createHooks, type Hooks } from './hooks.js';

export { defineGame } from '@porterkit/client';
export type * from '@porterkit/client';

export interface Porter<Games extends GamesMap, Profile> extends Client<Games, Profile> {
  readonly hooks: Hooks<Games, Profile>;
}

export function createPorter<Games extends GamesMap, Profile = unknown>(
  options: PorterOptions<Games>,
): Porter<Games, Profile> {
  const porter = createClient<Games, Profile>(options);
  return Object.assign(porter, { hooks: createHooks(porter) });
}

import { type GameContext, GameManager, type GameManager as Manager, handlersOf, type UserOf } from '@porterkit/nestjs';
import { counter, type Games } from '@porterkit/example-game';

const On = handlersOf<Games, 'counter'>();
type Ctx = GameContext<Games, typeof counter>;
type CounterUser = UserOf<Games, typeof counter>;

const isSettings = (data: unknown): data is { target: number } => {
  const target = (data as { target?: unknown }).target;
  return Number.isInteger(target) && (target as number) >= 1;
};

@GameManager(counter)
export class CounterManager implements Manager<Ctx> {
  defaultSettings() {
    return { target: 10 };
  }

  updateSettings(ctx: Ctx, next: unknown) {
    if (!isSettings(next)) throw ctx.reject('invalidTarget');
    ctx.game.settings.set({ target: next.target });
  }

  @On('increment')
  increment(ctx: Ctx, _data: undefined, user: CounterUser) {
    user.data.clicks += 1;
    ctx.game.state.count += 1;
    ctx.room.broadcast('incremented', { by: user.name, count: ctx.game.state.count });
    if (ctx.game.state.count >= ctx.game.settings.target) ctx.endMatch({ reachedBy: user.name });
  }
}

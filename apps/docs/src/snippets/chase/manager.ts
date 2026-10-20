import {
  type GameContext,
  GameManager,
  type GameManager as Manager,
  handlersOf,
  type OnTick,
  type UserOf,
} from '@porterkit/nestjs';
import { chase, type Direction, type Games, type Position } from './game';

const On = handlersOf<Games, 'chase'>();
type Ctx = GameContext<Games, typeof chase, { ticks: number }>;
type ChaseUser = UserOf<Games, typeof chase>;

const directions = ['up', 'down', 'left', 'right'];
const isDirection = (d: unknown): d is { direction: Direction } =>
  directions.includes((d as { direction?: string })?.direction ?? '');
const step: Record<Direction, Position> = {
  up: { x: 0, y: -1 },
  down: { x: 0, y: 1 },
  left: { x: -1, y: 0 },
  right: { x: 1, y: 0 },
};

// #region manager
@GameManager(chase)
export class ChaseManager implements Manager<Ctx>, OnTick<Ctx> {
  defaultSettings() {
    return { size: 32 };
  }

  updateSettings(ctx: Ctx, next: unknown) {
    ctx.game.settings.set({ size: Number((next as { size?: unknown }).size) || 32 });
  }

  createMemory() {
    return { ticks: 0 };
  }

  onTick(ctx: Ctx) {
    const { room, game, memory } = ctx;
    memory.ticks += 1;
    for (const user of room.users) {
      const at = game.state.positions[user.name] ?? { x: 0, y: 0 };
      const { x, y } = step[user.data.direction];
      game.state.positions[user.name] = { x: at.x + x, y: at.y + y };
    }
    // What happened: the client has an Applier for it.
    for (const who of this.caughtBy(game.state)) {
      room.broadcast('caught', { by: game.state.it, who });
      game.state.it = who;
    }
    // Where everything is now: no Applier, only the listener that draws.
    room.broadcast('moved', game.state.positions);
  }

  @On('steer', isDirection)
  steer(_ctx: Ctx, { direction }: { direction: Direction }, user: ChaseUser) {
    // A message is not a Tick: record what the User asked for, and let onTick act on it.
    user.data.direction = direction;
  }
  // #endregion

  private caughtBy(state: Games['chase']['state']): string[] {
    const it = state.positions[state.it];
    if (!it) return [];
    return Object.entries(state.positions)
      .filter(([name, p]) => name !== state.it && p.x === it.x && p.y === it.y)
      .map(([name]) => name)
      .slice(0, 1);
  }
}

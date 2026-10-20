// #region imports
import {
  AdminOnly,
  AnyTime,
  type CanStart,
  type CreateMemory,
  type GameContext,
  GameManager,
  type GameManager as Manager,
  handlersOf,
  type OnEnd,
  type OnPause,
  type OnStart,
  type OnUserLeft,
  type UserOf,
} from '@porterkit/nestjs';
import type { EndReason } from '@porterkit/contracts';
import { CardService } from './card.service';
import { type Card, type Games, misfit, type MisfitSettingsData } from './game';
// #endregion

// #region aliases
const On = handlersOf<Games, 'misfit'>();
type MisfitUser = UserOf<Games, typeof misfit>;
type Ctx = GameContext<Games, typeof misfit, MisfitMemory>;
// #endregion

// #region memory
/** The Match memory: never sent to anyone. */
interface MisfitMemory {
  shown: Card[];
  breaks: number;
}
// #endregion

// #region guards
const isAnswer = (d: unknown): d is { answer: string } => typeof (d as { answer?: unknown })?.answer === 'string';
const isSettings = (d: unknown): d is MisfitSettingsData =>
  Number.isFinite((d as MisfitSettingsData)?.roundTime) && Number.isInteger((d as MisfitSettingsData)?.maxPoints);
// #endregion

// #region class
@GameManager(misfit)
export class MisfitManager
  implements
    Manager<Ctx>,
    CreateMemory<Ctx>,
    CanStart<Ctx>,
    OnStart<Ctx>,
    OnPause<Ctx, Games['misfit']['pauseReason']>,
    OnEnd<Ctx>,
    OnUserLeft<Ctx>
{
  constructor(private readonly cards: CardService) {}

  // …the methods below
  // #endregion

  // #region settings
  async defaultSettings() {
    return { roundTime: 30_000, maxPoints: await this.cards.count() };
  }

  updateSettings(ctx: Ctx, next: unknown) {
    if (!isSettings(next)) throw ctx.reject('invalidSettings');
    ctx.game.settings.set(next);
  }
  // #endregion

  // #region createMemory
  createMemory(): MisfitMemory {
    return { shown: [], breaks: 0 };
  }
  // #endregion

  // #region hooks
  canStart(ctx: Ctx) {
    if (ctx.game.settings.maxPoints < 1) throw ctx.reject('invalidSettings');
  }

  // porter:matchStarted is already out; state, per-User data and memory are new.
  async onStart(ctx: Ctx) {
    await this.startRound(ctx);
  }

  onPause(ctx: Ctx, reason: Games['misfit']['pauseReason']) {
    if (reason === 'break') ctx.memory.breaks += 1;
  }

  onEnd(_ctx: Ctx, reason: EndReason<Games['misfit']['endReason']>) {
    if (reason.by === 'game') console.log('Winners:', reason.reason.winners);
  }

  onUserLeft(ctx: Ctx) {
    if (this.everyoneAnswered(ctx)) this.endRound(ctx);
  }
  // #endregion

  // #region handlers
  @AdminOnly()
  @AnyTime()
  @On('preStart')
  preStart(ctx: Ctx) {
    ctx.room.broadcast('preStarted');
  }

  @On('answer', isAnswer)
  answer(ctx: Ctx, { answer }: { answer: string }, user: MisfitUser) {
    if (user.data.status === 'ready') throw ctx.reject('alreadyAnswered');
    user.data.answer = answer;
    user.data.status = 'ready';
    if (this.everyoneAnswered(ctx)) this.endRound(ctx);
  }

  @AdminOnly()
  @On('nextRound')
  nextRound(ctx: Ctx) {
    const winners = ctx.room.users.filter((u) => u.data.points >= ctx.game.settings.maxPoints).map((u) => u.name);
    if (winners.length > 0) return ctx.endMatch({ winners });
    return this.startRound(ctx);
  }
  // #endregion

  // #region pause
  /** Any User may ask for one break per Match: not only the Admin. */
  @On('takeBreak')
  takeBreak(ctx: Ctx) {
    if (ctx.memory.breaks > 0) throw ctx.reject('noBreakLeft');
    ctx.pauseMatch('break');
  }
  // #endregion

  // #region round
  private async startRound(ctx: Ctx) {
    for (const u of ctx.room.users) {
      u.data.answer = '';
      u.data.status = 'idle';
    }
    const players = ctx.room.connected;
    const turn = players.findIndex((u) => u.name === ctx.game.state.turn);
    ctx.game.state.turn = players[(turn + 1) % players.length].name;
    ctx.room.broadcast('turnChanged', ctx.game.state.turn);

    const card = await this.cards.random(ctx.memory.shown);
    // After the await, read everything again from the context.
    ctx.memory.shown.push(card);
    ctx.game.state.card = card;

    if (ctx.game.settings.roundTime !== 0) {
      ctx.timers.set('round', ctx.game.settings.roundTime, () => this.endRound(ctx));
    }
    ctx.room.broadcast('cardDealt', { card });
  }

  private endRound(ctx: Ctx) {
    ctx.timers.clear('round');
    const answered = ctx.room.users.filter((u) => u.data.status === 'ready');
    for (const u of answered) u.data.points += 1;
    ctx.room.broadcast(
      'roundEnded',
      answered.map((u) => ({ name: u.name, answer: u.data.answer })),
    );
  }
  // #endregion

  private everyoneAnswered(ctx: Ctx) {
    return ctx.room.connected.every((u) => u.data.status === 'ready');
  }
}

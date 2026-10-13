import type { EndReason, JoinedMatch, MatchStatus } from '@porterkit/contracts';

interface Timer {
  /** Milliseconds left when it last stopped, or when it was set. Means nothing while it runs. */
  remaining: number;
  /** Means nothing while it is stopped. */
  endsAt: number;
  handle?: NodeJS.Timeout;
  callback: () => unknown;
}

/**
 * The Match of a Game in a room: whether there is one, whether it is paused, and its Match timers.
 * The timers run exactly while the Match is `running`. What is announced and which hook follows is Porter's.
 */
export class Match {
  private current: MatchStatus = { status: 'idle' };
  private readonly timers = new Map<string, Timer>();

  /** `fired` is called when a Match timer runs out, once the timer has ceased to exist. */
  constructor(private readonly fired: (name: string, callback: () => unknown) => void) {}

  get underWay(): boolean {
    return this.current.status === 'running' || this.current.status === 'paused';
  }

  /** Each of the four returns `false`, and changes nothing, when the Match is not where it has to be. */
  start(): boolean {
    if (this.underWay) return false;
    this.current = { status: 'running' };
    return true;
  }

  pause(reason: unknown): boolean {
    if (this.current.status !== 'running') return false;
    for (const timer of this.timers.values()) {
      clearTimeout(timer.handle);
      timer.remaining = Math.max(0, timer.endsAt - Date.now());
    }
    this.current = { status: 'paused', reason };
    return true;
  }

  continue(): boolean {
    if (this.current.status !== 'paused') return false;
    this.current = { status: 'running' };
    for (const [name, timer] of this.timers) this.run(name, timer);
    return true;
  }

  end(reason: EndReason): boolean {
    if (!this.underWay) return false;
    this.cancelTimers();
    this.current = { status: 'ended', reason };
    return true;
  }

  /** Throws without a Match under way and for a time that is not positive. */
  setTimer(name: string, ms: number, callback: () => unknown): void {
    if (!this.underWay) throw new Error(`Match timer "${name}" set without a Match under way`);
    if (!Number.isFinite(ms) || ms <= 0) throw new Error(`Match timer "${name}" set to ${ms} ms`);
    clearTimeout(this.timers.get(name)?.handle);
    const timer: Timer = { remaining: ms, endsAt: 0, callback };
    this.timers.set(name, timer);
    if (this.current.status === 'running') this.run(name, timer);
  }

  /** Whether there was one. */
  clearTimer(name: string): boolean {
    clearTimeout(this.timers.get(name)?.handle);
    return this.timers.delete(name);
  }

  /** The room ceases to exist, or the Match ends. */
  cancelTimers(): void {
    for (const timer of this.timers.values()) clearTimeout(timer.handle);
    this.timers.clear();
  }

  /** The Match as `porter:joined` carries it, with what each timer has left. */
  snapshot(): JoinedMatch {
    const { current } = this;
    if (current.status !== 'running' && current.status !== 'paused') return current;
    const left = (timer: Timer) =>
      current.status === 'running' ? Math.max(0, timer.endsAt - Date.now()) : timer.remaining;
    return { ...current, timers: Object.fromEntries([...this.timers].map(([name, timer]) => [name, left(timer)])) };
  }

  private run(name: string, timer: Timer) {
    timer.endsAt = Date.now() + timer.remaining;
    timer.handle = setTimeout(() => {
      this.timers.delete(name);
      this.fired(name, timer.callback);
    }, timer.remaining);
  }
}

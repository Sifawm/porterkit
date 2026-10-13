import type { Sink } from './porter';

type Message = Parameters<Sink['send']>[0];

/**
 * The Presence of a User: whether it has an open connection, the ping that tells a dead one and the Grace
 * period that runs without one. A connection has a ping exactly while it is open, and a Grace period runs
 * exactly while there is none. What is announced and which hook follows is Porter's.
 */
export class Presence {
  status: 'pending' | 'connected' | 'reconnecting' = 'pending';
  private sink?: Sink;
  private ponged = true;
  private ping?: NodeJS.Timeout;
  private grace?: NodeJS.Timeout;

  /** `dropped` is called when a ping goes unanswered, and `graceOver` when the Grace period runs out. */
  constructor(
    private readonly times: { pingInterval: number; gracePeriod: number },
    private readonly on: { dropped(): void; graceOver(): void },
  ) {
    this.startGrace();
  }

  /** Whether `sink` is the open connection. */
  has(sink: Sink): boolean {
    return this.sink === sink;
  }

  /** A connection opens. Returns the status before it; one already open gets `porter:replaced` and is closed. */
  attach(sink: Sink): Presence['status'] {
    const before = this.status;
    this.close({ event: 'porter:replaced' });
    clearTimeout(this.grace);
    this.status = 'connected';
    this.sink = sink;
    this.ponged = true;
    this.ping = setInterval(() => {
      if (!this.ponged) {
        // Dropped first: a transport may report the close before `close` returns.
        this.closed(sink);
        this.on.dropped();
        return sink.close();
      }
      this.ponged = false;
      sink.send({ event: 'porter:ping' });
    }, this.times.pingInterval);
    return before;
  }

  /** The transport reports that `sink` dropped. `false`, and nothing changes, when it is not the open connection. */
  closed(sink: Sink): boolean {
    if (this.sink !== sink) return false;
    clearInterval(this.ping);
    this.sink = undefined;
    this.status = 'reconnecting';
    this.startGrace();
    return true;
  }

  pong(): void {
    this.ponged = true;
  }

  /** Does nothing without an open connection. */
  send(message: Message): void {
    this.sink?.send(message);
  }

  /** The User is out of the room, or Porter is destroyed: an open connection gets `last` and is closed, and no timer is left. */
  end(last?: Message): void {
    this.close(last);
    clearTimeout(this.grace);
  }

  /** Detached first: a transport may report the close before `close` returns. */
  private close(last?: Message) {
    const { sink } = this;
    if (!sink) return;
    clearInterval(this.ping);
    this.sink = undefined;
    if (last) sink.send(last);
    sink.close();
  }

  private startGrace() {
    this.grace = setTimeout(() => this.on.graceOver(), this.times.gracePeriod);
  }
}

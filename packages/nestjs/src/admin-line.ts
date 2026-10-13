/** What the line reads of a User. */
interface Candidate {
  status: 'pending' | 'connected' | 'reconnecting';
}

/**
 * The Admin of a room and the line of Users that have been Admin. Each of the three methods is told what
 * happened to a User and returns whether the Admin changed; announcing it is Porter's.
 */
export class AdminLine<U extends Candidate> {
  admin: U;
  /** In the order they became Admin. The Admin is the last. */
  private line: U[];

  constructor(first: U) {
    this.admin = first;
    this.line = [first];
  }

  /** A User that was away has a connection: it recovers the Admin by its place in the line, or takes it from an Admin that is away. */
  connected(user: U): boolean {
    const at = this.line.indexOf(user);
    const earlier = at >= 0 && at < this.line.indexOf(this.admin);
    return (earlier || this.admin.status !== 'connected') && this.set(user);
  }

  /** The User's connection dropped. The first `connected` of `users` succeeds an Admin; with none, it stays. */
  dropped(user: U, users: readonly U[]): boolean {
    if (this.admin !== user) return false;
    const next = users.find((u) => u.status === 'connected');
    return next !== undefined && this.set(next);
  }

  /** The User left the room and `users` no longer has it. An Admin is succeeded by the first User left, the away ones last. */
  left(user: U, users: readonly U[]): boolean {
    this.line = this.line.filter((u) => u !== user);
    if (this.admin !== user || users.length === 0) return false;
    const next = (['connected', 'reconnecting', 'pending'] as const)
      .map((status) => users.find((u) => u.status === status))
      .find((u) => u !== undefined)!;
    return this.set(next);
  }

  /** Those behind the new Admin leave the line. */
  private set(user: U): boolean {
    if (this.admin === user) return false;
    const at = this.line.indexOf(user);
    if (at >= 0) this.line.length = at + 1;
    else this.line.push(user);
    this.admin = user;
    return true;
  }
}

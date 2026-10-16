# Protocol

What travels between a client and Porter: the HTTP routes, the two transports, the connection lifecycle and every message. The TypeScript types for everything named here are in [contracts.md](contracts.md); the server behaviour behind each message is in [nestjs.md](nestjs.md).

## Envelope

Every message, in both directions and on both transports, is one JSON object:

```ts
{ event: string; data?: unknown }
```

- `data` is absent when the message carries none.
- Porter's own events start with `porter:`. A Game's events have no prefix and never start with `porter:`.
- Client messages are named in the imperative (`porter:lockRoom`), server messages in the past tense (`porter:roomLocked`). No name is used in both directions.
- Game names travel as plain strings.

## HTTP routes

| Route | Purpose |
|---|---|
| `POST /porter/login` | Creates or joins a room and issues the Token |
| `HEAD /porter/rooms/:id` | Tells whether a room exists |
| `GET /porter/events` | Opens a connection over SSE |
| `POST /porter/commands` | Client messages for a User connected over SSE |
| `/porter/ws` | Opens a connection over WebSocket |

- The paths are fixed. The four HTTP routes sit under whatever global prefix the Integrator sets; `/porter/ws` is absolute and ignores it. A client is therefore given two addresses: an HTTP base URL and a WebSocket URL.
- There is no route to create a room or to leave one.

### `POST /porter/login`

Request body: `{ name, profile, roomId? }`. Without `roomId`, Porter creates a room and the User becomes its Admin.

- A room id is 10 characters from `a-z` and `0-9`. It is compared exactly; Porter does not fold case.
- Only an absent `roomId` creates a room. Any `roomId` that is present and is not the id of a room, including `null`, an empty string or a value that is not a string, is `roomNotFound`.
- An absent `profile` is the same as `profile: null`. Porter does not require a Profile; an Integrator that does refuses `null` in its validator.

Success: `200` with `{ token, roomId }`.

Rejection: body `{ reason }`. A client tells rejections apart by `reason`, not by status.

| `reason` | Status | When |
|---|---|---|
| `invalidName` | 400 | `name` is not a string, is empty after trimming, or exceeds the maximum length |
| `invalidProfile` | 400 | `profile` exceeds the maximum size or the Integrator's validator refuses it, and so does the Integrator's fallback Profile when it has one |
| `roomNotFound` | 404 | no room has that `roomId` |
| `nameTaken` | 409 | a User in the room has that name, compared without regard to case |
| `roomFull` | 409 | the room is at capacity |
| `roomLocked` | 409 | the room is locked |
| `failed` | 500 | the login creates a room and the initial Game cannot supply its default settings; no room is created and no detail is given |

A login that deserves several rejections gets the first of this order: `invalidName`, `invalidProfile`, `roomNotFound`, `roomLocked`, `roomFull`, `nameTaken`, `failed`. A body that is not a JSON object is `invalidName`.

A successful login does not make the User visible to the others: that happens when it connects.

### `HEAD /porter/rooms/:id`

`200` if the room exists, `404` if not. No body and no other information.

### `POST /porter/commands`

Header `Authorization: Bearer <token>`. The body is one envelope.

| Case | Response |
|---|---|
| The Token is valid and its User is `connected` | `202`, no body |
| The header is missing or the Token is refused | `401` with `{ reason }`: `invalidToken`, `roomNotFound` or `notInRoom` |
| The User is `pending` or `reconnecting` | `409` with `{ reason: 'notConnected' }`; the message is discarded |

- The outcome of the message never comes in the HTTP response. It arrives on the stream, as an announcement or as `porter:messageRejected`. An invalid envelope also gets `202`, and its `malformed` on the stream.
- The route accepts messages from any `connected` User, including one whose connection is a WebSocket.
- `notConnected` exists only here. It is the one case where a message is lost without a `porter:messageRejected`.
- A client takes any response other than `202` and `401`, and a request that fails, as a dropped connection: it closes its stream and reconnects. The message is lost.

## Token

- The Token is an opaque string. A client stores it and sends it back unchanged ([ADR 0004](../adr/0004-opaque-room-token.md)).
- It contains only characters that need no escaping in a URL.
- It has no expiry. It is valid for as long as its User is in the room.
- It travels as the query parameter `token` on `/porter/ws` and `GET /porter/events`, and as `Authorization: Bearer` on `POST /porter/commands`.
- It is not tied to a transport: a User may drop on one and come back on the other.

## Transports

Both transports are always available, and the client chooses one each time it connects ([ADR 0001](../adr/0001-two-transports.md)). The messages and their order are the same on both.

**WebSocket.** Each frame is one envelope as JSON text, in both directions.

**SSE.** Each SSE event carries one envelope as JSON in its `data` field, on a single line. Only `data` means anything: the server need not send `event`, `id` or `retry`, a client ignores them and any other field when they come, and the server ignores `Last-Event-ID`. Nothing is replayed after a drop; the client gets the whole room again in `porter:joined`. Client messages go to `POST /porter/commands`, one envelope per request. Before the first message of each connection the server sends one SSE event whose `data` is a `:` followed by 2048 spaces; NestJS's `@Sse` cannot emit a comment line. A client discards any event whose `data` starts with `:` before reading it as an envelope. It makes an intermediary that buffers small responses release the stream.

## Connecting

There is no client message for joining a room: opening a connection with a valid Token is joining. The first message from the server is `porter:joined` or `porter:rejected`.

A refused connection is not an HTTP or WebSocket error. The server accepts the connection, sends `porter:rejected` with `{ reason }` and closes it.

| `reason` | When |
|---|---|
| `invalidToken` | the Token is missing or not in a valid format |
| `roomNotFound` | the Token's room no longer exists |
| `notInRoom` | the room exists and no User in it holds that Token |

A client does not retry after `porter:rejected`.

### `porter:joined`

```ts
{
  roomId: string;
  you: string;       // this User's name
  admin: string;     // the Admin's name
  locked: boolean;
  pingInterval: number;  // milliseconds; see "Ping"
  users: Array<{ name: string; profile: Profile; status: 'connected' | 'reconnecting' }>;
  game: {
    name: string;
    settings: Settings;                  // of the Game named by `name`
    state: State;
    userData: Record<string, UserData>;  // by User name
    match: Match;                        // see "Match"
  };
}
```

- It is the whole state of the room. A client replaces whatever it held with it, on the first connection and on every reconnection.
- `users` lists the Users that are `connected` or `reconnecting`, in the order they joined the room, including the receiver. A User that has logged in and not yet connected is not listed.
- `userData` has one entry for each User in `users`, here and at every later moment: a User's per-User data is created when it joins and goes when it leaves, whatever the Match's situation.
- There is no flag for being the Admin (`you === admin`) and no room capacity.

## Connection lifecycle

A User is in one of three states. Only `connected` and `reconnecting` are ever visible to other Users.

| State | Meaning |
|---|---|
| `pending` | logged in over HTTP, has not connected yet |
| `connected` | has an open connection |
| `reconnecting` | its connection dropped |

Every User without an open connection has a Grace period running. There is one Grace period, the same for `pending` and for `reconnecting`.

| From | To | When | What Porter sends |
|---|---|---|---|
| — | `pending` | login succeeds | nothing |
| `pending` | `connected` | connects with its Token | `porter:joined` to it, `porter:userJoined` to the others |
| `pending` | out | Grace period runs out | nothing |
| `connected` | `reconnecting` | the connection closes, or a ping goes unanswered | `porter:userDisconnected` to the others |
| `reconnecting` | `connected` | connects within the Grace period | `porter:joined` to it, `porter:userReconnected` to the others |
| `reconnecting` | out | Grace period runs out | `porter:userLeft` with `timeout` to the others |
| `connected` | `connected` | the same User opens a second connection | `porter:replaced` to the old connection, which is then closed; `porter:joined` to the new one; nothing to the others |

- A User that is out has left the room. Its Token then gets `porter:rejected` with `notInRoom`, and its name is free.
- There is no message for leaving. A User leaves by closing its connection and letting the Grace period run out; until then it keeps its place and its name.
- A second connection replaces the first, also across transports. A client that receives `porter:replaced` does not retry.
- The room ceases to exist when its last User leaves it.

### Ping

- The server sends `porter:ping` on every connection at a fixed interval. The client answers each one with `porter:pong`; over SSE the pong goes to `POST /porter/commands`.
- When a ping is due and no `porter:pong` has arrived since the previous one, the server closes the connection. That close is handled like any other drop.
- Ping and pong are messages, not WebSocket control frames, so the rule is the same on both transports.
- `porter:joined` carries the interval as `pingInterval`, in milliseconds. A client that has received no message at all for two intervals takes the connection as dropped: it closes it and reconnects. It is the server's own margin, so a ping that arrives late cuts no healthy connection.

The interval and the Grace period are options of the module, defined in [nestjs.md](nestjs.md).

## Messages

Announcements go to every `connected` User, including the one who asked, and serve as the confirmation. A client does not change its own state when it sends a message: it waits for the announcement or for `porter:messageRejected`.

### Client to server

Every message in this table is for the Admin only, except `porter:updateProfile` and `porter:pong`.

| Event | Data | Announced as |
|---|---|---|
| `porter:lockRoom` | `{ locked: boolean }` | `porter:roomLocked` |
| `porter:kickUser` | `{ name: string }` | `porter:userLeft`, and `porter:kicked` to the User removed |
| `porter:changeGame` | `{ game: string }` | `porter:gameChanged` |
| `porter:updateSettings` | the Game's settings, complete | `porter:settingsUpdated` |
| `porter:startMatch` | — | `porter:matchStarted` |
| `porter:pauseMatch` | `{ reason }`, the Game's pause reason | `porter:matchPaused` |
| `porter:continueMatch` | — | `porter:matchContinued` |
| `porter:endMatch` | — | `porter:matchEnded` |
| `porter:updateProfile` | `{ profile }`, the sender's new Profile | `porter:profileUpdated` |
| `porter:pong` | — | — |

Any other event that starts with `porter:` is handled by nobody: it gets `unhandled` and never reaches a Game. Any other event is a Game message and is delivered to the active Game.

A message that changes nothing is carried out and announced like any other. `porter:lockRoom` with the value the room already has is announced again as `porter:roomLocked`.

### Server to client

Room and presence:

| Event | Data | Sent to |
|---|---|---|
| `porter:joined` | see "`porter:joined`" | the User connecting |
| `porter:rejected` | `{ reason }` | the connection refused, which is then closed |
| `porter:replaced` | — | a connection about to be closed because its User opened another |
| `porter:kicked` | — | the User removed, before its connection is closed |
| `porter:userJoined` | `{ user: { name, profile, status: 'connected' } }` | the others |
| `porter:userDisconnected` | `{ name }` | the others; that User is now `reconnecting` |
| `porter:userReconnected` | `{ name }` | the others; that User is `connected` again |
| `porter:userLeft` | `{ name, reason: 'timeout' \| 'kicked' }` | the others |
| `porter:adminChanged` | `{ admin: string }` | everyone |
| `porter:roomLocked` | `{ locked: boolean }` | everyone |
| `porter:profileUpdated` | `{ name, profile }` | everyone |
| `porter:ping` | — | each connection |

Game and Match:

| Event | Data | Sent to |
|---|---|---|
| `porter:gameChanged` | `{ game: string, settings }` | everyone |
| `porter:settingsUpdated` | the Game's settings | everyone |
| `porter:matchStarted` | — | everyone |
| `porter:matchPaused` | `{ reason }` | everyone |
| `porter:matchContinued` | — | everyone |
| `porter:matchEnded` | `{ reason: EndReason }` | everyone |
| `porter:timerSet` | `{ name: string, remaining: number }` | everyone |
| `porter:timerCleared` | `{ name: string }` | everyone |
| `porter:messageRejected` | `{ rejected: string, reason }` | the sender only |

Any other event comes from the active Game.

### Removing a User

- A `connected` User receives `porter:kicked` and its connection is closed; the others receive `porter:userLeft` with `kicked`. A client does not retry after `porter:kicked`.
- A `reconnecting` User leaves at once and its Grace period is cancelled; the others receive `porter:userLeft` with `kicked`. It receives nothing, having no connection; if it comes back, its Token gets `porter:rejected` with `notInRoom`.
- A `pending` User cannot be removed: its name gives `notFound`.
- The Admin cannot remove itself: `notAllowedNow`.

### Profile

- A User changes only its own Profile, at any time, with or without a Match. The Profile replaces the one it had, whole.
- An absent `profile` is `null`, as at login. The new Profile passes the same checks as at login, against the Profiles of the room's other Users, `pending` ones included; when it does not, the sender gets `invalidProfile` and nothing changes. There is no fallback Profile here.

### Settings

- A Game has one settings type. The client sends the complete object, not a patch.
- The Game applies the update or rejects it. `porter:settingsUpdated` carries the settings as they are after the Game applied them, which may differ from what was sent.
- Settings may be updated at any time, with or without a Match.

### Changing the Game

- Only without a Match under way.
- The previous Game's settings, state, per-User data and last result are discarded. `porter:gameChanged` carries the new Game's default settings; its state and per-User data are new and its Match is `idle`.
- The message does not carry the new state or per-User data. Each client creates them from the shared Game definition.
- Changing to the Game that is already active is no exception: it goes back to the default settings, new state and per-User data, and `idle`.

## Match

A room is always in one of four situations with respect to its active Game:

```ts
type MatchStatus =
  | { status: 'idle' }                       // no Match of this Game has been played yet
  | { status: 'running' }
  | { status: 'paused'; reason: PauseReason }
  | { status: 'ended'; reason: EndReason };  // the result of the last Match, until another starts

type EndReason =
  | { by: 'game'; reason: GameEndReason }    // the Game ended it, with its own reason
  | { by: 'admin' }                          // porter:endMatch
  | { by: 'minPlayers' };                    // the Users in the room fell below the Game's minimum
```

| Event | New situation |
|---|---|
| `porter:matchStarted` | `running` |
| `porter:matchPaused` | `paused` |
| `porter:matchContinued` | `running` |
| `porter:matchEnded` | `ended` |
| `porter:gameChanged` | `idle` |

- `idle` is the waiting room before the first Match; `ended` is the results screen. After `porter:matchEnded` the state and per-User data of that Match stay as they were until the next Match starts, except that the per-User data of a User who leaves goes with it. A Game whose results must outlive the Users writes them into its state or its end reason.
- Starting again from `ended` is `porter:startMatch`. There is no separate message for playing again.
- `porter:matchStarted` carries no data. At every start the state and per-User data are created anew from the Game definition, the settings are kept and no Match timer exists. Each client does the same on receiving it.
- `porter:matchStarted` is sent before the Game sends anything for that Match. The Game announces its opening with messages of its own.
- The pause reason and the Game's end reason are the Game's own. Porter carries them without reading them.
- The `data` of `porter:pauseMatch` is an object. Its `reason` is not required and is not checked against anything: when absent it is `null`, and `porter:matchPaused` and `match` always carry `reason`. A Game without pause reasons uses `null`.
- A pause does not stop Game messages: the Game keeps receiving them while `paused`.
- A User may join a room with a Match under way.

In `porter:joined`, `game.match` is the situation plus, when `running` or `paused`, the Match timers:

```ts
| { status: 'running'; timers: Record<string, number> }
| { status: 'paused'; reason: PauseReason; timers: Record<string, number> }
```

### Match timers

- A Match timer is identified by a name, local to its Match. Every one of them is visible to every User.
- On the wire a timer is always the milliseconds remaining at the moment of sending, never an absolute time, so nothing depends on the client's clock. The client works out its own end time on receipt.
- `porter:timerSet` announces a timer that was created, or replaced by another of the same name. If the Match is `paused` the timer is announced all the same and does not run until the Match continues.
- `porter:timerCleared` announces a timer that was cleared or that fired. When it fires, the announcement is sent before the Game acts on it.
- While the Match is `paused` every timer is stopped. `porter:matchPaused` and `porter:matchContinued` carry no timer data: the client freezes its timers on the first and resumes them, with the time each had left, on the second.
- When the Match ends, all its timers cease to exist. No `porter:timerCleared` is sent for them: the client drops its timers on `porter:matchEnded`.
- In `porter:joined`, `timers` maps each timer's name to its remaining milliseconds, and is an empty object when there is none.

## Rejected messages

Whoever sends a message that Porter does not carry out receives, alone, `porter:messageRejected`:

```ts
{ rejected: string; reason: RejectReason }
```

`rejected` is the event name of the message. There is no correlation id. It covers Porter's messages and Game messages alike.

| `reason` | When |
|---|---|
| `'malformed'` | what arrived is not a valid envelope (`rejected` is then `''`); the `data` of one of Porter's messages has the wrong shape; or the Game's guard for that message refuses its `data` |
| `'notAdmin'` | the message is for the Admin only and the sender is not the Admin |
| `'notAllowedNow'` | the message is not valid in the current situation |
| `'belowMinPlayers'` | `porter:startMatch` with fewer Users than the Game's minimum |
| `'notFound'` | `porter:changeGame` names a Game that is not registered, or `porter:kickUser` names nobody that can be removed |
| `'unhandled'` | nobody handles that event: a Game message the active Game has no handler for, or a `porter:` event that is not one of Porter's |
| `'invalidProfile'` | `porter:updateProfile` with a Profile over the maximum size or that the Integrator's validator refuses |
| `'failed'` | the Game's code threw while attending the message: its handler, its settings update, its start veto, or its default settings on a `porter:changeGame`; no detail is given |
| `{ code: 'game', reason }` | the Game rejected it, with one of its own reject reasons |

`notAllowedNow` is the answer to:

- `porter:startMatch` with a Match under way;
- `porter:pauseMatch` when the Match is not `running`;
- `porter:continueMatch` when the Match is not `paused`;
- `porter:endMatch` without a Match under way;
- `porter:changeGame` with a Match under way, also one that starts while the new Game's default settings are being loaded;
- `porter:kickUser` naming the Admin itself;
- a Game message without a Match under way, unless the Game marks that message as valid at any time.

A message that deserves several rejections gets one, the first of this order. It is the same for Porter's messages and for Game messages:

| # | Check | Reason |
|---|---|---|
| 1 | the envelope is valid | `malformed` |
| 2 | somebody handles that event | `unhandled` |
| 3 | the sender may send it | `notAdmin` |
| 4 | its `data` has the right shape; for a Game message, its guard accepts it | `malformed` |
| 5 | the situation allows it | `notAllowedNow` |
| 6 | what it names exists | `notFound` |
| 7 | there are enough Users | `belowMinPlayers` |
| 8 | the Game accepts it; for `porter:updateProfile`, the Profile is accepted | `{ code: 'game' }` or `failed`; `invalidProfile` |

So a User that is not the Admin learns nothing from a message for the Admin only: it gets `notAdmin` whatever its `data` and whatever the situation, and a Game's guard does not run for it.

`{ code: 'game' }` is the answer to a Game message its handler rejects, to a `porter:updateSettings` the Game rejects, and to a `porter:startMatch` the Game vetoes.

For `porter:updateSettings` Porter checks only that `data` is an object; the rest is the Game's to validate. The Users counted against the minimum are those `connected` or `reconnecting`.

All reasons in this document, those of login, connection, commands and rejected messages, are closed sets. An Integrator adds its own only through a Game's reject reasons.

## Verify during construction

- **SSE fields.** Whether NestJS's `@Sse` adds an `id` to every event unasked. Nothing changes either way: a client ignores it.
- **SSE comment.** Whether NestJS's `@Sse` can emit a comment line. If it cannot, the 2048 spaces travel instead as a `data` field whose content starts with `:`, the client's parser discards any such event before reading it as an envelope, and the SSE paragraph of "Transports" changes to say so.

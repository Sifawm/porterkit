---
title: Protocol
description: The HTTP routes, the envelope and every message on the wire.
sidebar:
  order: 2
spec:
  - docs/spec/protocol.md
---

You need this page only to write a client of your own or to read the wire. `@porterkit/client` implements all of it.

## Envelope

Every message, in both directions and on both transports, is one JSON object:

```ts
{ event: string; data?: unknown }
```

`data` is absent when the message carries none. Porter's events start with `porter:`; a Game's events never do. Client messages are in the imperative (`porter:lockRoom`), server messages in the past tense (`porter:roomLocked`), and no name is used in both directions.

## HTTP routes

| Route                       | Request                                       | Response                                                                |
| --------------------------- | --------------------------------------------- | ----------------------------------------------------------------------- |
| `POST /porter/login`        | `{ name, profile, roomId? }`                  | `200` with `{ token, roomId }`, or a status with `{ reason }`           |
| `HEAD /porter/rooms/:id`    |                                               | `200` if the room exists, `404` if not                                  |
| `GET /porter/events?token=` |                                               | An SSE stream of envelopes                                              |
| `POST /porter/commands`     | One envelope, `Authorization: Bearer <token>` | `202`; `401` with `{ reason }`; `409` with `{ reason: 'notConnected' }` |
| `/porter/ws?token=`         |                                               | A WebSocket of envelopes                                                |

The four HTTP routes follow the server's global prefix; `/porter/ws` does not. A client tells login rejections apart by `reason`, not by status. Their statuses are `400` for `invalidName` and `invalidProfile`, `404` for `roomNotFound`, `409` for `nameTaken`, `roomFull` and `roomLocked`, and `500` for `failed`.

On `POST /porter/commands`, the outcome of the message never comes in the response: it arrives on the stream. An invalid envelope also gets `202`, and its `malformed` on the stream. `409` means the User is not connected, and the message is discarded without a rejection. A client takes any response other than `202` and `401`, and a request that fails, as a dropped connection. The route accepts messages from any connected User, including one connected over WebSocket.

## Transports

On WebSocket, each frame is one envelope as JSON text. On SSE, each event carries one envelope as JSON in its `data` field, on a single line, and only `data` means anything: `event`, `id` and `retry` are ignored, and so is `Last-Event-ID`. Before its first message on each connection the server sends one event whose `data` is `:` followed by 2048 spaces; a client discards any event whose `data` starts with `:`.

## Client to server

Every message here is for the Admin only, except `porter:updateProfile` and `porter:pong`.

| Event                   | Data                          | Announced as                                               |
| ----------------------- | ----------------------------- | ---------------------------------------------------------- |
| `porter:lockRoom`       | `{ locked: boolean }`         | `porter:roomLocked`                                        |
| `porter:kickUser`       | `{ name: string }`            | `porter:userLeft`, and `porter:kicked` to the User removed |
| `porter:changeGame`     | `{ game: string }`            | `porter:gameChanged`                                       |
| `porter:updateSettings` | the Game's settings, complete | `porter:settingsUpdated`                                   |
| `porter:startMatch`     |                               | `porter:matchStarted`                                      |
| `porter:pauseMatch`     | `{ reason }`                  | `porter:matchPaused`                                       |
| `porter:continueMatch`  |                               | `porter:matchContinued`                                    |
| `porter:endMatch`       |                               | `porter:matchEnded`                                        |
| `porter:updateProfile`  | `{ profile }`                 | `porter:profileUpdated`                                    |
| `porter:pong`           |                               |                                                            |

Any other `porter:` event gets `unhandled`. Any other event is a Game message for the active Game. A message that changes nothing is carried out and announced like any other.

## Server to client

Announcements go to every connected User, the sender included, and serve as the confirmation.

| Event                     | Data                                               | Sent to                                                         |
| ------------------------- | -------------------------------------------------- | --------------------------------------------------------------- |
| `porter:joined`           | the whole room (below)                             | The User connecting                                             |
| `porter:rejected`         | `{ reason }`                                       | A refused connection, which is then closed                      |
| `porter:replaced`         |                                                    | A connection about to be closed because its User opened another |
| `porter:kicked`           |                                                    | The User removed, before its connection is closed               |
| `porter:userJoined`       | `{ user: { name, profile, status: 'connected' } }` | The others                                                      |
| `porter:userDisconnected` | `{ name }`                                         | The others                                                      |
| `porter:userReconnected`  | `{ name }`                                         | The others                                                      |
| `porter:userLeft`         | `{ name, reason: 'timeout' \| 'kicked' }`          | The others                                                      |
| `porter:adminChanged`     | `{ admin }`                                        | Everyone                                                        |
| `porter:roomLocked`       | `{ locked }`                                       | Everyone                                                        |
| `porter:profileUpdated`   | `{ name, profile }`                                | Everyone                                                        |
| `porter:ping`             |                                                    | Each connection                                                 |
| `porter:gameChanged`      | `{ game, settings }`                               | Everyone                                                        |
| `porter:settingsUpdated`  | the settings                                       | Everyone                                                        |
| `porter:matchStarted`     |                                                    | Everyone                                                        |
| `porter:matchPaused`      | `{ reason }`                                       | Everyone                                                        |
| `porter:matchContinued`   |                                                    | Everyone                                                        |
| `porter:matchEnded`       | `{ reason: EndReason }`                            | Everyone                                                        |
| `porter:timerSet`         | `{ name, remaining }`                              | Everyone                                                        |
| `porter:timerCleared`     | `{ name }`                                         | Everyone                                                        |
| `porter:messageRejected`  | `{ rejected, reason }`                             | The sender only                                                 |

Any other event comes from the active Game.

## `porter:joined`

```ts
{
  roomId: string;
  you: string;           // this User's name
  admin: string;         // the Admin's name
  locked: boolean;
  pingInterval: number;  // milliseconds
  users: Array<{ name: string; profile: Profile; status: 'connected' | 'reconnecting' }>;
  game: {
    name: string;
    settings: Settings;
    state: State;
    userData: Record<string, UserData>;  // by User name
    match:
      | { status: 'idle' }
      | { status: 'running'; timers: Record<string, number> }
      | { status: 'paused'; reason: PauseReason; timers: Record<string, number> }
      | { status: 'ended'; reason: EndReason };
  };
}
```

`users` lists those connected or away, in the order they joined, the receiver included; a User not yet connected is not listed. `userData` has one entry for each of them. `timers` maps each Match timer to its remaining milliseconds. There is no flag for being the Admin (`you === admin`) and no room capacity.

## Match

```ts
type EndReason = { by: 'game'; reason: GameEndReason } | { by: 'admin' } | { by: 'minPlayers' };
```

At every `porter:matchStarted` the state and per-User data are created anew from the Game definition, the settings are kept and no timer exists; each client does the same on receiving it. `porter:matchPaused` and `porter:matchContinued` carry no timer data: the client freezes and resumes its timers. On `porter:matchEnded` every timer ceases to exist, with no `porter:timerCleared` for each.

The types of every message are exported by `@porterkit/contracts` as `PorterCommands`, `PorterEvents`, `ClientMessage` and `ServerMessage` ([API](/porterkit/reference/api/porterkit/contracts/readme/)).

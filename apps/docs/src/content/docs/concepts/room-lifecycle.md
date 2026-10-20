---
title: Room lifecycle
description: How a User moves through a room, from login to leaving, and what each step announces.
sidebar:
  order: 2
spec:
  - docs/spec/protocol.md#connection-lifecycle
  - docs/spec/protocol.md#connecting
  - docs/spec/nestjs.md#connections
---

A room exists from the login that creates it until its last User leaves. In between, each User is in one of three states. Only `connected` and `reconnecting` are ever visible to the other Users.

| State          | Meaning                                |
| -------------- | -------------------------------------- |
| `pending`      | Logged in over HTTP, not connected yet |
| `connected`    | Has an open connection                 |
| `reconnecting` | Its connection dropped                 |

Every User without an open connection has a Grace period running, the same one for `pending` and `reconnecting`. When it runs out, the User leaves the room.

## Transitions

| From           | To             | When                                             | What Porter sends                                                                                        |
| -------------- | -------------- | ------------------------------------------------ | -------------------------------------------------------------------------------------------------------- |
|                | `pending`      | The login succeeds                               | Nothing                                                                                                  |
| `pending`      | `connected`    | It connects with its Token                       | `porter:joined` to it, `porter:userJoined` to the others                                                 |
| `pending`      | out            | Its Grace period runs out                        | Nothing: nobody ever saw it                                                                              |
| `connected`    | `reconnecting` | The connection closes, or a ping goes unanswered | `porter:userDisconnected` to the others                                                                  |
| `reconnecting` | `connected`    | It connects within its Grace period              | `porter:joined` to it, `porter:userReconnected` to the others                                            |
| `reconnecting` | out            | Its Grace period runs out                        | `porter:userLeft` with `timeout` to the others                                                           |
| `connected`    | `connected`    | The same User opens a second connection          | `porter:replaced` to the old one, which is closed; `porter:joined` to the new one; nothing to the others |

A User that is out has left the room. Its Token then gets `notInRoom`, and its name is free for someone else. The Admin can also [remove a User](/porterkit/guides/rooms/control/#removing-a-user), which takes it out at once.

There is no message for leaving. A User leaves by closing its connection and letting its Grace period run out; until then it keeps its place and its name. This is what `leave()` does on the client.

## Connecting

Opening a connection with a valid Token is joining the room; there is no join message. The first message from the server is `porter:joined` or `porter:rejected`.

`porter:joined` is the whole room: its id, this User's name, the Admin, whether it is locked, the ping interval, the Users with their Profiles and status, and the active Game with its settings, state, per-User data and Match, timers included. A client replaces whatever it held with it, on the first connection and on every reconnection. Nothing missed while away is replayed.

A refused connection is not an HTTP or WebSocket error: the server accepts it, sends `porter:rejected` with a reason and closes it. The client does not retry.

## Ping

The server sends `porter:ping` on every connection at a fixed interval, `pingInterval`, 30 seconds by default. The client answers each with `porter:pong`. When a ping is due and no pong has arrived since the last one, the server closes the connection, and that counts as a drop. A dead connection is closed between one and two intervals after it died.

Ping and pong are messages, not WebSocket control frames, so the rule is the same on both transports. The client, for its part, takes the connection as dropped after two intervals without any message from the server.

## Timeline

A User drops in the middle of a Match and comes back:

1. Its connection closes. The others receive `porter:userDisconnected`, and the Manager's `onUserDisconnected` runs. If it was the Admin, the next connected User becomes Admin at once.
2. Its client retries, starting after 500 ms and waiting up to 2 seconds between attempts.
3. It reconnects within the Grace period, 20 seconds by default. It receives `porter:joined` with the whole room as it is now; the others receive `porter:userReconnected`. If it had been the Admin earlier in the Admin line, it is the Admin again.

Had it not come back in time, it would have left the room: the others receive `porter:userLeft`, the Manager's `onUserLeft` runs, and a Match left with fewer Users than its minimum ends.

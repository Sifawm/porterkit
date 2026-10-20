---
title: Rejections
description: Every reason Porter gives for refusing a login, a connection or a message.
sidebar:
  order: 3
spec:
  - docs/spec/protocol.md#rejected-messages
  - docs/spec/protocol.md#post-porterlogin
  - docs/spec/protocol.md#connecting
  - docs/spec/contracts.md#reasons
---

All of Porter's reasons are closed sets. You add your own only through a Game's `rejectReason`.

## Login

The `reason` of a refused `POST /porter/login`, and of `{ ok: false }` from the client's `login()`. A login that deserves several gets the first of this order.

| `reason`         | Status | When                                                                                             |
| ---------------- | ------ | ------------------------------------------------------------------------------------------------ |
| `invalidName`    | 400    | `name` is not a string, is empty after trimming or is too long; or the body is not a JSON object |
| `invalidProfile` | 400    | The Profile is too large or the validator refuses it, and so does the fallback when there is one |
| `roomNotFound`   | 404    | No room has that `roomId`, including `null`, an empty string or a value that is not a string     |
| `roomLocked`     | 409    | The room is locked                                                                               |
| `roomFull`       | 409    | The room is at capacity                                                                          |
| `nameTaken`      | 409    | Someone in the room has that name, regardless of case                                            |
| `failed`         | 500    | The login creates a room and the initial Game cannot give its default settings                   |

## Connection

Sent as `porter:rejected`, after which the server closes the connection. The client closes with the same reason and does not retry. `POST /porter/commands` answers `401` with the same three.

| `reason`       | When                                               |
| -------------- | -------------------------------------------------- |
| `invalidToken` | The Token is missing or not in a valid format      |
| `roomNotFound` | The Token's room no longer exists                  |
| `notInRoom`    | The room exists and no User in it holds that Token |

`POST /porter/commands` adds `notConnected`, with `409`, for a User whose Token is valid but who is not connected. It is the one case where a message is lost without a `porter:messageRejected`.

## Messages

Whoever sends a message Porter does not carry out receives, alone, `porter:messageRejected` with `{ rejected, reason }`. `rejected` is the event name of the message; there is no correlation id.

| `reason`                   | When                                                                                                                                                           |
| -------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `malformed`                | What arrived is not a valid envelope (`rejected` is then `''`), the data of one of Porter's messages has the wrong shape, or the Game's guard refuses the data |
| `notAdmin`                 | The message is for the Admin only and the sender is not the Admin                                                                                              |
| `notAllowedNow`            | The message is not valid in the current situation (below)                                                                                                      |
| `belowMinPlayers`          | `porter:startMatch` with fewer Users than the Game's minimum                                                                                                   |
| `notFound`                 | `porter:changeGame` names a Game that is not registered, or `porter:kickUser` names nobody who can be removed                                                  |
| `unhandled`                | A Game message the active Game has no handler for, or a `porter:` event that is not one of Porter's                                                            |
| `invalidProfile`           | `porter:updateProfile` with a Profile that is too large or that the validator refuses                                                                          |
| `failed`                   | The Game's code threw: a handler, `updateSettings`, `canStart`, or `defaultSettings` on a `porter:changeGame`. No detail is given                              |
| `{ code: 'game', reason }` | The Game refused it with one of its own reasons: a handler, `updateSettings` or `canStart` threw `ctx.reject(reason)`                                          |

`notAllowedNow` is the answer to:

- `porter:startMatch` with a Match under way;
- `porter:pauseMatch` when the Match is not `running`;
- `porter:continueMatch` when the Match is not `paused`;
- `porter:endMatch` without a Match under way;
- `porter:changeGame` with a Match under way, including one that starts while the new Game's settings are loading;
- `porter:kickUser` naming the Admin itself;
- a Game message without a Match under way, unless its handler carries `@AnyTime()`.

## Order of the checks

A message that deserves several rejections gets one, the first of this order, for Porter's messages and Game messages alike:

| #   | Check                                                                    | Reason                                           |
| --- | ------------------------------------------------------------------------ | ------------------------------------------------ |
| 1   | The envelope is valid                                                    | `malformed`                                      |
| 2   | Somebody handles that event                                              | `unhandled`                                      |
| 3   | The sender may send it                                                   | `notAdmin`                                       |
| 4   | Its data has the right shape; for a Game message, its guard accepts it   | `malformed`                                      |
| 5   | The situation allows it                                                  | `notAllowedNow`                                  |
| 6   | What it names exists                                                     | `notFound`                                       |
| 7   | There are enough Users                                                   | `belowMinPlayers`                                |
| 8   | The Game accepts it; for `porter:updateProfile`, the Profile is accepted | `{ code: 'game' }` or `failed`; `invalidProfile` |

So a User who is not the Admin learns nothing from an Admin-only message: it gets `notAdmin` whatever its data and whatever the situation.

For `porter:updateSettings` Porter checks only that the data is an object; the rest is the Game's. The `data` of `porter:pauseMatch` must be an object, and its `reason` may be absent, which makes it `null`.

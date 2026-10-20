---
title: Configuration
description: Every option of the server module and of the client.
sidebar:
  order: 1
spec:
  - docs/spec/nestjs.md#module
  - docs/spec/client.md#createporter
---

## Server: `PorterModule.forRoot`

| Option            | Default  | What it is                                                                                      |
| ----------------- | -------- | ----------------------------------------------------------------------------------------------- |
| `initialGame`     | required | The Game every new room starts with                                                             |
| `capacity`        | 16       | Users per room, counting those connected, away and not yet connected                            |
| `maxNameLength`   | 20       | Longest name, in UTF-16 code units, what `String.prototype.length` counts                       |
| `maxProfileSize`  | 2048     | Largest Profile, in UTF-8 bytes of `JSON.stringify(profile)`                                    |
| `validateProfile` | none     | `(profile, others) => boolean`, run after the size check at login and on `porter:updateProfile` |
| `fallbackProfile` | none     | `(others) => profile`, stored at login instead of a refused Profile, and checked in turn        |
| `pingInterval`    | 30000    | Milliseconds between two `porter:ping` on a connection                                          |
| `gracePeriod`     | 20000    | Milliseconds a User may stay without an open connection                                         |

`forRootAsync` takes the same options through NestJS's `useFactory`, `inject` and `imports`. The options are global: none is per room or per Game.

An option that is `undefined` takes its default. Any other value must be valid, `null` included, or the application does not start; Porter does not correct, clamp or replace it. The error names the option and the value received.

| Option                               | Valid                                                                  |
| ------------------------------------ | ---------------------------------------------------------------------- |
| `capacity`, `maxNameLength`          | An integer, at least 1                                                 |
| `maxProfileSize`                     | An integer, at least 4, so the `null` of an absent Profile always fits |
| `pingInterval`, `gracePeriod`        | A finite number greater than zero, not necessarily an integer          |
| `validateProfile`, `fallbackProfile` | A function                                                             |

There are no maximums and no rule between options: a `gracePeriod` shorter than `pingInterval` is accepted.

The routes, the room id format and the Token format are fixed, and neither transport can be turned off.

## Client: `createPorter`

| Option       | Default                                 | What it is                                                                                    |
| ------------ | --------------------------------------- | --------------------------------------------------------------------------------------------- |
| `httpUrl`    | required                                | Base of the four HTTP routes, global prefix included: `/api` gives `/api/porter/login`        |
| `wsUrl`      | required, unless `transport` is `'sse'` | The full WebSocket URL, path included                                                         |
| `games`      | required                                | The client half of every Game in the games map, from `defineGame`                             |
| `transport`  | `'ws'`                                  | `'ws'`, `'sse'`, or `({ attempt }) => 'ws' \| 'sse'`, called before every attempt             |
| `maxRetries` | 10                                      | Failed connection attempts in a row before closing with `unreachable`                         |
| `storage`    | `sessionStorage`                        | Anything with `getItem`, `setItem` and `removeItem`; the Token is kept under the key `porter` |

The wait between retries starts at 500 ms and grows by 1.3 times up to 2 seconds. It has no option. Neither does the silent-connection check, two ping intervals without a message from the server.

## Game definition

| Field              | What it is                                                                            |
| ------------------ | ------------------------------------------------------------------------------------- |
| `name`             | The Game's key in the games map                                                       |
| `minPlayers`       | Fewest Users a Match may have, counting those connected and away                      |
| `tickRate`         | Ticks per second, greater than zero and at most 1000; absent for a Game without Ticks |
| `createSettings()` | New settings, with `set(data)`                                                        |
| `createState()`    | New state                                                                             |
| `createUserData()` | New per-User data                                                                     |

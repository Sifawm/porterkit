---
title: Who does what
description: Where Porter stops and your code starts.
sidebar:
  order: 3
spec:
  - docs/spec/README.md#who-does-what
  - docs/spec/README.md#out-of-v1
  - docs/adr/0002-porter-knows-games.md
---

Porter knows a Game as a contract (its settings, state, per-User data and messages) and never its rules.

| Area             | Porter                                                                                   | You                                                                                     |
| ---------------- | ---------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| Application      | One NestJS module, five fixed routes                                                     | The application: platform, WebSocket adapter, CORS, global prefix, `listen`             |
| Configuration    | Defaults for capacity, name length, Profile size, ping interval and Grace period         | The initial Game; any of those values; a Profile validator                              |
| Rooms            | Creates them, generates their ids, removes them with their last User                     | Nothing: a room cannot be replaced or extended                                          |
| Identity         | Checks the name, issues and verifies the Token                                           | The Profile: its shape, its meaning and its validation                                  |
| Connections      | Both transports, ping, Grace period, reconnection, replacing a connection                | On the client, which transport to use and what to show while not connected              |
| Admin            | Who it is, succession and recovery, Admin-only messages                                  | Which of your Game's messages are Admin-only                                            |
| Room control     | Locking, removing a User, changing the Game, with their announcements                    | The screens that ask for them                                                           |
| Games            | The Game definition's type; finding each Game's Manager                                  | Each Game: its entry in the games map, its Game definition and its Manager              |
| Settings         | Carrying and announcing them                                                             | Their shape, defaults and validation                                                    |
| Match            | Start, pause, continue, end; the minimum of players; new state at every start            | The rules: a veto on starting, what happens at each step, when the Game ends it and why |
| Match timers     | Named countdowns that stop with a pause and end with the Match, on server and client     | Which timers exist, how long they last and what happens when they fire                  |
| Game messages    | Routing, the Admin and Match checks, rejections to the sender                            | The events, their data, a guard for each and the handlers                               |
| Private data     | Keeping the Match memory on the server, never sending it                                 | What goes in it                                                                         |
| Client state     | The room, the Users and the Match, applied from Porter's messages; a Game's initial data | An Applier for each Game message that changes state                                     |
| Client interface | Hooks in React, signals in Godot, and nothing visible                                    | Every component, route, guard, modal and text                                           |
| Logging          | Errors from your code and its own, through NestJS's logger                               | The logger                                                                              |

## What Porter does not do

- Rooms without a Game. A room always has an active Game.
- Accounts. A User is a name in one room; Porter has no registered Users and no pluggable identity.
- Persistence, or running on more than one instance. Rooms live in the memory of one process.
- Servers other than NestJS. It runs on Express or Fastify, through NestJS only.
- Bindings other than React and Godot, a Game inside an iframe, or Godot outside a web export.
- NestJS guards, pipes, interceptors and filters on a Manager's handlers and hooks.
- NestJS 12.

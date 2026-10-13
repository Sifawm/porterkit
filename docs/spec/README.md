# Porter v1

Porter is a library for real-time rooms. It logs Users into rooms, keeps their connections alive, runs the lifecycle of the Matches played in them and carries each Game's messages, leaving the rules of every Game to the Integrator.

This specification is what v1 is built from. It stands on its own: everything needed to build Porter is in these eight files.

| File | Contents |
|---|---|
| [protocol.md](protocol.md) | HTTP routes, the two transports, the connection lifecycle and every message |
| [contracts.md](contracts.md) | Public API of `@porterkit/contracts`: the types server and client share |
| [nestjs.md](nestjs.md) | Public API of `@porterkit/nestjs`, and the rules of a room |
| [client.md](client.md) | Public API of `@porterkit/client`: login, connection and state |
| [react.md](react.md) | Public API of `@porterkit/react`: the hooks |
| [godot.md](godot.md) | Public API of `@porterkit/godot`: the facade and the addon |
| [monorepo.md](monorepo.md) | Layout, tools, versions and publishing |

The terms written with a capital (Integrator, User, Profile, Token, Admin, Grace period, Game, Game definition, Match, Match timer, Manager, Match memory, Applier, Binding) are defined in the [glossary](../../CONTEXT.md) and are not redefined here.

## Goal of v1

An Integrator that has several Games running on room code of its own can rebuild all of them on Porter, server and front, without changing the library. Every message, piece of data, rule and screen of those Games is either provided by Porter or written by the Integrator against Porter's public API.

## Scope of v1

- **Five packages.** `@porterkit/contracts`, types only and safe for a browser; `@porterkit/nestjs`, the server; `@porterkit/client`, the client; `@porterkit/react` and `@porterkit/godot`, its Bindings for React and for Godot.
- **Porter knows Games.** A room always has an active Game, and Porter knows its shape as a contract: settings, state, per-User data and messages. It never knows its rules ([ADR 0002](../adr/0002-porter-knows-games.md)).
- **Two transports.** WebSocket and SSE, over one connection lifecycle ([ADR 0001](../adr/0001-two-transports.md)).
- **Guest identity.** A User is a name, unique in its room, and a Profile. Its Token is tied to that room ([ADR 0004](../adr/0004-opaque-room-token.md)).
- **A complete client.** Login, connection and state, with no framework; React hooks over them, and signals for a Game made in Godot and exported for the web.
- **Rooms in memory**, in one process.

## Who does what

| Area | Porter | The Integrator |
|---|---|---|
| Application | one NestJS module, five fixed routes | the application: platform, WebSocket adapter, CORS, global prefix, `listen` |
| Configuration | defaults for capacity, name length, Profile size, ping interval and Grace period | the initial Game; any of those values; a Profile validator |
| Rooms | creates them, generates their ids, removes them with their last User | nothing: a room cannot be replaced or extended |
| Identity | checks the name, issues and verifies the Token | the Profile: its shape, its meaning and its validation |
| Connections | both transports, ping, Grace period, reconnection, replacing a connection | on the client, which transport to use and what to show while not connected |
| Admin | who it is, succession and recovery, Admin-only messages | which of its Game's messages are Admin-only |
| Room control | locking, removing a User, changing the Game, with their announcements | the screens that ask for them |
| Games | the Game definition's type; finding each Game's Manager | each Game: its entry in the games map, its Game definition and its Manager |
| Settings | carrying and announcing them | their shape, defaults and validation |
| Match | start, pause, continue, end; the minimum of players; new state at every start | the rules: a veto on starting, what happens at each step, when the Game ends it and why |
| Match timers | named countdowns that stop with a pause and die with the Match, on server and client | which timers exist, how long they last and what happens when they fire |
| Game messages | routing, the Admin and Match checks, rejections to the sender | the events, their data, a guard for each and the handlers |
| Private data | keeping the Match memory on the server, never sending it | what goes in it |
| Client state | the room, the Users and the Match, applied from Porter's messages; a Game's initial data | an Applier for each of its Game's messages that changes state |
| Client interface | hooks in React, signals in Godot, and nothing visible | every component, route, guard, modal and text |
| Logging | errors from the Integrator's code and its own, through NestJS's logger | the logger |

## Out of v1

- Rooms without a Game.
- Pluggable identity: Users that are the Integrator's registered accounts.
- A room service or a User model supplied by the Integrator.
- Persistence, and running on more than one instance.
- A framework-neutral server core, and integrations for Express or Fastify without NestJS.
- Bindings for anything other than React and Godot.
- A Game in a document other than the client's (an iframe), and Godot outside a web export.
- NestJS guards, pipes, interceptors and filters on a Manager's handlers and hooks.
- NestJS 12.

## Conventions

- Everything written here is required. What is optional says so.
- Each thing is defined in one file; the others name it with a link.
- In the package files, "Public API" lists everything exported, and what does not appear there is not public. The TypeScript blocks are normative.
- Each file ends with "Verify during construction": what could not be confirmed before building, and what changes if it fails.
- The ADRs linked from these files give the reasons for a decision. No rule depends on reading them.

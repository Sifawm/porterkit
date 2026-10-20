---
title: Glossary
description: The words Porter uses, with one meaning each.
sidebar:
  order: 1
spec:
  - CONTEXT.md
---

These words have one meaning each, in the code, in these pages and in the specification. Each entry also lists the words Porter avoids for the same thing.

## Integrator

The project that installs Porter and supplies everything specific to its own product. Porter avoids: consumer, client or host app.

## Binding

A package that exposes Porter's client to one framework or engine, such as `@porterkit/react`. It reads the client and adds nothing to the protocol or to the state. Porter avoids: adapter, integration or wrapper.

## User

A named participant in exactly one room. A User has no existence outside its room; the name is its identity there. Porter avoids: player, account or member.

## Profile

Data the Integrator attaches to a User. The User brings it when it joins and may change it while it is in the room; Porter stores and shares it without interpreting it. Porter avoids: seed, avatar or metadata.

## Token

What a User receives at login and presents to prove it is that User in that room. It is worth nothing once the User has left the room. Porter avoids: JWT, session or credential.

## Admin

The one User in a room allowed to change the room and run its Matches. A room always has exactly one. Porter avoids: host, owner or moderator.

## Admin line

The Users of a room that have been its Admin, in the order they became it. A User that comes back takes the Admin again from whoever is behind it in the line. Porter avoids: queue, history or hierarchy.

## Grace period

The time a User may stay in a room without an open connection, either before connecting for the first time or after a connection drops. When it runs out the User leaves the room. Porter avoids: timeout, keep-alive or reconnect window.

## Presence

Whether a User has an open connection: it has not connected yet, it is connected, or its connection dropped and it may come back. The Grace period runs exactly while it has none. Porter avoids: connection state, session or liveness.

## Game

What runs inside a room, supplied by the Integrator. Porter knows a Game's shape (its settings, its state, the messages it handles) but never its rules. Porter avoids: activity, app or plugin.

## Game definition

The part of a Game that server and client share: its name, its minimum number of players, the rate of its Ticks when it has them, and what its settings, state and per-User data look like when new. It contains no rules. Porter avoids: game config, registration or model.

## Match

One run of a Game in a room, from the moment it starts until it ends. A room plays many Matches, one at a time. Porter avoids: game (for a single run), round or session.

## Match timer

A named countdown that belongs to a Match. It stops while the Match is paused and ceases to exist when the Match ends. Porter avoids: timeout, scheduler or round timer.

## Tick

One advance of a Match by a fixed length of time, which Porter asks of the Manager at the rate the Game definition declares. Ticks happen exactly while the Match is running. Porter avoids: frame, step, update or loop.

## Manager

The Integrator's server-side class for a Game: its rules, default settings and message handlers. One exists for the whole application; it keeps nothing about any room. Porter avoids: controller, handler or game service.

## Match memory

Server-only data a Manager keeps for one room's Match. It is never sent to Users and is created anew when a Match starts. Porter avoids: private state, cache or session.

## Applier

The Integrator's client-side function that turns one of a Game's server messages into the next state of that Game. It is the only place a Game's state changes on the client. Porter avoids: handler, reducer or listener.

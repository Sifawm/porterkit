# Porter

A reusable server-side library for real-time rooms: it authenticates users into rooms and routes messages between them, leaving what happens inside the room to whoever uses the library.

## Language

**Integrator**:
The project that installs Porter and supplies everything specific to its own product.
_Avoid_: Consumer, client, host app

**Binding**:
A package that exposes Porter's client to one framework or engine. It reads the client and adds nothing to the protocol or to the state. Whoever writes a Binding is not an Integrator.
_Avoid_: Adapter, integration, wrapper

**User**:
A named participant in exactly one room. A User has no existence outside its room; the name is its identity there.
_Avoid_: Player, account, member

**Profile**:
Data the Integrator attaches to a User when it joins. Porter stores and shares it without interpreting it.
_Avoid_: Seed, avatar, metadata

**Token**:
What a User receives at login and presents to prove it is that User in that room. It is worth nothing once the User has left the room.
_Avoid_: JWT, session, credential

**Admin**:
The one User in a room allowed to change the room and run its Matches. A room always has exactly one.
_Avoid_: Host, owner, moderator

**Admin line**:
The Users of a room that have been its Admin, in the order they became it. A User that comes back takes the Admin again from whoever is behind it in the line.
_Avoid_: Queue, history, hierarchy

**Grace period**:
The time a User may stay in a room without an open connection, either before connecting for the first time or after a connection drops. When it runs out the User leaves the room.
_Avoid_: Timeout, keep-alive, reconnect window

**Presence**:
Whether a User has an open connection: it has not connected yet, it is connected, or its connection dropped and it may come back. The Grace period runs exactly while it has none.
_Avoid_: Connection state, session, liveness

**Game**:
What runs inside a room, supplied by the Integrator. Porter knows a Game's shape (its settings, its state, the messages it handles) but never its rules.
_Avoid_: Activity, app, plugin

**Game definition**:
The part of a Game that server and client share: its name, its minimum number of players, the rate of its Ticks when it has them, and what its settings, state and per-User data look like when new. It contains no rules.
_Avoid_: Game config, registration, model

**Match**:
One run of a Game in a room, from the moment it starts until it ends. A room plays many Matches, one at a time.
_Avoid_: Game (for a single run), round, session

**Match timer**:
A named countdown that belongs to a Match. It stops while the Match is paused and ceases to exist when the Match ends.
_Avoid_: Timeout, scheduler, round timer

**Tick**:
One advance of a Match by a fixed length of time, which Porter asks of the Manager at the rate the Game definition declares. Ticks happen exactly while the Match is running.
_Avoid_: Frame, step, update, loop

**Manager**:
The Integrator's server-side class for a Game: its rules, default settings and message handlers. One exists for the whole application; it keeps nothing about any room.
_Avoid_: Controller, handler, game service

**Match memory**:
Server-only data a Manager keeps for one room's Match. It is never sent to Users and is created anew when a Match starts.
_Avoid_: Private state, cache, session

**Applier**:
The Integrator's client-side function that turns one of a Game's server messages into the next state of that Game. It is the only place a Game's state changes on the client.
_Avoid_: Handler, reducer, listener

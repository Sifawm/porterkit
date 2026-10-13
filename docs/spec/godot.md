# `@porterkit/godot`

## Purpose

The Binding for Godot: it exposes the client of [client.md](client.md) to a Game made in Godot and exported for the web. Everything the client does (login, connection, state, Appliers) is in that file; this one says how it reaches GDScript.

It has two halves, published together:

- **The facade**, TypeScript: `exposeToGodot(porter)` leaves in the page an object that speaks only in JSON and plain values.
- **The addon**, GDScript: `addons/porter/porter.gd`, an autoload that reads the facade and turns it into signals and methods.

- Peer dependency: `@porterkit/client`. Like every Binding it is given the instance ([ADR 0007](../adr/0007-a-binding-is-given-the-instance.md)); it imports only its types.
- It works only in a web export, in the same document as the instance. There is no `postMessage` and no iframe: a Game in another document, and a native export, are out.
- A Game's definition and its Appliers stay in TypeScript, in the page, whatever draws the Game. GDScript reads the state already applied and never changes it.
- The addon is developed and tested against Godot 4.7. The rest of Godot 4 is not tested; Godot 3 is out, since the bridge it uses has another name there.

Everything crosses between JavaScript and GDScript as JSON ([ADR 0008](../adr/0008-godot-crosses-in-json.md)).

## Public API

### The facade

```ts
import type { Porter } from '@porterkit/client';

export type Part = 'connection' | 'room' | 'game';

export interface GodotFacade {
  subscribe(onChange: (json: string) => void): void;
  on(event: string, listener: (json: string) => void): number;
  off(listener: number): void;
  send(event: string, json?: string): boolean;
  login(json: string, done: (json: string) => void): void;
  roomExists(roomId: string, done: (exists: boolean | null) => void): void;
  resume(): boolean;
  reconnect(): void;
  leave(): void;
  timerRemaining(name: string): number;
}

export declare function exposeToGodot(porter: Porter<any, any>): GodotFacade;
```

`GodotFacade` is the contract between the two halves. It is exported for the Binding's own tests; an Integrator calls `exposeToGodot` and nothing else of it.

### The addon

The autoload, which the Integrator names `Porter`:

```gdscript
signal connection_changed(connection: Dictionary)
signal room_changed(room: Variant)    # null while there is no room
signal game_changed(game: Variant)    # null while there is no room

var connection: Dictionary            # { "status": "idle" } at the start
var room: Variant
var game: Variant

func login(request: Dictionary) -> Variant      # await
func room_exists(room_id: String) -> Variant    # await
func resume() -> bool
func reconnect() -> void
func leave() -> void
func send(event: String, data: Variant = null) -> bool
func on(event: String, listener: Callable) -> int
func off(listener: int) -> void
func timer_remaining(timer: String) -> float
```

## Behaviour

### Setting up

- The page creates the instance, calls `exposeToGodot(porter)` and only then starts the engine. The addon looks for the facade once, when it loads.
- The facade is at `globalThis.porterGodot`. The name is fixed, and a second call replaces the first: one page has one facade.
- The Integrator copies or links `node_modules/@porterkit/godot/addons/porter` into the `addons` directory of its Godot project and adds `porter.gd` as an autoload named `Porter`. There is no editor plugin to enable.
- Without a facade (the page did not call `exposeToGodot`, or the project runs outside a browser) the addon logs an error when it loads, and its methods fail.
- `exposeToGodot` changes nothing in the instance. The page keeps using it, and may give it to another Binding.

### State

- `connection`, `room` and `game` are what the instance's `connection`, `room` and `game()` give, as a Dictionary. `room` and `game` are `null` where the instance has no room; `game` never throws.
- After every change of the instance the addon is told once, with the parts whose JSON changed. It replaces those of its three variables first and emits their signals after, in the order `connection_changed`, `room_changed`, `game_changed`. A listener of any of them reads the three already updated: `connected` never comes without its room.
- A part whose JSON did not change emits nothing. A Game message that changes only the Game's state does not emit `room_changed`.
- The addon reads the three parts when it loads, before any scene exists. A scene reads the variables in its `_ready` and connects the signals for what comes after.
- Every value has been through JSON. A number is a `float`, also when it is whole on the server; an object is a `Dictionary` and a list an `Array`. Nothing is typed from the games map.
- `match` is a keyword of GDScript: the Match of a Game is read as `game["match"]`.

### Calls

- `login(request)` and `room_exists(room_id)` are awaited. `login` resolves with the result of the instance's `login`, `{ "ok": true, "roomId" }` or `{ "ok": false, "reason" }`; `room_exists` with a `bool`. Each resolves with `null` when the request itself failed, where the instance's promise rejects.
- `resume()`, `reconnect()` and `leave()` are the instance's own, with the same results.
- `send(event, data)` sends `data` as the message's data, and no data when it is `null` or left out. It returns what the instance's `send` returns.
- `on(event, listener)` calls `listener` with the data of every such event, `null` when it carries none, and returns the number that `off` takes. There is no listener for every event.
- `timer_remaining(name)` is `remaining()` of that Match timer in milliseconds, and `-1` when the active Match has none of that name. It is a plain number, so a scene may call it on every frame. Whether the timer is stopped is `game["match"].status == "paused"`.
- Nothing is typed: an event name or a data shape that is wrong is the server's to reject, as `porter:messageRejected`.

## Usage

The page, with the Game of [client.md](client.md#usage):

```ts
import { createPorter } from '@porterkit/client';
import { exposeToGodot } from '@porterkit/godot';

const porter = createPorter<Games, Profile>({
  httpUrl: '/api',
  wsUrl: 'wss://example.com/porter/ws',
  games: { misfit: misfitClient },
});

exposeToGodot(porter);
await new Engine(config).startGame(); // Godot's own loader
```

A scene:

```gdscript
func _ready() -> void:
	Porter.game_changed.connect(_draw)
	Porter.on("roundEnded", _show_answers)
	if not Porter.resume():
		var result = await Porter.login({"name": "Ana", "profile": {"avatar": "fox"}})
		if result == null or not result.ok:
			return _show_login_error(result)

func _process(_delta: float) -> void:
	$Clock.text = str(ceili(Porter.timer_remaining("round") / 1000))

func _answer(text: String) -> void:
	Porter.send("answer", {"answer": text})
```

## Verify during construction

- **Callbacks kept.** That a listener still hears its event after Godot has collected garbage. If it does not, the addon is not holding the reference to its callback, and it is fixed there.
- **A linked addon.** That an export packs an addon that is a link in the project's `addons` directory, on Linux and macOS. Where it does not, the Integrator copies it.

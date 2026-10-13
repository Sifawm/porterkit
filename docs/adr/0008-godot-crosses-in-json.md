# The Godot Binding crosses to GDScript in JSON, through a facade in JavaScript

`@porterkit/godot` has a half in TypeScript, `exposeToGodot(porter)`, that leaves in the page a facade speaking only in JSON strings, numbers and booleans, and a half in GDScript that parses them and emits signals. The alternative was GDScript alone: the page writes `window.porter = porter` and an addon reads the instance through `JavaScriptBridge`.

We chose the facade for two reasons. Godot's bridge converts only plain values: an object or an array of JavaScript reaches GDScript as a proxy, not as a `Dictionary` or an `Array`, so the state has to go through JSON somewhere. And the GDScript half cannot be tested in CI, because the bridge exists only in a web export running in a browser; the TypeScript half can, over the real client and a fake WebSocket. So every decision goes in the half that has tests: which parts changed, what there is when there is no room, what a failed request gives. What is left in GDScript is `JSON.parse_string` and `emit`.

The cost is that every change of the instance serializes the room and the Game to tell which of them changed, since the client gives a new Game view after every change. It is paid on each message, in JavaScript, and it grows with the state. For the room Games Porter is for it is small; a Game with a large state would have the facade compare identities before it serializes.

It also fixes the Binding to one document. A Game in an iframe would need the same facade spoken over `postMessage`, which is a second protocol and is out of v1.

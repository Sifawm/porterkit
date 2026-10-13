# @porterkit/godot

Porter's Binding for Godot: it exposes the client of `@porterkit/client` to a Game exported for the web, as an autoload with signals.

In the page, before the engine starts:

```ts
import { exposeToGodot } from '@porterkit/godot';

exposeToGodot(porter);
```

In the Godot project, copy or link `node_modules/@porterkit/godot/addons/porter` into `addons/` and add `addons/porter/porter.gd` as an autoload named `Porter`:

```gdscript
Porter.game_changed.connect(_draw)
var result = await Porter.login({"name": "Ana", "profile": null})
Porter.send("increment")
```

See the [specification](https://github.com/Sifawm/porterkit/blob/main/docs/spec/godot.md).

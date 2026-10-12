# @porterkit/contracts

The types Porter's server and client share: the games map, every message of the protocol, the shapes of a room and its Users on the wire, and the Game definition.

It emits no runtime code and has no dependencies, so it is safe to import from a browser. Import it with `import type`.

```ts
import type { GameDefinition } from '@porterkit/contracts';
```

See the [specification](https://github.com/Sifawm/porter/blob/main/docs/spec/contracts.md).

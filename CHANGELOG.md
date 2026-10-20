## 0.1.0 (2026-10-20)

### 🚀 Features

- build Porter v1 from the specification ([d858dce](https://github.com/Sifawm/porterkit/commit/d858dce))
- let a User change its Profile, checked against the others' ([bae720d](https://github.com/Sifawm/porterkit/commit/bae720d))
- **client:** publish the fake WebSocket as @porterkit/client/testing ([091519f](https://github.com/Sifawm/porterkit/commit/091519f))
- **godot:** add the Binding for Godot ([1e4a0dc](https://github.com/Sifawm/porterkit/commit/1e4a0dc))
- **nestjs:** give a Game its Ticks ([5688618](https://github.com/Sifawm/porterkit/commit/5688618))
- **nestjs:** let a Manager pause and continue the Match ([f91ba8f](https://github.com/Sifawm/porterkit/commit/f91ba8f))
- ⚠️  **react:** give the hooks an instance with createHooks ([46af896](https://github.com/Sifawm/porterkit/commit/46af896))

### 🩹 Fixes

- **react:** post SSE messages one at a time so they keep their order ([f703252](https://github.com/Sifawm/porterkit/commit/f703252))

### ⚠️  Breaking Changes

- **react:** give the hooks an instance with createHooks  ([46af896](https://github.com/Sifawm/porterkit/commit/46af896))
  @porterkit/react exports createHooks(porter) instead of
  createPorter and porter.hooks, and no longer exports the client's types.

### ❤️ Thank You

- Fernando Gomez

# Changelog

Written by `nx release`.

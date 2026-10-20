---
title: Installation
description: What to install on the server, on the front and in the code both share.
sidebar:
  order: 1
spec:
  - docs/spec/monorepo.md#packages
  - docs/spec/nestjs.md#purpose
  - docs/spec/client.md#purpose
---

A project that uses Porter has three parts: a server, a front, and the definition of its Games, which both import.

## The server

The server is a NestJS 11 application on Node 22.12 or later, on Express or on Fastify.

```sh
pnpm add @porterkit/nestjs @nestjs/platform-ws ws
```

`@porterkit/nestjs` expects `@nestjs/common`, `@nestjs/core`, `@nestjs/websockets`, `rxjs` and `reflect-metadata`, which a NestJS application already has. The WebSocket adapter, `@nestjs/platform-ws` with `ws`, is yours to install: Porter does not depend on it.

A Manager uses decorators, so the server's `tsconfig.json` has the same two options every NestJS project has:

```json
{
  "compilerOptions": {
    "experimentalDecorators": true,
    "emitDecoratorMetadata": true
  }
}
```

## The front

The client runs wherever `WebSocket`, `fetch` and timers are global: a browser, and Node with nothing added.

```sh
pnpm add @porterkit/client
```

Add the Binding for your front, if it has one:

```sh
pnpm add @porterkit/react   # React 18 or 19
pnpm add @porterkit/godot   # a Godot 4 Game exported for the web
```

A Binding imports only the client's types, so `@porterkit/client` stays installed next to it.

## The Games

Server and front share the definition of each Game: its types and the factories of its data. Put them in a package or a directory both import, with one dependency:

```sh
pnpm add @porterkit/contracts
```

`@porterkit/contracts` holds types and nothing else, so importing it from a browser costs nothing. The definition must not import anything from the server.

All five packages share one version. Install them at the same version.

Next: [the server](/porterkit/start/server/).

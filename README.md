# Porter

A library for real-time rooms. Porter logs Users into rooms, keeps their connections alive over WebSocket or SSE, runs the lifecycle of the Matches played in them and carries each Game's messages. The rules of every Game stay with whoever uses the library.

| Package                                      | Contents                                              |
| -------------------------------------------- | ----------------------------------------------------- |
| [`@porterkit/contracts`](packages/contracts) | The types server and client share. No runtime code.   |
| [`@porterkit/nestjs`](packages/nestjs)       | The server: one NestJS module.                        |
| [`@porterkit/react`](packages/react)         | The client: login, connection, state and React hooks. |

The specification is in [docs/spec](docs/spec/README.md), the decisions behind it in [docs/adr](docs/adr) and the vocabulary in [CONTEXT.md](CONTEXT.md).

## Development

Node 24 and pnpm.

```sh
pnpm install
pnpm dev     # the example server on :3000 and the example front
pnpm check   # format, lint, dependencies, typecheck, build and every test
```

The example in [examples](examples) is a shared counter built on the three packages as an Integrator would.

## Licence

MIT

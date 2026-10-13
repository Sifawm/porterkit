# Monorepo

Where the five packages live, how they are built, tested and checked, and how they are published. What each package exports is in [contracts.md](contracts.md), [nestjs.md](nestjs.md), [client.md](client.md), [react.md](react.md) and [godot.md](godot.md).

## Layout

One Nx 23 workspace over pnpm workspaces and TypeScript project references. There are no path aliases in `tsconfig.base.json`.

| Directory | Name | Published |
|---|---|---|
| `packages/contracts` | `@porterkit/contracts` | yes |
| `packages/nestjs` | `@porterkit/nestjs` | yes |
| `packages/client` | `@porterkit/client` | yes |
| `packages/react` | `@porterkit/react` | yes |
| `packages/godot` | `@porterkit/godot` | yes |
| `examples/game` | `@porterkit/example-game` | no (`private: true`) |
| `examples/server` | `@porterkit/example-server` | no (`private: true`) |
| `examples/web` | `@porterkit/example-web` | no (`private: true`) |
| `examples/godot` | `@porterkit/example-godot` | no (`private: true`) |
| root | `@porterkit/source` | no |

- `pnpm-workspace.yaml` lists `packages/*` and `examples/*`.
- A project's Nx name is the `name` of its `package.json`. A project has no `project.json` unless it needs a target Nx cannot infer.
- Root files: `README.md`, `LICENSE`, `CHANGELOG.md`, `CONTEXT.md`, `AGENTS.md` with `CLAUDE.md` as a link to it, and `docs/` with `adr/` and `spec/`. There is no documentation site.
- Each published package has a short `README.md` and its own written copy of `LICENSE`. No step copies them.

## Packages

| | `contracts` | `nestjs` | `client` | `react` | `godot` |
|---|---|---|---|---|---|
| Module format | ESM | CommonJS | ESM | ESM | ESM |
| Dependencies | none | `@porterkit/contracts` | `@porterkit/contracts` | `@porterkit/contracts` | none |
| Peer dependencies | none | see below | none | `react` `^18.0.0 \|\| ^19.0.0`, `@porterkit/client` | `@porterkit/client` |
| `engines.node` | not declared | `>=22.12` | not declared | not declared | not declared |

- All five are compiled with `tsc --build` through project references, by the `build` target Nx infers. Nothing is bundled.
- The `package.json` in each package directory is the one published, with `files` limited to the build output. Peer dependencies are written in it by hand.
- `@porterkit/godot` is the exception: it also publishes `addons/porter`, the GDScript addon, as source. No step builds or copies it, and it carries the `.uid` file Godot writes next to a script.
- `@porterkit/contracts` emits no runtime code and has no dependency, `tslib` included: `importHelpers` is off.
- A package depends on another package of the workspace at the exact version of their common release, also when it is a peer dependency. In the source the dependency is `workspace:*`.
- Peer dependencies of `@porterkit/nestjs`:

  | Package | Range |
  |---|---|
  | `@nestjs/common`, `@nestjs/core`, `@nestjs/websockets` | `^11.0.0` |
  | `rxjs` | `^7.1.0` |
  | `reflect-metadata` | `^0.1.12 \|\| ^0.2.0` |

- `@porterkit/nestjs` is developed and tested against NestJS 11. NestJS 12 is not in its peer range.
- `@nestjs/platform-ws`, `ws`, Express and Fastify are not dependencies of any package. The Integrator installs them.
- `@porterkit/client` uses the global `WebSocket`, `fetch` and timers and nothing of a browser besides: its tests run in Node, without jsdom.
- `@porterkit/react` is developed and tested against React 19. React 18 is in its peer range and is not tested: the package uses `useSyncExternalStore`, `useEffect` and `useRef` and nothing newer. React 17 is out, and there is no shim.
- `@porterkit/client` is a peer dependency of `@porterkit/react` and of `@porterkit/godot`, not a dependency: the Integrator installs it to create the instance, and a Binding imports only its types.
- `@porterkit/client` has a second entry point, `@porterkit/client/testing`, with a fake `WebSocket` and a storage in memory for the tests of a Binding or of an Integrator. It imports no test runner, so Vitest is not a dependency of the package.
- `@porterkit/react` has one entry point, the package root.
- All five declare `"license": "MIT"` and `"repository"` as `https://github.com/Sifawm/porter`, each with the `directory` of its package.

## TypeScript

- One TypeScript version, at the root. `strict` is on in `tsconfig.base.json`.
- `experimentalDecorators` and `emitDecoratorMetadata` are on only in `packages/nestjs` and `examples/server`.
- The `tsconfig` of `packages/contracts` includes neither Node nor DOM typings. Its `typecheck` is what keeps the package safe for a browser.

## Example

A private example of four projects that uses the packages as an Integrator would. Its Game is a shared counter: one setting with the target value, one client message `increment`, one server event announcing the new count, and the Match ends when the count reaches the target.

- `examples/game`: the Game's entry in the games map, its data and its Game definition. Server and web import it.
- `examples/server`: NestJS on Fastify with `@nestjs/platform-ws`. Its `main.ts` sets the WebSocket adapter. `PorterModule.forRoot` takes values written in code: no `@nestjs/config` and no `.env`.
- `examples/web`: Vite and React, on `@porterkit/client` and `@porterkit/react`, with no router and no component library. Login, waiting room and Match in one tree. The login screen has a selector of transport, WebSocket or SSE.
- `examples/godot`: the same Game drawn by Godot, with nothing of React: a page of Vite whose only code creates the instance, calls `exposeToGodot` and starts the engine, and a Godot project in `game/` with login, waiting room and Match in one script. `game/addons/porter` is a link to the addon in `packages/godot`.
- `pnpm dev` at the root starts server and web.
- The Godot example needs Godot 4.7 with its web export templates, which CI does not have. `pnpm --filter @porterkit/example-godot export` writes the export into `public/godot`, which is not versioned, and `pnpm --filter @porterkit/example-godot start` serves the page. Neither is part of `pnpm dev` or of `pnpm check`; `pnpm check` only typechecks the page's TypeScript, like any project.

## Tests

Vitest everywhere. There is no Jest, no Playwright and no coverage threshold.

- **Transformer.** Oxc, the default of Vite 8, in `contracts`, `client`, `react`, `godot`, `examples/game` and `examples/web`. `unplugin-swc` with `@swc/core` in `nestjs` and `examples/server`, which need decorator metadata.
- **`contracts`.** Type tests only (`expectTypeOf` under Vitest's typecheck). It has no runtime to test.
- **`nestjs`, the bulk.** Room rules and the connection lifecycle through the internal `connect(token, sink)` function ([nestjs.md](nestjs.md#connections)), with a fake sink and fake timers. No network and no NestJS application.
- **`nestjs`, the rest.** A few integration tests with `@nestjs/testing` (a login, a connection, one command), run on Fastify and on Express.
- **`client`.** Through a fake `WebSocket` and a fake `fetch`, with fake timers: login, both transports, state, Appliers, and reconnection with `maxRetries`.
- **`react`.** Hooks with `@testing-library/react` and jsdom, over the real client and the fake `WebSocket` of `@porterkit/client/testing`.
- **`godot`.** The facade over the real client and the fake `WebSocket` of `@porterkit/client/testing`, in Node. The addon has no automatic test: the bridge it uses exists only in a web export running in a browser. It is checked by hand with `examples/godot`, whose Game has no Match timer and takes no listener off: `timer_remaining`, `off` and `reconnect` have only the facade's tests behind them. It is kept to parsing JSON and emitting signals so that there is little to check ([ADR 0008](../adr/0008-godot-crosses-in-json.md)).
- **End to end.** One suite in `examples/server` starts the example server and drives it with `@porterkit/client` from Node, with no Binding, once over WebSocket and once over SSE.

## Checks

- **Format.** Oxfmt. No Prettier.
- **Lint.** Oxlint, run from a root script, without `@nx/oxlint`.
- **Dependencies.** ESLint with one rule, `@nx/dependency-checks`, over the `package.json` of `packages/*`. It guards the hand-written peer dependencies. `@nx/enforce-module-boundaries` is not used.
- **Hooks.** Husky 9. `commit-msg` runs commitlint with `@commitlint/config-conventional` and any scope. `pre-commit` runs the Oxfmt check and Oxlint over the whole repository, without `lint-staged`. There is no `pre-push`.
- **`pnpm check`.** A root script that runs, with `nx run-many`: format check, lint, `@nx/dependency-checks`, `typecheck`, build and every test, the end-to-end suite included. It is what CI runs and the first step of a release.

## Versions

- Node 24 for development. CI runs on Node 22 and 24.
- The five packages share one version. The first release is `0.1.0`.
- While the version is `0.x`, a change to the protocol raises the minor and a compatible change raises the patch.
- `1.0.0` is set by hand, when the goal of v1 in [README.md](README.md#goal-of-v1) is met.

## Publishing

- The registry is public npm, under the scope `@porterkit`. The repository is `Sifawm/porter` on GitHub, public, and the licence is MIT.
- `nx release` versions and publishes `packages/*` only, as one fixed group. The version comes from conventional commits. It writes one `CHANGELOG.md` at the root and tags `vX.Y.Z`. There is no semantic-release.
- Releases are published from GitHub Actions with npm trusted publishing (OIDC) and signed provenance. No npm token is stored. Each of the five packages trusts the repository `Sifawm/porter` and the workflow `release.yml`.

Two workflows, both started by hand:

| Workflow | Runs |
|---|---|
| `ci.yml` | `pnpm check` on a matrix of Node 22 and 24. No `nx affected`, no Nx Cloud |
| `release.yml` | on Node 24, `pnpm check` and then `nx release` |

`ci.yml` has no pull-request or push trigger. Adding them is a later decision and changes nothing else here.

## Verify during construction

- **SWC under Vite 8.** Whether Oxc has to be switched off in the Vitest configuration of `nestjs` and `examples/server` for `unplugin-swc` to act. If so, it is switched off there.
- **Oxc and injection.** Whether Oxc alone resolves a service injected into a NestJS provider. If it does, `unplugin-swc` and `@swc/core` are removed and "Tests" names one transformer.
- **`@nx/dependency-checks` under Oxlint.** Whether the rule runs under Oxlint's JS plugins. If it does, ESLint is removed and "Checks" says so.
- **Manifest of the NestJS package.** That the `exports`, `main` and `types` Nx generates for `packages/nestjs` are coherent for a CommonJS package once `"type": "module"` is gone. If they are not, they are written by hand.
- **Manifest of a types-only package.** That `@porterkit/contracts`, publishing declarations and no code, resolves for an Integrator under both `node16` and `bundler` module resolution. If it does not, it publishes an empty ESM entry as well, with `exports` exposing it under `default`.
- **Exact version on publish.** That `nx release` publishes `workspace:*` as the exact version of the release. If it publishes a range, the dependency on `@porterkit/contracts` is rewritten by the release configuration.
- **`isolatedModules` and decorators.** That `import type` in a decorated signature of `packages/nestjs` compiles with `emitDecoratorMetadata`. If it gives TS1272, `isolatedModules` is off in that package.
- **First release.** `nx release --first-release --dry-run` is run before the first real one. If its output is wrong, the release configuration is fixed before anything is published.

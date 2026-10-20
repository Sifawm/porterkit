# Porter

Real-time rooms as a library: `@porterkit/contracts` (types), `@porterkit/nestjs` (server), `@porterkit/client` (client), `@porterkit/react` and `@porterkit/godot` (its Bindings for React and for Godot).

- The specification in `docs/spec/` is normative. Read the file for the package you touch before changing it, and change the spec and the docs page in the same commit when behaviour changes. The site in `apps/docs` is written for Integrators from the spec; the `docs` skill says how to keep it in step.
- Use the vocabulary of `CONTEXT.md` in code, tests and commits. The ADRs in `docs/adr/` give the reasons for the decisions.
- Server rules are tested through the internal `connect(token, sink)` of `packages/nestjs/src/porter.ts` with a fake sink and fake timers; the client through a fake `WebSocket` and `fetch`. The GDScript addon of `packages/godot` has no automatic test: keep its logic in the TypeScript facade, and check it by hand with `examples/godot`. Tests go at those seams, not against internals.
- `pnpm check` runs everything CI runs. Run a single package with `pnpm exec nx run @porterkit/nestjs:test`.
- Commits follow Conventional Commits; `nx release` derives the version from them.

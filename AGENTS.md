# Porter

Real-time rooms as a library: `@porterkit/contracts` (types), `@porterkit/nestjs` (server), `@porterkit/react` (client).

- The specification in `docs/spec/` is normative. Read the file for the package you touch before changing it, and change the spec in the same commit when behaviour changes.
- Use the vocabulary of `CONTEXT.md` in code, tests and commits. The ADRs in `docs/adr/` give the reasons for the decisions.
- Server rules are tested through the internal `connect(token, sink)` of `packages/nestjs/src/porter.ts` with a fake sink and fake timers; the client through a fake `WebSocket` and `fetch`. Tests go at those seams, not against internals.
- `pnpm check` runs everything CI runs. Run a single package with `pnpm exec nx run @porterkit/nestjs:test`.
- Commits follow Conventional Commits; `nx release` derives the version from them.

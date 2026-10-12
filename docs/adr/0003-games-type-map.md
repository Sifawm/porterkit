# Integrators type the protocol with a games map, not declaration merging

The message types in `@porterkit/contracts` take one generic parameter: a map from game name to that game's types (settings, state, client and server messages, pause, end and reject reasons). Porter derives the game-name union, `ClientMessage`, `ServerMessage` and the per-game payloads from it. The alternative was a global interface the integrator augments with `declare module '@porterkit/contracts'`, which removes the `<Games>` parameter from every public type.

We chose the explicit parameter because augmentation is one list of games per program and fails silently when the augmenting file is not part of the compilation. The map lets an example app and a test suite in the same repo each have their own games. The cost is that every public message type carries `<Games>`; integrators hide it once behind their own aliases.

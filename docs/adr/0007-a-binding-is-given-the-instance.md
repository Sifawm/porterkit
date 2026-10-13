# A Binding is given the client's instance; it does not create it

`@porterkit/client` creates the instance with `createPorter`, and a Binding takes it as an argument: `createHooks(porter)` in `@porterkit/react`. The alternative, which `@porterkit/react` had while it was the whole client, was a `createPorter` of the Binding's own that returned the instance with its hooks attached, so that an Integrator imported one package.

We chose to hand the instance over because an instance is a connection, and a User has one: a second connection with the same Token replaces the first, on either transport. An application whose Games are drawn by different technologies, a lobby in React and a Game in an engine, has to read one room through one connection. If every Binding created its own instance, the second would cut the first. With the instance outside, any number of Bindings subscribe to it at once, and code with no Binding at all uses the same object.

The cost is two imports where there was one, and that the Integrator has to know the client exists as a package of its own. A Binding declares `@porterkit/client` as a peer dependency and imports only its types, so the two can never be two copies of the client.

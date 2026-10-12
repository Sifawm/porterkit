# The room token is opaque, not a JWT

Login returns a token of the form `<roomId>.<random>`, where the random part is 32 bytes from `crypto` stored on the User. Porter verifies it by looking the User up in the room. The alternative was a signed JWT carrying the room id and the name, as gruppkul does today.

We chose the opaque token because rooms live in memory in a single process, so a signature saves nothing: every verification has to reach the room anyway to check the User is still there, and a restart invalidates every token regardless. Dropping the JWT removes the secret the Integrator would have to configure and guard, removes a second clock (token expiry) running beside the Grace period, and removes `@nestjs/jwt` from the Integrator's dependencies. The room id prefix keeps the three connection rejections distinguishable: malformed token, room gone, User no longer in the room.

The cost is that the token cannot be verified without the room's state, and the client cannot read anything from it. If Porter later runs on several instances, tokens will need the same shared store the rooms need.

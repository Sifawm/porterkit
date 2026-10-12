# Porter knows what a Game is

Porter treats Game as a first-class concept: integrators register Games, and Porter owns their settings, state, in-room game switching and message dispatch. The alternative was a generic room library where whatever runs in the room is opaque. We chose games because the three gruppkul games are the only real integrators we have, and a generic extension point designed without a non-game integrator would be guesswork.

A non-game integrator has to present itself as a Game. Going generic later means lifting the game layer into a package on top of a room core, which is cheaper than building the game layer from nothing.

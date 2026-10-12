# Two transports: WebSocket and SSE + HTTP commands

Porter serves a room over WebSocket and over Server-Sent Events with an HTTP endpoint for client messages, both in v1. On real mobile devices, holding a WebSocket open made phones run hot and drained the battery; switching mobile clients to SSE + commands removed the problem, so gruppkul uses SSE for every mobile user and WebSocket on desktop. Shipping WebSocket alone would make Porter unusable for mobile integrators.

Both transports are thin adapters over one connection lifecycle; the lifecycle is written once.

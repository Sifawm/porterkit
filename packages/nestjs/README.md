# @porterkit/nestjs

Porter's server: a NestJS module that holds rooms in memory, logs Users into them, keeps their connections alive over WebSocket and SSE, runs the Match lifecycle and delivers each Game's messages to its Manager.

```ts
@Module({
  imports: [PorterModule.forRoot<Games>({ initialGame: 'misfit' }), MisfitModule],
})
export class AppModule {}
```

The application also installs `@nestjs/platform-ws` and `ws`, and calls `app.useWebSocketAdapter(new WsAdapter(app))`.

See the [guide](https://sifawm.github.io/porterkit/start/server/).

import { NestFactory } from '@nestjs/core';
import { WsAdapter } from '@nestjs/platform-ws';
import { AppModule } from './app.module';

const app = await NestFactory.create(AppModule);
app.useWebSocketAdapter(new WsAdapter(app));
app.enableCors();
await app.listen(3000);

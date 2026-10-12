import {
  Body,
  ConfigurableModuleBuilder,
  Controller,
  Head,
  Headers,
  HttpCode,
  HttpException,
  Inject,
  Injectable,
  Module,
  Param,
  Post,
  Query,
  Sse,
} from '@nestjs/common';
import type {
  ConfigurableModuleAsyncOptions,
  DynamicModule,
  OnApplicationBootstrap,
  OnModuleDestroy,
} from '@nestjs/common';
import { DiscoveryModule, DiscoveryService } from '@nestjs/core';
import { WebSocketGateway } from '@nestjs/websockets';
import type { OnGatewayConnection } from '@nestjs/websockets';
import type { GamesMap } from '@porterkit/contracts';
import { Observable } from 'rxjs';
import { definitionOf } from './decorators';
import { Porter } from './porter';
import type { PorterModuleOptions } from './types';

const { ConfigurableModuleClass, MODULE_OPTIONS_TOKEN } = new ConfigurableModuleBuilder<PorterModuleOptions<any>>()
  .setClassMethodName('forRoot')
  .build();

/** Makes an intermediary that buffers small responses release the stream. A client discards it. */
const SSE_PADDING = `:${' '.repeat(2048)}`;

/** Holds the one `Porter` of the application, built once every Manager can be found. */
@Injectable()
class PorterService implements OnApplicationBootstrap, OnModuleDestroy {
  porter!: Porter;

  constructor(
    @Inject(MODULE_OPTIONS_TOKEN) private readonly options: PorterModuleOptions<any>,
    private readonly discovery: DiscoveryService,
  ) {}

  onApplicationBootstrap() {
    const managers = this.discovery
      .getProviders()
      .filter((provider) => provider.metatype && definitionOf(provider.metatype) && provider.instance)
      .map((provider) => provider.instance as object);
    this.porter = new Porter(this.options, managers);
  }

  onModuleDestroy() {
    this.porter?.destroy();
  }
}

@Controller('porter')
class PorterController {
  constructor(private readonly service: PorterService) {}

  @Post('login')
  @HttpCode(200)
  async login(@Body() body: unknown) {
    const result = await this.service.porter.login(body);
    if (result.status !== 200) throw new HttpException(result.body, result.status);
    return result.body;
  }

  @Head('rooms/:id')
  roomExists(@Param('id') id: string) {
    if (!this.service.porter.roomExists(id)) throw new HttpException('', 404);
  }

  @Sse('events')
  events(@Query('token') token: unknown) {
    return new Observable<{ data: string }>((subscriber) => {
      subscriber.next({ data: SSE_PADDING });
      const connection = this.service.porter.connect(token, {
        send: (message) => subscriber.next({ data: JSON.stringify(message) }),
        close: () => subscriber.complete(),
      });
      return () => connection.closed();
    });
  }

  @Post('commands')
  @HttpCode(202)
  commands(@Headers('authorization') authorization: unknown, @Body() body: unknown) {
    const token = typeof authorization === 'string' ? /^Bearer (.+)$/.exec(authorization)?.[1] : undefined;
    const result = this.service.porter.command(token, body);
    if (result.status !== 202) throw new HttpException(result.body!, result.status);
  }
}

/** What the gateway uses of a `ws` socket. */
interface Socket {
  readyState: number;
  send(data: string): void;
  close(): void;
  on(event: 'message', listener: (data: { toString(): string }) => void): void;
  on(event: 'close', listener: () => void): void;
}

@WebSocketGateway({ path: '/porter/ws' })
class PorterGateway implements OnGatewayConnection {
  constructor(private readonly service: PorterService) {}

  handleConnection(socket: Socket, request: { url?: string }) {
    const token = new URL(request.url ?? '', 'http://porter').searchParams.get('token');
    const connection = this.service.porter.connect(token, {
      send: (message) => {
        if (socket.readyState === 1) socket.send(JSON.stringify(message));
      },
      close: () => socket.close(),
    });
    socket.on('message', (data) => {
      let raw: unknown;
      try {
        raw = JSON.parse(data.toString());
      } catch {
        // Not JSON: Porter answers `malformed`.
      }
      connection.receive(raw);
    });
    socket.on('close', () => connection.closed());
  }
}

@Module({
  imports: [DiscoveryModule],
  controllers: [PorterController],
  providers: [PorterService, PorterGateway],
})
export class PorterModule extends ConfigurableModuleClass {
  static forRoot<Games extends GamesMap>(options: PorterModuleOptions<Games>): DynamicModule {
    return super.forRoot(options);
  }

  static forRootAsync<Games extends GamesMap>(
    options: ConfigurableModuleAsyncOptions<PorterModuleOptions<Games>>,
  ): DynamicModule {
    return super.forRootAsync(options);
  }
}

import { Module } from '@nestjs/common';
import { PorterModule } from '@porterkit/nestjs';
import type { Games } from '@porterkit/example-game';
import { CounterManager } from './counter.manager';

@Module({ providers: [CounterManager] })
export class CounterModule {}

@Module({
  imports: [PorterModule.forRoot<Games>({ initialGame: 'counter', capacity: 8, gracePeriod: 15_000 }), CounterModule],
})
export class AppModule {}

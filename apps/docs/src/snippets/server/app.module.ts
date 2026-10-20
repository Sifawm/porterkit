// #region forRoot
import { Module } from '@nestjs/common';
import { PorterModule } from '@porterkit/nestjs';
import type { Games } from '../misfit/game';
import { MisfitModule } from '../misfit/module';

@Module({
  imports: [PorterModule.forRoot<Games>({ initialGame: 'misfit' }), MisfitModule],
})
export class AppModule {}
// #endregion

// #region game
import { Module } from '@nestjs/common';
import { CardService } from './card.service';
import { MisfitManager } from './manager';

@Module({ providers: [CardService, MisfitManager] })
export class MisfitModule {}
// #endregion

import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AffiliateLink } from './entities/affiliate-link.entity';
import { AffiliateLinksService } from './affiliate-links.service';

@Module({
  imports: [TypeOrmModule.forFeature([AffiliateLink])],
  providers: [AffiliateLinksService],
  exports: [TypeOrmModule, AffiliateLinksService],
})
export class AffiliateLinksModule {}

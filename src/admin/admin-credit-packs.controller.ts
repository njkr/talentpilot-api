import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { Request } from 'express';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from 'src/auth/decorators/current-user.decorator';
import { User } from 'src/auth/entities/user.entity';
import { reqCtx } from 'src/common/utils/req-ctx.util';
import { AdminGuard } from './guards/admin.guard';
import { AuditService } from '../audit/audit.service';
import { CreditPack } from '../payments/entities/credit-pack.entity';
import { StripeSyncService } from '../payments/stripe/stripe-sync.service';
import { CreatePackDto } from './dto/create-pack.dto';
import { UpdatePackDto } from './dto/update-pack.dto';

@ApiTags('admin')
@ApiBearerAuth('access-token')
@UseGuards(AdminGuard)
@Controller('admin/credit-packs')
export class AdminCreditPacksController {
  constructor(
    @InjectRepository(CreditPack)
    private readonly packs: Repository<CreditPack>,
    private readonly sync: StripeSyncService,
    private readonly audit: AuditService,
  ) {}

  @Get()
  @ApiOperation({ summary: 'List every credit pack, including inactive ones' })
  list() {
    return this.packs.find({ order: { displayOrder: 'ASC' } });
  }

  @Post()
  @ApiOperation({
    summary:
      'Create a credit pack — creates the matching one-time Stripe price',
  })
  async create(
    @Body() dto: CreatePackDto,
    @CurrentUser() admin: User,
    @Req() req: Request,
  ) {
    const pack = await this.packs.save(
      this.packs.create({
        name: dto.name,
        description: dto.description ?? null,
        credits: dto.credits,
        priceCents: dto.priceCents,
        displayOrder: dto.displayOrder ?? 0,
        bestValue: dto.bestValue ?? false,
        active: dto.active ?? true,
      }),
    );
    const synced = await this.sync.syncCreditPack(pack);
    await this.audit.log({
      userId: admin.id,
      actorType: 'admin',
      action: 'credit_pack.created',
      resourceType: 'credit_pack',
      resourceId: pack.id,
      ctx: reqCtx(req),
      metadata: dto as unknown as Record<string, unknown>,
    });
    return synced;
  }

  @Patch(':id')
  @ApiOperation({
    summary:
      'Edit a credit pack — a price change creates a NEW Stripe price and archives the old one',
  })
  async update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdatePackDto,
    @CurrentUser() admin: User,
    @Req() req: Request,
  ) {
    const pack = await this.packs.findOneOrFail({ where: { id } });
    Object.assign(pack, dto);
    const synced = await this.sync.syncCreditPack(pack);
    await this.audit.log({
      userId: admin.id,
      actorType: 'admin',
      action: 'credit_pack.updated',
      resourceType: 'credit_pack',
      resourceId: id,
      ctx: reqCtx(req),
      metadata: dto as unknown as Record<string, unknown>,
    });
    return synced;
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Archive a credit pack (never hard-deleted)' })
  async archive(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() admin: User,
    @Req() req: Request,
  ) {
    const pack = await this.packs.findOneOrFail({ where: { id } });
    await this.sync.archiveCreditPack(pack);
    await this.audit.log({
      userId: admin.id,
      actorType: 'admin',
      action: 'credit_pack.archived',
      resourceType: 'credit_pack',
      resourceId: id,
      ctx: reqCtx(req),
    });
    return { archived: true };
  }
}

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
import { Plan } from '../payments/entities/plan.entity';
import { StripeSyncService } from '../payments/stripe/stripe-sync.service';
import { CreatePlanDto } from './dto/create-plan.dto';
import { UpdatePlanDto } from './dto/update-plan.dto';

// Every route here mutates real billing configuration and talks to Stripe —
// @UseGuards(AdminGuard) at the controller level, same defensive pattern as
// AdminController, so no individual route can accidentally be left open.
@ApiTags('admin')
@ApiBearerAuth('access-token')
@UseGuards(AdminGuard)
@Controller('admin/plans')
export class AdminPlansController {
  constructor(
    @InjectRepository(Plan) private readonly plans: Repository<Plan>,
    private readonly sync: StripeSyncService,
    private readonly audit: AuditService,
  ) {}

  @Get()
  @ApiOperation({
    summary: 'List every plan, including inactive/archived ones',
  })
  list() {
    return this.plans.find({ order: { displayOrder: 'ASC' } });
  }

  @Post()
  @ApiOperation({
    summary: 'Create a plan — creates the matching Stripe product + price(s)',
  })
  async create(
    @Body() dto: CreatePlanDto,
    @CurrentUser() admin: User,
    @Req() req: Request,
  ) {
    const plan = await this.plans.save(
      this.plans.create({
        key: dto.key,
        name: dto.name,
        description: dto.description ?? null,
        priceMonthlyCents: dto.priceMonthlyCents,
        priceYearlyCents: dto.priceYearlyCents ?? 0,
        monthlyCredits: dto.monthlyCredits,
        limits: dto.limits,
        displayOrder: dto.displayOrder ?? 0,
        active: dto.active ?? true,
      }),
    );
    const synced = await this.sync.syncPlan(plan); // creates Stripe product + prices
    await this.audit.log({
      userId: admin.id,
      actorType: 'admin',
      action: 'plan.created',
      resourceType: 'plan',
      resourceId: plan.id,
      ctx: reqCtx(req),
      metadata: dto as unknown as Record<string, unknown>,
    });
    return synced;
  }

  @Patch(':id')
  @ApiOperation({
    summary:
      'Edit a plan — a price change creates a NEW Stripe price and archives the old one',
  })
  async update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdatePlanDto,
    @CurrentUser() admin: User,
    @Req() req: Request,
  ) {
    const plan = await this.plans.findOneOrFail({ where: { id } });
    Object.assign(plan, dto);
    const synced = await this.sync.syncPlan(plan); // re-syncs; creates new prices if amounts changed
    await this.audit.log({
      userId: admin.id,
      actorType: 'admin',
      action: 'plan.updated',
      resourceType: 'plan',
      resourceId: id,
      ctx: reqCtx(req),
      metadata: dto as unknown as Record<string, unknown>,
    });
    return synced;
  }

  @Delete(':id')
  @ApiOperation({
    summary:
      'Archive a plan (never hard-deleted — existing subscribers keep billing normally)',
  })
  async archive(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() admin: User,
    @Req() req: Request,
  ) {
    const plan = await this.plans.findOneOrFail({ where: { id } });
    await this.sync.archivePlan(plan);
    await this.audit.log({
      userId: admin.id,
      actorType: 'admin',
      action: 'plan.archived',
      resourceType: 'plan',
      resourceId: id,
      ctx: reqCtx(req),
    });
    return { archived: true };
  }
}

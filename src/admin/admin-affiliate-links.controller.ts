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
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from 'src/auth/decorators/current-user.decorator';
import { User } from 'src/auth/entities/user.entity';
import { reqCtx } from 'src/common/utils/req-ctx.util';
import { AdminGuard } from './guards/admin.guard';
import { AuditService } from '../audit/audit.service';
import { AffiliateLinksService } from '../affiliate-links/affiliate-links.service';
import { CreateAffiliateLinkDto } from './dto/create-affiliate-link.dto';
import { UpdateAffiliateLinkDto } from './dto/update-affiliate-link.dto';

@ApiTags('admin')
@ApiBearerAuth('access-token')
@UseGuards(AdminGuard)
@Controller('admin/affiliate-links')
export class AdminAffiliateLinksController {
  constructor(
    private readonly affiliateLinks: AffiliateLinksService,
    private readonly audit: AuditService,
  ) {}

  @Get()
  @ApiOperation({
    summary:
      'List every affiliate link template/override, including inactive ones',
  })
  list() {
    return this.affiliateLinks.list();
  }

  @Post()
  @ApiOperation({
    summary:
      'Create a resourceType default (omit keyword) or a keyword override',
  })
  async create(
    @Body() dto: CreateAffiliateLinkDto,
    @CurrentUser() admin: User,
    @Req() req: Request,
  ) {
    const link = await this.affiliateLinks.create(dto);
    await this.audit.log({
      userId: admin.id,
      actorType: 'admin',
      action: 'affiliate_link.created',
      resourceType: 'affiliate_link',
      resourceId: link.id,
      ctx: reqCtx(req),
      metadata: dto as unknown as Record<string, unknown>,
    });
    return link;
  }

  @Patch(':id')
  @ApiOperation({
    summary: 'Edit a template/override, including toggling active',
  })
  async update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateAffiliateLinkDto,
    @CurrentUser() admin: User,
    @Req() req: Request,
  ) {
    const link = await this.affiliateLinks.update(id, dto);
    await this.audit.log({
      userId: admin.id,
      actorType: 'admin',
      action: 'affiliate_link.updated',
      resourceType: 'affiliate_link',
      resourceId: id,
      ctx: reqCtx(req),
      metadata: dto as unknown as Record<string, unknown>,
    });
    return link;
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Delete a template/override' })
  async delete(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() admin: User,
    @Req() req: Request,
  ) {
    await this.affiliateLinks.delete(id);
    await this.audit.log({
      userId: admin.id,
      actorType: 'admin',
      action: 'affiliate_link.deleted',
      resourceType: 'affiliate_link',
      resourceId: id,
      ctx: reqCtx(req),
    });
    return { deleted: true };
  }
}

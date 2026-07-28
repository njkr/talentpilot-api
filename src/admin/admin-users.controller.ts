import {
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { Request } from 'express';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from 'src/auth/decorators/current-user.decorator';
import { User } from 'src/auth/entities/user.entity';
import { reqCtx } from 'src/common/utils/req-ctx.util';
import { AdminGuard } from './guards/admin.guard';
import { AdminUsersService } from './admin-users.service';
import { AdminUserQueryDto } from './dto/admin-user-query.dto';
import { AuditService } from '../audit/audit.service';

@ApiTags('admin')
@ApiBearerAuth('access-token')
@UseGuards(AdminGuard)
@Controller('admin/users')
export class AdminUsersController {
  constructor(
    private readonly adminUsers: AdminUsersService,
    private readonly audit: AuditService,
  ) {}

  @Get()
  @ApiOperation({
    summary:
      'Paginated user list — spend (lifetime + windowed), resume/cover-letter counts, referral stats, current plan',
  })
  async list(@Query() q: AdminUserQueryDto) {
    return this.adminUsers.list(q);
  }

  @Post(':id/suspend')
  @ApiOperation({
    summary:
      'Revoke access — blocks login and token refresh (existing short-lived access tokens stay valid until they expire)',
  })
  async suspend(
    @CurrentUser() admin: User,
    @Req() req: Request,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    const { previousStatus } = await this.adminUsers.suspend(id, admin.id);
    await this.audit.log({
      userId: admin.id,
      actorType: 'admin',
      action: 'admin.user.suspend',
      resourceType: 'user',
      resourceId: id,
      ctx: reqCtx(req),
      metadata: { previousStatus, newStatus: 'suspended' },
    });
    return { status: 'suspended' };
  }

  @Post(':id/activate')
  @ApiOperation({ summary: 'Grant/restore access' })
  async activate(
    @CurrentUser() admin: User,
    @Req() req: Request,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    const { previousStatus } = await this.adminUsers.activate(id);
    await this.audit.log({
      userId: admin.id,
      actorType: 'admin',
      action: 'admin.user.activate',
      resourceType: 'user',
      resourceId: id,
      ctx: reqCtx(req),
      metadata: { previousStatus, newStatus: 'active' },
    });
    return { status: 'active' };
  }
}

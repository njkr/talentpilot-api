import {
  BadRequestException,
  Body,
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
import { AdminService, DlqQueueName } from './admin.service';
import { ActivatePromptDto } from './dto/activate-prompt.dto';
import { AuditQueryDto } from './dto/audit-query.dto';
import { AuditService } from '../audit/audit.service';

function assertQueueName(name: string): asserts name is DlqQueueName {
  if (!(AdminService.QUEUE_NAMES as readonly string[]).includes(name)) {
    throw new BadRequestException(
      `Unknown queue "${name}". Valid: ${AdminService.QUEUE_NAMES.join(', ')}`,
    );
  }
}

// Every route here is a real ops action against production data (retrying dead
// jobs, flipping the active prompt version for everyone) — @UseGuards(AdminGuard) at
// the controller level means no individual route can accidentally be left open.
@ApiTags('admin')
@ApiBearerAuth('access-token')
@UseGuards(AdminGuard)
@Controller('admin')
export class AdminController {
  constructor(
    private readonly admin: AdminService,
    private readonly audit: AuditService,
  ) {}

  @Get('runs/:id')
  @ApiOperation({
    summary: 'Full inspector view of one pipeline run (run + every step row)',
  })
  async inspectRun(@Param('id', ParseUUIDPipe) id: string) {
    return this.admin.inspectRun(id);
  }

  @Get('queues/:name/dead-letter')
  @ApiOperation({
    summary: 'List failed jobs in a queue (resumes|pipeline|documents|emails)',
  })
  async listDeadLetter(
    @Param('name') name: string,
    @Query('start') start?: string,
    @Query('end') end?: string,
  ) {
    assertQueueName(name);
    return this.admin.listDeadLetter(
      name,
      start ? Number(start) : undefined,
      end ? Number(end) : undefined,
    );
  }

  @Post('queues/:name/dead-letter/:jobId/retry')
  @ApiOperation({ summary: 'Requeue one failed job for another attempt' })
  async requeueDeadLetter(
    @CurrentUser() user: User,
    @Req() req: Request,
    @Param('name') name: string,
    @Param('jobId') jobId: string,
  ) {
    assertQueueName(name);
    await this.admin.requeueDeadLetter(name, jobId);
    await this.audit.log({
      userId: user.id,
      actorType: 'admin',
      action: 'admin.dead_letter.retry',
      resourceType: 'queue_job',
      resourceId: null,
      ctx: reqCtx(req),
      metadata: { queue: name, jobId },
    });
    return { requeued: true };
  }

  @Get('costs')
  @ApiOperation({
    summary: 'AI cost breakdown by feature, by day, and top-spending users',
  })
  async costBreakdown(@Query('days') days?: string) {
    return this.admin.costBreakdown(days ? Number(days) : undefined);
  }

  @Get('prompts/:key/versions')
  @ApiOperation({ summary: 'Every version of a prompt template, newest first' })
  async listPromptVersions(@Param('key') key: string) {
    return this.admin.listPromptVersions(key);
  }

  @Post('prompts/:key/activate')
  @ApiOperation({ summary: 'Activate a specific prompt version for everyone' })
  async activatePrompt(
    @CurrentUser() user: User,
    @Req() req: Request,
    @Param('key') key: string,
    @Body() dto: ActivatePromptDto,
  ) {
    await this.admin.activatePrompt(key, dto.version);
    await this.audit.log({
      userId: user.id,
      actorType: 'admin',
      action: 'admin.prompt.activate',
      resourceType: 'prompt_template',
      resourceId: null,
      ctx: reqCtx(req),
      metadata: { key, version: dto.version },
    });
    return { activated: true };
  }

  @Get('audit')
  @ApiOperation({ summary: 'Query the audit log' })
  async listAudit(@Query() q: AuditQueryDto) {
    const { userId, action, resourceType } = q;
    return this.audit.list({ userId, action, resourceType }, q);
  }
}

import {
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Sse,
  UseGuards,
} from '@nestjs/common';
import { MessageEvent } from '@nestjs/common';
import { Observable } from 'rxjs';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from 'src/auth/decorators/current-user.decorator';
import { Public } from 'src/auth/decorators/public.decorator';
import { VerifiedGuard } from 'src/auth/guards/verified.guard';
import { User } from 'src/auth/entities/user.entity';
import { RawResponse } from 'src/common/decorators/raw-response.decorator';
import { CursorQueryDto } from 'src/common/dto/cursor-query.dto';
import {
  ApiDataResponse,
  ApiErrorResponses,
  ApiNoContentResponse,
} from 'src/common/swagger/api-response.decorator';
import { Problems } from 'src/common/problems';
import { WorkspacesService } from './workspaces.service';
import { StreamTicketService } from '../pipeline/stream-ticket.service';
import { ProgressBus } from '../pipeline/progress/progress.bus';
import { CreateWorkspaceDto } from './dto/create-workspace.dto';
import { WorkspaceResponse } from './dto/workspace-response.dto';
import { RunResponse } from './dto/run-response.dto';
import { AtsReportResponse } from './dto/ats-report-response.dto';

@ApiTags('workspaces')
@ApiBearerAuth('access-token')
@Controller('workspaces')
export class WorkspacesController {
  constructor(
    private readonly workspaces: WorkspacesService,
    private readonly tickets: StreamTicketService,
    private readonly bus: ProgressBus,
  ) {}

  @Post()
  @ApiOperation({
    summary: 'Create a workspace pairing a resume with a job description',
  })
  @ApiDataResponse(201, WorkspaceResponse, 'Created.')
  @ApiErrorResponses({
    404: 'No resume or job description with that id belongs to the current user.',
  })
  async create(@CurrentUser() user: User, @Body() dto: CreateWorkspaceDto) {
    return new WorkspaceResponse(
      await this.workspaces.create(
        user.id,
        dto.resumeId,
        dto.jobDescriptionId,
        dto.name,
      ),
    );
  }

  @Get()
  @ApiOperation({ summary: 'List workspaces (cursor-paginated, newest first)' })
  @ApiDataResponse(200, WorkspaceResponse, 'A page of workspaces.', {
    isArray: true,
  })
  async list(@CurrentUser() user: User, @Query() q: CursorQueryDto) {
    const { data, hasMore, nextCursor } = await this.workspaces.list(
      user.id,
      q,
    );
    return {
      data: data.map((w) => new WorkspaceResponse(w)),
      hasMore,
      nextCursor,
    };
  }

  @Post(':id/analyze')
  @HttpCode(202)
  @UseGuards(VerifiedGuard)
  @ApiOperation({
    summary: 'Start (or resume) a full analysis run',
    description:
      'Requires a unique `Idempotency-Key` header — replaying the same key returns the ' +
      'same run instead of starting (and charging for) a second one. Debits ' +
      '10 credits atomically with creating the run.',
  })
  @ApiErrorResponses({
    400: 'Missing Idempotency-Key header.',
    402: 'Insufficient credits (INSUFFICIENT_CREDITS).',
    404: 'No workspace with that id belongs to the current user.',
    409: 'The resume/JD is not ready yet, or another analysis is already running for this workspace.',
  })
  async analyze(
    @CurrentUser() user: User,
    @Param('id', ParseUUIDPipe) id: string,
    @Headers('idempotency-key') key: string,
  ) {
    const { run, replayed } = await this.workspaces.analyze(id, user.id, key);
    return {
      runId: run.id,
      status: run.status,
      creditsCharged: run.creditsCharged,
      replayed,
    };
  }

  @Post('runs/:runId/stream-ticket')
  @ApiOperation({
    summary: 'Mint a single-use SSE ticket for a run',
    description:
      "The browser's EventSource API can't send an Authorization header, so the stream " +
      'endpoint below authenticates via a 60-second single-use ticket instead. Call this ' +
      '(authenticated normally) first, then open the stream with the returned ticket.',
  })
  @ApiErrorResponses({
    404: 'No run with that id belongs to the current user.',
  })
  async ticket(
    @CurrentUser() user: User,
    @Param('runId', ParseUUIDPipe) runId: string,
  ) {
    await this.workspaces.getRun(runId, user.id); // 404s if not owned
    return {
      ticket: await this.tickets.mint(user.id, runId),
      expiresInSec: 60,
    };
  }

  @Public() // auth is the ticket, not a JWT
  @RawResponse() // no envelope on a stream
  @Sse('runs/:runId/stream')
  @ApiOperation({
    summary: 'Live run progress via Server-Sent Events',
    description:
      'Requires `?ticket=` from the stream-ticket endpoint above, not a Bearer token. ' +
      'Always sends a `snapshot` event first (current state), so a client that connects ' +
      'after the run already finished still gets a useful response instead of waiting ' +
      'forever. Sends a `ping` heartbeat every 15s to survive idle-connection timeouts.',
  })
  async stream(
    @Param('runId', ParseUUIDPipe) runId: string,
    @Query('ticket') ticket: string,
  ): Promise<Observable<MessageEvent>> {
    const claim = await this.tickets.consume(ticket);
    if (claim.runId !== runId) throw Problems.streamTicketInvalid();

    return new Observable<MessageEvent>((subscriber) => {
      // Replay current state first. A client that connects late (or reconnects) must
      // not sit on an empty screen waiting for the next event — it may never come if
      // the run already finished.
      this.workspaces
        .getRun(runId, claim.userId)
        .then(({ run, steps }) => {
          subscriber.next({
            type: 'snapshot',
            data: {
              runId,
              status: run.status,
              progress: run.progress,
              steps: steps.map((s) => ({ name: s.name, status: s.status })),
            },
          });
          if (['completed', 'failed', 'partial'].includes(run.status)) {
            subscriber.complete(); // terminal — nothing more will arrive
          }
        })
        .catch((err) => subscriber.error(err));

      const unsubscribe = this.bus.subscribe(runId, (event) => {
        subscriber.next({ type: event.type, data: event });
        if (event.type === 'run.completed' || event.type === 'run.failed') {
          setTimeout(() => subscriber.complete(), 100); // let the last frame flush
        }
      });

      // Proxies and load balancers kill idle connections at 30-60s, and a long AI step
      // can easily be silent for longer than that.
      const heartbeat = setInterval(
        () => subscriber.next({ type: 'ping', data: {} }),
        15_000,
      );

      return () => {
        clearInterval(heartbeat);
        unsubscribe();
      };
    });
  }

  @Get('runs/:runId')
  @ApiOperation({
    summary: 'Get run status (polling fallback)',
    description:
      'Same state shape as the SSE `snapshot` event, for clients that skip SSE.',
  })
  @ApiDataResponse(200, RunResponse, 'Current run state.')
  @ApiErrorResponses({
    404: 'No run with that id belongs to the current user.',
  })
  async getRun(
    @CurrentUser() user: User,
    @Param('runId', ParseUUIDPipe) runId: string,
  ) {
    const { run, steps } = await this.workspaces.getRun(runId, user.id);
    return new RunResponse(run, steps);
  }

  @Post('runs/:runId/retry')
  @ApiOperation({
    summary: 'Retry a failed or partial run',
    description:
      'Completed steps are skipped (StepRunner is idempotent), so this only re-does the ' +
      'work that actually failed — and does not re-charge credits.',
  })
  @ApiDataResponse(200, RunResponse, 'Re-queued.')
  @ApiErrorResponses({
    404: 'No run with that id belongs to the current user.',
    409: 'Run is not `failed` or `partial` (RUN_NOT_RETRYABLE).',
  })
  async retryRun(
    @CurrentUser() user: User,
    @Param('runId', ParseUUIDPipe) runId: string,
  ) {
    await this.workspaces.retry(runId, user.id);
    const { run, steps } = await this.workspaces.getRun(runId, user.id);
    return new RunResponse(run, steps);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get a single workspace' })
  @ApiDataResponse(200, WorkspaceResponse, 'The workspace.')
  @ApiErrorResponses({
    404: 'No workspace with that id belongs to the current user.',
  })
  async get(@CurrentUser() user: User, @Param('id', ParseUUIDPipe) id: string) {
    return new WorkspaceResponse(await this.workspaces.findOwned(id, user.id));
  }

  @Get(':id/report')
  @ApiOperation({
    summary: 'Get the ATS score for a workspace',
    description:
      'The output of the most recent completed `score_ats` step for this workspace — ' +
      'overall score, the per-component breakdown, AI-written strengths/weaknesses/' +
      'recommendations, and the full keyword match list.',
  })
  @ApiDataResponse(200, AtsReportResponse, 'The most recent ATS report.')
  @ApiErrorResponses({
    404: 'No workspace with that id belongs to the current user.',
    409: 'No completed analysis exists yet for this workspace (REPORT_NOT_READY).',
  })
  async getReport(
    @CurrentUser() user: User,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    const { report, keywords } = await this.workspaces.getReport(id, user.id);
    return new AtsReportResponse(report, keywords);
  }

  @Delete(':id')
  @HttpCode(204)
  @ApiOperation({ summary: 'Delete a workspace (soft delete)' })
  @ApiNoContentResponse(204, 'Deleted.')
  @ApiErrorResponses({
    404: 'No workspace with that id belongs to the current user.',
  })
  async remove(
    @CurrentUser() user: User,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    await this.workspaces.remove(id, user.id);
  }
}

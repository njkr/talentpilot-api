import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { PipelineRun } from './entities/pipeline-run.entity';
import { PipelineStep } from './entities/pipeline-step.entity';
import { ProgressBus } from './progress/progress.bus';
import { StreamTicketService } from './stream-ticket.service';

/**
 * The pieces both the API process (orchestration: create/list/status/SSE) and the
 * worker process (execution: StepRunner) need — the run/step entities and the two
 * Redis-backed services. Split out from a hypothetical single "PipelineModule" so
 * neither process pulls in the other's step-execution machinery.
 */
@Module({
  imports: [TypeOrmModule.forFeature([PipelineRun, PipelineStep])],
  providers: [ProgressBus, StreamTicketService],
  exports: [TypeOrmModule, ProgressBus, StreamTicketService],
})
export class PipelineCommonModule {}

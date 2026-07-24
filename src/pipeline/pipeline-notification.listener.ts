import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { NotificationsService } from '../notifications/notifications.service';

interface RunFinishedEvent {
  runId: string;
  userId: string;
  workspaceId: string;
  status: 'completed' | 'partial' | 'failed';
  failedSteps: string[];
}

/**
 * Reacts to StepRunner's domain events (not the ProgressBus SSE stream — see the
 * comment in step-runner.service.ts) so a user gets an in-app + email notification
 * even if they've closed the tab and aren't watching the live progress bar.
 */
@Injectable()
export class PipelineNotificationListener {
  private readonly logger = new Logger(PipelineNotificationListener.name);

  constructor(private readonly notifications: NotificationsService) {}

  @OnEvent('run.completed')
  async onCompleted(e: RunFinishedEvent) {
    await this.notify(e, {
      type: 'run.completed',
      title: 'Your analysis is ready',
      message: 'Your resume analysis finished — view your results now.',
    });
  }

  @OnEvent('run.failed')
  async onFailed(e: RunFinishedEvent) {
    const partial = e.status === 'partial';
    await this.notify(e, {
      type: 'run.failed',
      title: partial
        ? 'Your analysis finished with some gaps'
        : 'Your analysis failed',
      message: partial
        ? `Most steps completed, but ${e.failedSteps.length} optional step(s) could not finish.`
        : 'We could not complete your resume analysis. Any spent credits for missing steps were refunded.',
    });
  }

  private async notify(
    e: RunFinishedEvent,
    n: { type: string; title: string; message: string },
  ) {
    try {
      await this.notifications.create(e.userId, {
        ...n,
        data: { runId: e.runId, workspaceId: e.workspaceId, status: e.status },
      });
    } catch (err) {
      // A notification failure must never crash the pipeline job — the run itself
      // already finished and been persisted by the time this listener fires.
      this.logger.error(`notification failed for run ${e.runId}`, err as Error);
    }
  }
}

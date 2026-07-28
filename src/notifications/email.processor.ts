import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { Resend } from 'resend';
import { Env } from '../config/config.module';
import { IntegrationCallRecorderService } from '../integration-calls/integration-call-recorder.service';
import { EmailJob } from './email-job.interface';
import { renderTemplate } from './email.templates';

@Processor('emails')
export class EmailProcessor extends WorkerHost {
  private readonly resend: Resend;

  constructor(
    private readonly env: Env,
    private readonly integrationCalls: IntegrationCallRecorderService,
  ) {
    super();
    // Built in the constructor body, not a field initializer: field initializers
    // run before `this.env` (a parameter property) is guaranteed assigned.
    this.resend = new Resend(this.env.get('RESEND_API_KEY'));
  }

  async process(job: Job<EmailJob>) {
    const { to, template, vars } = job.data;
    const { subject, html } = renderTemplate(template, vars);
    const start = Date.now();
    const { error } = await this.resend.emails.send({
      from: this.env.get('EMAIL_FROM'),
      to,
      subject,
      html,
    });
    await this.integrationCalls.record({
      provider: 'resend',
      operation: 'email.send',
      success: !error,
      errorType: error?.message ?? null,
      durationMs: Date.now() - start,
      metadata: { template },
    });
    if (error) throw new Error(error.message); // → BullMQ retries (5×, exp backoff)
  }
}

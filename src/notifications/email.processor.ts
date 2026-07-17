import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { Resend } from 'resend';
import { Env } from '../config/config.module';
import { EmailJob } from './email-job.interface';
import { renderTemplate } from './email.templates';

@Processor('emails')
export class EmailProcessor extends WorkerHost {
  private readonly resend: Resend;

  constructor(private readonly env: Env) {
    super();
    // Built in the constructor body, not a field initializer: field initializers
    // run before `this.env` (a parameter property) is guaranteed assigned.
    this.resend = new Resend(this.env.get('RESEND_API_KEY'));
  }

  async process(job: Job<EmailJob>) {
    const { to, template, vars } = job.data;
    const { subject, html } = renderTemplate(template, vars);
    const { error } = await this.resend.emails.send({
      from: this.env.get('EMAIL_FROM'),
      to,
      subject,
      html,
    });
    if (error) throw new Error(error.message); // → BullMQ retries (5×, exp backoff)
  }
}

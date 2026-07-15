import { Processor } from '@nestjs/bullmq';
import { WorkerHost } from '@nestjs/bullmq/dist/worker-host';
import { Resend } from 'resend';
import { Env } from '../config/config.module';
import { EmailJob } from './email-job.interface';
import { renderTemplate } from './email.templates';
@Processor('emails')
export class EmailProcessor extends WorkerHost {
  private readonly resend = new Resend(this.env.get('RESEND_API_KEY'));
  constructor(private readonly env: Env) {
    super();
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

export type EmailTemplate =
  | 'verify-email'
  | 'reset-password'
  | 'notification'
  | 'payment-failed';

export interface EmailJob {
  to: string;
  template: EmailTemplate;
  vars: Record<string, unknown>;
}

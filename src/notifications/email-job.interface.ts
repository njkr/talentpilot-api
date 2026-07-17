export type EmailTemplate = 'verify-email' | 'reset-password';

export interface EmailJob {
  to: string;
  template: EmailTemplate;
  vars: Record<string, unknown>;
}

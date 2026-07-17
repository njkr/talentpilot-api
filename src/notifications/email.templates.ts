import { EmailTemplate } from './email-job.interface';

interface Rendered {
  subject: string;
  html: string;
}

const escapeHtml = (s: string) =>
  s.replace(
    /[&<>"']/g,
    (c) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[
        c
      ]!,
  );

const templates: Record<
  EmailTemplate,
  (vars: Record<string, unknown>) => Rendered
> = {
  'verify-email': (vars) => {
    const code = escapeHtml(String(vars.code));
    const ttlMin = escapeHtml(String(vars.ttlMin));
    return {
      subject: 'Verify your TalentPilot email',
      html: `
        <p>Your verification code is:</p>
        <p style="font-size:28px;font-weight:700;letter-spacing:4px">${code}</p>
        <p>This code expires in ${ttlMin} minutes. If you didn't request this, ignore this email.</p>
      `.trim(),
    };
  },
  'reset-password': (vars) => {
    const url = escapeHtml(String(vars.url));
    return {
      subject: 'Reset your TalentPilot password',
      html: `
        <p>We received a request to reset your password.</p>
        <p><a href="${url}">Click here to choose a new password</a>.</p>
        <p>If you didn't request this, you can safely ignore this email.</p>
      `.trim(),
    };
  },
};

export const renderTemplate = (
  template: EmailTemplate,
  vars: Record<string, unknown>,
): Rendered => templates[template](vars);

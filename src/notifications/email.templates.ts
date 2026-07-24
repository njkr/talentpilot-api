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
  notification: (vars) => {
    const title = escapeHtml(String(vars.title));
    const message = escapeHtml(String(vars.message));
    return {
      subject: title,
      html: `
        <p style="font-weight:700">${title}</p>
        <p>${message}</p>
      `.trim(),
    };
  },
  'payment-failed': (vars) => {
    const url = escapeHtml(String(vars.url));
    return {
      subject: 'We could not process your TalentPilot payment',
      html: `
        <p>Your most recent payment did not go through, so your subscription is now past due.</p>
        <p><a href="${url}">Update your payment method</a> to keep your plan active.</p>
      `.trim(),
    };
  },
};

export const renderTemplate = (
  template: EmailTemplate,
  vars: Record<string, unknown>,
): Rendered => templates[template](vars);

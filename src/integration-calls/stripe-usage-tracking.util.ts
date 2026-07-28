// See src/integration-calls for why this exists — separate from ANY Injectable, deliberately.
import Stripe = require('stripe');
import { IntegrationCallRecorderService } from './integration-call-recorder.service';

/**
 * Attaches usage tracking to a Stripe client instance. Stripe's Node SDK emits a `'response'`
 * event on EVERY API call (confirmed via node_modules/stripe/cjs/lib.d.ts's `ResponseEvent`:
 * `{ method, path, status, elapsed, request_id }`) — `status` alone tells success/failure,
 * `elapsed` is duration. One hook here captures ALL Stripe traffic from whichever service calls
 * this, without touching the dozens of individual `.checkout.sessions.create(...)`-style call
 * sites scattered across payments.service.ts, stripe-sync.service.ts, credit-packs.service.ts,
 * and gdpr.service.ts.
 *
 * Plain function, not a class: there are 4 separate `new Stripe(...)` construction sites (each
 * service builds its own client — a pre-existing characteristic of this codebase, not something
 * this change restructures), so this is called once per constructor rather than injected.
 */
export function attachStripeUsageTracking(
  stripe: Stripe,
  recorder: IntegrationCallRecorderService,
): void {
  stripe.on('response', (event: Stripe.ResponseEvent) => {
    void recorder.record({
      provider: 'stripe',
      operation: `${event.method} ${event.path}`,
      success: event.status < 400,
      errorType: event.status >= 400 ? String(event.status) : null,
      durationMs: Math.round(event.elapsed),
    });
  });
}

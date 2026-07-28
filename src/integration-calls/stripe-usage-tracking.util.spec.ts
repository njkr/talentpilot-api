import { attachStripeUsageTracking } from './stripe-usage-tracking.util';

function build() {
  const handlers: Record<string, (event: unknown) => void> = {};
  const stripe = {
    on: jest.fn((event: string, handler: (e: unknown) => void) => {
      handlers[event] = handler;
    }),
  };
  const recorder = { record: jest.fn().mockResolvedValue(undefined) };
  return { stripe, recorder, handlers };
}

describe('attachStripeUsageTracking', () => {
  it('records a successful call from a 2xx response event', () => {
    const { stripe, recorder, handlers } = build();
    attachStripeUsageTracking(stripe as any, recorder as any);

    handlers.response({
      method: 'POST',
      path: '/v1/checkout/sessions',
      status: 200,
      elapsed: 123.4,
    });

    expect(recorder.record).toHaveBeenCalledWith({
      provider: 'stripe',
      operation: 'POST /v1/checkout/sessions',
      success: true,
      errorType: null,
      durationMs: 123,
    });
  });

  it('records a failed call from a 4xx/5xx response event, using the status as errorType', () => {
    const { stripe, recorder, handlers } = build();
    attachStripeUsageTracking(stripe as any, recorder as any);

    handlers.response({
      method: 'GET',
      path: '/v1/customers/cus_1',
      status: 404,
      elapsed: 50,
    });

    expect(recorder.record).toHaveBeenCalledWith({
      provider: 'stripe',
      operation: 'GET /v1/customers/cus_1',
      success: false,
      errorType: '404',
      durationMs: 50,
    });
  });
});

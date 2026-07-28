import { IntegrationCallRecorderService } from './integration-call-recorder.service';

function build() {
  const calls = {
    create: jest.fn((x) => x),
    save: jest.fn().mockResolvedValue(undefined),
  };
  const service = new IntegrationCallRecorderService(calls as any);
  return { service, calls };
}

describe('IntegrationCallRecorderService.record', () => {
  it('saves a row with the given fields, defaulting optional ones to null', async () => {
    const { service, calls } = build();

    await service.record({
      provider: 'resend',
      operation: 'email.send',
      success: true,
      durationMs: 42,
    });

    expect(calls.create).toHaveBeenCalledWith({
      provider: 'resend',
      operation: 'email.send',
      success: true,
      errorType: null,
      durationMs: 42,
      metadata: null,
    });
    expect(calls.save).toHaveBeenCalled();
  });

  it('never throws when the underlying save rejects — a metering failure must not break the real call', async () => {
    const { service, calls } = build();
    calls.save.mockRejectedValue(new Error('db down'));

    await expect(
      service.record({
        provider: 's3',
        operation: 'PutObject',
        success: false,
        errorType: 'NoSuchBucket',
        durationMs: 10,
      }),
    ).resolves.toBeUndefined();
  });
});

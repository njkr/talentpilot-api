import { ReferralsListener } from './referrals.listener';

function build() {
  const referrals = {
    recordSignup: jest.fn().mockResolvedValue(undefined),
    checkQualification: jest.fn().mockResolvedValue(undefined),
  };
  const listener = new ReferralsListener(referrals as any);
  return { listener, referrals };
}

describe('ReferralsListener.onRegistered', () => {
  it('does nothing when no referralCode was given at signup', async () => {
    const { listener, referrals } = build();

    await listener.onRegistered({ user: { id: 'user-1' } as any });

    expect(referrals.recordSignup).not.toHaveBeenCalled();
  });

  it('records the signup and checks the "signup" qualifying event', async () => {
    const { listener, referrals } = build();

    await listener.onRegistered({
      user: { id: 'user-1', email: 'a@b.com' } as any,
      referralCode: 'CODE123',
    });

    expect(referrals.recordSignup).toHaveBeenCalledWith(
      'user-1',
      'a@b.com',
      'CODE123',
    );
    expect(referrals.checkQualification).toHaveBeenCalledWith(
      'user-1',
      'signup',
    );
  });

  it('never throws even if recording fails — a referral bug must not fail registration', async () => {
    const { listener, referrals } = build();
    referrals.recordSignup.mockRejectedValue(new Error('db down'));

    await expect(
      listener.onRegistered({
        user: { id: 'user-1', email: 'a@b.com' } as any,
        referralCode: 'CODE123',
      }),
    ).resolves.toBeUndefined();
  });
});

describe('ReferralsListener.onVerified', () => {
  it("checks the 'email_verified' qualifying event", async () => {
    const { listener, referrals } = build();

    await listener.onVerified({ user: { id: 'user-1' } as any });

    expect(referrals.checkQualification).toHaveBeenCalledWith(
      'user-1',
      'email_verified',
    );
  });
});

describe('ReferralsListener.onRunCompleted', () => {
  it("checks the 'first_analysis' qualifying event, fire-and-forget", async () => {
    const { listener, referrals } = build();

    await listener.onRunCompleted({ userId: 'user-1' });

    expect(referrals.checkQualification).toHaveBeenCalledWith(
      'user-1',
      'first_analysis',
    );
  });

  it('never throws even if the check fails — must not affect the pipeline result', async () => {
    const { listener, referrals } = build();
    referrals.checkQualification.mockRejectedValue(new Error('db down'));

    await expect(
      listener.onRunCompleted({ userId: 'user-1' }),
    ).resolves.toBeUndefined();
  });
});

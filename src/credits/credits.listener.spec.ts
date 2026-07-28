import { CreditsListener } from './credits.listener';

function build() {
  const credits = { grant: jest.fn().mockResolvedValue(undefined) };
  const paymentConfig = {
    get: jest.fn().mockResolvedValue({ signupCreditGrant: 25 }),
  };
  const listener = new CreditsListener(credits as any, paymentConfig as any);
  return { listener, credits, paymentConfig };
}

describe('CreditsListener.onRegistered', () => {
  it('grants the signup bonus from PaymentConfig, not a hardcoded/env value', async () => {
    const { listener, credits, paymentConfig } = build();

    await listener.onRegistered({ user: { id: 'user-1' } });

    expect(paymentConfig.get).toHaveBeenCalled();
    expect(credits.grant).toHaveBeenCalledWith('user-1', 25, 'signup_bonus');
  });

  it('never throws even if the grant fails — a broken signup bonus must not fail registration', async () => {
    const { listener, credits } = build();
    credits.grant.mockRejectedValue(new Error('db down'));

    await expect(
      listener.onRegistered({ user: { id: 'user-1' } }),
    ).resolves.toBeUndefined();
  });
});

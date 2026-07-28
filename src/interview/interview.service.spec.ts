import { InterviewService } from './interview.service';

function build() {
  const complete = jest.fn();
  const ai = { complete } as any;
  const chunker = { chunkResume: jest.fn().mockReturnValue([]) } as any;
  const balance = jest.fn().mockResolvedValue(10);
  const debit = jest.fn().mockResolvedValue(undefined);
  const credits = { balance, debit } as any;
  const paymentConfig = {
    get: jest.fn().mockResolvedValue({ interviewFeedbackCost: 1 }),
  } as any;
  const questions = {
    findOne: jest.fn(),
    findOneOrFail: jest.fn(),
    update: jest.fn().mockResolvedValue(undefined),
    create: jest.fn((x) => x),
    save: jest.fn((x) => Promise.resolve(x)),
    find: jest.fn(),
  };
  const workspaces = { findOne: jest.fn().mockResolvedValue({ id: 'ws-1' }) };

  const service = new InterviewService(
    ai,
    chunker,
    credits,
    paymentConfig,
    questions as any,
    workspaces as any,
  );

  const question = {
    id: 'q-1',
    workspaceId: 'ws-1',
    question: 'Tell me about a challenge.',
    idealAnswer: 'A good STAR answer.',
  };
  questions.findOne.mockResolvedValue(question);
  questions.findOneOrFail.mockResolvedValue({ ...question, answerScore: 80 });

  return { service, ai, complete, credits, balance, debit, questions };
}

describe('InterviewService.submitAnswer', () => {
  it('throws INSUFFICIENT_CREDITS before ever calling the AI', async () => {
    const { service, balance, complete } = build();
    balance.mockResolvedValue(0);

    await expect(
      service.submitAnswer('q-1', 'user-1', 'my answer'),
    ).rejects.toMatchObject({ code: 'INSUFFICIENT_CREDITS' });
    expect(complete).not.toHaveBeenCalled();
  });

  it('does NOT charge the user when the AI call fails', async () => {
    const { service, complete, debit } = build();
    complete.mockRejectedValue(new Error('provider down'));

    await expect(
      service.submitAnswer('q-1', 'user-1', 'my answer'),
    ).rejects.toThrow('provider down');
    expect(debit).not.toHaveBeenCalled();
  });

  it('charges exactly once, only after the AI call succeeds', async () => {
    const { service, complete, debit } = build();
    complete.mockResolvedValue({
      data: { feedback: 'Good structure, add more detail.', score: 80 },
      usage: {},
    });

    await service.submitAnswer('q-1', 'user-1', 'my answer');

    expect(debit).toHaveBeenCalledTimes(1);
    expect(debit).toHaveBeenCalledWith('user-1', 1, 'answer_feedback', 'q-1');
  });
});

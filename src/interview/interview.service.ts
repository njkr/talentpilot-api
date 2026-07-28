import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AiService } from '../ai/ai.service';
import { InterviewQuestions } from '../ai/schemas/interview-questions.schema';
import { InterviewFeedback } from '../ai/schemas/interview-feedback.schema';
import { InterviewQuestion } from './entities/interview-question.entity';
import { Workspace } from '../workspaces/entities/workspace.entity';
import { PipelineContext } from '../pipeline/steps/step.interface';
import { ChunkerService } from '../embeddings/services/chunker.service';
import { CreditService } from '../credits/credit.service';
import { PaymentConfigService } from '../payments/config/payment-config.service';
import { Problems } from '../common/problems';
import { renderJdSummary } from '../job-descriptions/utils/render-jd.util';

@Injectable()
export class InterviewService {
  constructor(
    private readonly ai: AiService,
    private readonly chunker: ChunkerService,
    private readonly credits: CreditService,
    private readonly paymentConfig: PaymentConfigService,
    @InjectRepository(InterviewQuestion)
    private readonly questions: Repository<InterviewQuestion>,
    @InjectRepository(Workspace)
    private readonly workspaces: Repository<Workspace>,
  ) {}

  async generate(ctx: PipelineContext): Promise<InterviewQuestion[]> {
    const { data: out } = await this.ai.complete<InterviewQuestions>({
      feature: 'interview_questions',
      promptKey: 'interview_questions',
      variables: {
        jd_summary: renderJdSummary(ctx.jd),
        resume_summary: this.chunker
          .chunkResume(ctx.sections)
          .map((c) => c.content)
          .join('\n\n'),
      },
      truncateVariable: 'resume_summary',
      userId: ctx.userId,
      workspaceId: ctx.workspaceId,
      runId: ctx.runId,
      stepName: 'generate_interview_qs',
    });

    if (!out.questions.length) return [];
    return this.questions.save(
      this.questions.create(
        out.questions.map((q) => ({
          workspaceId: ctx.workspaceId,
          runId: ctx.runId,
          type: q.type,
          difficulty: q.difficulty,
          question: q.question,
          idealAnswer: q.idealAnswer,
          framework: q.framework,
          whyAsked: q.whyAsked,
          basedOn: q.basedOn,
        })),
      ),
    );
  }

  async listForWorkspace(
    workspaceId: string,
    userId: string,
  ): Promise<InterviewQuestion[]> {
    await this.assertWorkspaceOwned(workspaceId, userId);
    return this.questions.find({
      where: { workspaceId },
      order: { createdAt: 'ASC' },
    });
  }

  /**
   * Practice mode: the user answers, gets AI feedback, pays per attempt.
   *
   * Balance is checked BEFORE calling the AI (no point spending real OpenAI money on
   * a request that was always going to be rejected), and the debit itself happens
   * AFTER the AI call succeeds — charging first would bill the user even when it
   * fails (budget exceeded, provider down, invalid output), with no feedback to show
   * for it and no compensating refund.
   */
  async submitAnswer(
    questionId: string,
    userId: string,
    answer: string,
  ): Promise<InterviewQuestion> {
    const q = await this.assertOwned(questionId, userId);

    const feedbackCost = (await this.paymentConfig.get()).interviewFeedbackCost;
    const balance = await this.credits.balance(userId);
    if (balance < feedbackCost) {
      throw Problems.insufficientCredits(feedbackCost, balance);
    }

    const { data: fb } = await this.ai.complete<InterviewFeedback>({
      feature: 'interview_feedback',
      promptKey: 'interview_feedback',
      variables: {
        question: q.question,
        idealAnswer: q.idealAnswer,
        userAnswer: answer,
      },
      userId,
    });

    await this.credits.debit(
      userId,
      feedbackCost,
      'answer_feedback',
      questionId,
    );

    await this.questions.update(q.id, {
      userAnswer: answer,
      aiFeedback: fb.feedback,
      answerScore: Math.max(0, Math.min(100, Math.round(fb.score))),
      answeredAt: new Date(),
    });
    return this.questions.findOneOrFail({ where: { id: q.id } });
  }

  private async assertOwned(
    questionId: string,
    userId: string,
  ): Promise<InterviewQuestion> {
    const q = await this.questions.findOne({ where: { id: questionId } });
    if (!q) throw new NotFoundException();
    await this.assertWorkspaceOwned(q.workspaceId, userId);
    return q;
  }

  private async assertWorkspaceOwned(
    workspaceId: string,
    userId: string,
  ): Promise<void> {
    const ws = await this.workspaces.findOne({
      where: { id: workspaceId, userId },
    });
    if (!ws) throw new NotFoundException();
  }
}

import { ApiProperty } from '@nestjs/swagger';
import { InterviewQuestion } from '../entities/interview-question.entity';

export class InterviewQuestionResponse {
  @ApiProperty() id: string;
  @ApiProperty() type: string;
  @ApiProperty() difficulty: string;
  @ApiProperty() question: string;
  @ApiProperty() idealAnswer: string;
  @ApiProperty({ nullable: true }) framework: string | null;
  @ApiProperty() whyAsked: string;
  @ApiProperty({ nullable: true }) basedOn: string | null;
  @ApiProperty({ nullable: true }) userAnswer: string | null;
  @ApiProperty({ nullable: true }) aiFeedback: string | null;
  @ApiProperty({ nullable: true }) answerScore: number | null;

  constructor(q: InterviewQuestion) {
    Object.assign(this, {
      id: q.id,
      type: q.type,
      difficulty: q.difficulty,
      question: q.question,
      idealAnswer: q.idealAnswer,
      framework: q.framework,
      whyAsked: q.whyAsked,
      basedOn: q.basedOn,
      userAnswer: q.userAnswer,
      aiFeedback: q.aiFeedback,
      answerScore: q.answerScore,
    });
  }
}

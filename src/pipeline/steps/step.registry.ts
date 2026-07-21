import { Injectable } from '@nestjs/common';
import { PipelineStep } from './step.interface';
import { ParseResumeStep } from './parse-resume.step';
import { ParseJdStep } from './parse-jd.step';
import { GenerateEmbeddingsStep } from './generate-embeddings.step';
import { MatchKeywordsStep } from './match-keywords.step';
import { ScoreAtsStep } from './score-ats.step';

@Injectable()
export class StepRegistry {
  private readonly steps: PipelineStep[];

  constructor(
    parseResume: ParseResumeStep,
    parseJd: ParseJdStep,
    embeddings: GenerateEmbeddingsStep,
    keywords: MatchKeywordsStep,
    ats: ScoreAtsStep,
    // Later steps get appended here — nothing else changes.
  ) {
    this.steps = [parseResume, parseJd, embeddings, keywords, ats];
    this.assertValid();
  }

  all() {
    return this.steps;
  }

  get(name: string) {
    return this.steps.find((s) => s.name === name);
  }

  /**
   * Fail at BOOT, not at runtime. A typo in dependsOn, a cycle, or weights that don't
   * sum to 100 would otherwise surface as a stuck run in production.
   */
  private assertValid() {
    const names = new Set(this.steps.map((s) => s.name));

    for (const s of this.steps) {
      for (const d of s.dependsOn) {
        if (!names.has(d)) {
          throw new Error(`Step "${s.name}" depends on unknown step "${d}"`);
        }
      }
    }

    const weight = this.steps.reduce((n, s) => n + s.progressWeight, 0);
    if (weight !== 100) {
      throw new Error(`Progress weights must sum to 100, got ${weight}`);
    }

    // Cycle detection via topological sort (Kahn's algorithm).
    const indeg = new Map(this.steps.map((s) => [s.name, s.dependsOn.length]));
    const queue = [...indeg].filter(([, n]) => n === 0).map(([k]) => k);
    let seen = 0;
    while (queue.length) {
      const cur = queue.shift()!;
      seen++;
      for (const s of this.steps) {
        if (s.dependsOn.includes(cur)) {
          const n = indeg.get(s.name)! - 1;
          indeg.set(s.name, n);
          if (n === 0) queue.push(s.name);
        }
      }
    }
    if (seen !== this.steps.length) {
      throw new Error('Cycle detected in pipeline step graph');
    }
  }
}

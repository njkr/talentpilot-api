// Runs the real resume_extraction prompt against every fixture in eval/resumes/ and
// scores the output against each fixture's expected.json. Not a unit test (it makes
// real, billed OpenAI calls) — a standalone check for "did the last prompt/schema
// change make extraction quality better or worse," run by hand when touching the
// prompt, not in CI.
//
// Run: npx ts-node -r tsconfig-paths/register scripts/eval-parser.ts
import 'dotenv/config';
import { readFileSync, readdirSync } from 'fs';
import { join } from 'path';
import dataSource from '../src/database/data-source';
import { PromptTemplate } from '../src/prompts/entities/prompt-template.entity';
import { TokenUsage } from '../src/ai/entities/token-usage.entity';
import { PromptsService } from '../src/prompts/prompts.service';
import { PricingService } from '../src/ai/services/pricing.service';
import { TokenCounterService } from '../src/ai/services/token-counter.service';
import { BudgetService } from '../src/ai/services/budget.service';
import { AiService } from '../src/ai/ai.service';
import { validateEnv } from '../src/config/env.schema';
import type { Env } from '../src/config/config.module';
import type { ResumeExtraction } from '../src/ai/schemas/resume-extraction.schema';

interface ExpectedSpec {
  personalInfo?: Partial<Record<'fullName' | 'email' | 'phone' | 'location', string>>;
  skillsInclude?: string[];
  minExperienceEntries?: number;
  minEducationEntries?: number;
  minCertificationEntries?: number;
  maxCertificationEntries?: number;
  minLanguageEntries?: number;
  maxLanguageEntries?: number;
  firstJobIsCurrent?: boolean;
}

interface CheckResult {
  name: string;
  pass: boolean;
  detail?: string;
}

const norm = (s: string | null | undefined) => (s ?? '').trim().toLowerCase();

function scoreFixture(expected: ExpectedSpec, actual: ResumeExtraction): CheckResult[] {
  const checks: CheckResult[] = [];

  if (expected.personalInfo) {
    for (const [key, value] of Object.entries(expected.personalInfo)) {
      const actualValue = (actual.personalInfo as Record<string, unknown>)[key];
      checks.push({
        name: `personalInfo.${key}`,
        pass: norm(actualValue as string) === norm(value),
        detail: `expected "${value}", got "${actualValue}"`,
      });
    }
  }

  if (expected.skillsInclude) {
    const actualSkills = actual.skills.map(norm);
    for (const skill of expected.skillsInclude) {
      checks.push({
        name: `skills includes "${skill}"`,
        pass: actualSkills.includes(norm(skill)),
      });
    }
  }

  const lengthCheck = (
    name: string,
    actualLength: number,
    min?: number,
    max?: number,
  ) => {
    if (min != null) {
      checks.push({
        name: `${name} >= ${min}`,
        pass: actualLength >= min,
        detail: `got ${actualLength}`,
      });
    }
    if (max != null) {
      checks.push({
        name: `${name} <= ${max}`,
        pass: actualLength <= max,
        detail: `got ${actualLength}`,
      });
    }
  };

  lengthCheck('experience.length', actual.experience.length, expected.minExperienceEntries);
  lengthCheck('education.length', actual.education.length, expected.minEducationEntries);
  lengthCheck(
    'certifications.length',
    actual.certifications.length,
    expected.minCertificationEntries,
    expected.maxCertificationEntries,
  );
  lengthCheck(
    'languages.length',
    actual.languages.length,
    expected.minLanguageEntries,
    expected.maxLanguageEntries,
  );

  if (expected.firstJobIsCurrent != null) {
    checks.push({
      name: 'experience[0].isCurrent',
      pass: actual.experience[0]?.isCurrent === expected.firstJobIsCurrent,
      detail: `got ${actual.experience[0]?.isCurrent}`,
    });
  }

  return checks;
}

async function main() {
  const parsed = validateEnv(process.env);
  const fakeEnv = { get: (k: keyof typeof parsed) => parsed[k] } as Env;

  await dataSource.initialize();
  try {
    const prompts = new PromptsService(dataSource.getRepository(PromptTemplate), dataSource);
    const pricing = new PricingService();
    const budget = new BudgetService(dataSource.getRepository(TokenUsage), fakeEnv);
    const ai = new AiService(fakeEnv, prompts, pricing, budget, new TokenCounterService());
    await ai.onModuleInit();

    const fixturesDir = join(__dirname, '..', 'eval', 'resumes');
    const fixtureNames = readdirSync(fixturesDir, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => d.name)
      .sort();

    if (fixtureNames.length === 0) {
      console.error(`No fixtures found under ${fixturesDir}`);
      process.exit(1);
    }

    let totalChecks = 0;
    let passedChecks = 0;
    let totalCostUsd = 0;
    let anyFixtureFailed = false;

    for (const name of fixtureNames) {
      const dir = join(fixturesDir, name);
      const resumeText = readFileSync(join(dir, 'input.txt'), 'utf-8');
      const expected: ExpectedSpec = JSON.parse(
        readFileSync(join(dir, 'expected.json'), 'utf-8'),
      );

      const { data, usage } = await ai.complete<ResumeExtraction>({
        feature: 'resume_extraction',
        promptKey: 'resume_extraction',
        variables: { resume_text: resumeText },
        stepName: `eval:${name}`, // runId is a uuid column — fixture names aren't, so this is the only place a fixture name can travel
      });

      const checks = scoreFixture(expected, data);
      const passed = checks.filter((c) => c.pass).length;
      const fixtureFailed = passed < checks.length;
      anyFixtureFailed ||= fixtureFailed;
      totalChecks += checks.length;
      passedChecks += passed;
      totalCostUsd += Number(usage.costUsd);

      console.log(
        `\n${fixtureFailed ? '✗' : '✓'} ${name} — ${passed}/${checks.length} checks, ` +
          `$${usage.costUsd}, ${usage.durationMs}ms, ${usage.attempts} attempt(s)`,
      );
      for (const check of checks) {
        if (!check.pass) {
          console.log(`    ✗ ${check.name}${check.detail ? ` (${check.detail})` : ''}`);
        }
      }
    }

    console.log(
      `\n${'='.repeat(60)}\n` +
        `${passedChecks}/${totalChecks} checks passed across ${fixtureNames.length} fixture(s). ` +
        `Total cost: $${totalCostUsd.toFixed(6)}\n${'='.repeat(60)}`,
    );

    process.exit(anyFixtureFailed ? 1 : 0);
  } finally {
    await dataSource.destroy();
  }
}

main().catch((err) => {
  console.error('EVAL FAILED:', err);
  process.exit(1);
});

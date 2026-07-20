// Standalone script, not a Nest bootstrap — same reasoning as the migration CLI in
// data-source.ts: seeding one table doesn't need Redis/S3/the HTTP server up, and
// PromptsService's only two dependencies (a Repository and the DataSource) are cheap to
// construct by hand.
// Run: npx ts-node -r tsconfig-paths/register scripts/seed-prompts.ts
import 'dotenv/config';
import dataSource from '../src/database/data-source';
import { PromptTemplate } from '../src/prompts/entities/prompt-template.entity';
import { PromptsService } from '../src/prompts/prompts.service';

const RESUME_EXTRACTION_SYSTEM = `You are a precise resume-parsing engine. Extract structured data from the resume text the user provides.

Rules:
- Extract ONLY information that is actually present in the text. Never invent, guess, or infer missing details.
- If a field is not present, use null (for scalar fields) or an empty array (for list fields) — never omit it.
- Preserve dates exactly as written in the source (e.g. "Jan 2020", "2020", "Summer 2019"). Do not reformat or normalize them.
- Set isCurrent to true only if the entry's end date is explicitly "Present", "Current", or absent while clearly ongoing.
- For each top-level section, report your own confidence from 0.0 to 1.0 that your extraction for that section is complete and correct. Use lower confidence when the source text for that section is sparse, ambiguous, or malformed.
- Skills should be individual short strings (e.g. "TypeScript", not "TypeScript, React, Node").
- Do not summarize or embellish — extract, don't rewrite.`;

const RESUME_EXTRACTION_USER = `Resume text:
"""
{{resume_text}}
"""`;

async function main() {
  await dataSource.initialize();
  try {
    const service = new PromptsService(
      dataSource.getRepository(PromptTemplate),
      dataSource,
    );

    const existing = await dataSource
      .getRepository(PromptTemplate)
      .findOne({ where: { key: 'resume_extraction', isActive: true } });
    if (existing) {
      console.log(
        `resume_extraction already has an active version (v${existing.version}) — skipping seed.`,
      );
      return;
    }

    const template = await service.createVersion({
      key: 'resume_extraction',
      model: 'gpt-4o-mini',
      temperature: 0.1,
      maxTokens: 4096,
      systemTemplate: RESUME_EXTRACTION_SYSTEM,
      userTemplate: RESUME_EXTRACTION_USER,
      variables: ['resume_text'],
      schemaKey: 'resume_extraction',
      changeNote: 'Initial version — Sprint 3',
    });
    await service.activate(template.key, template.version);
    console.log(`Seeded and activated resume_extraction v${template.version}.`);
  } finally {
    await dataSource.destroy();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

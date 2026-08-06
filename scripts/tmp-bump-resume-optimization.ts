// One-off: seedOne() in seed-prompts.ts skips creation when an active version already
// exists, so editing RESUME_OPTIMIZATION there and re-running seed-prompts does nothing
// on a dev DB that's already seeded. This pushes the bumped (12 → 20 suggestions) system
// template as a new version and activates it directly.
// Run: npx ts-node -r tsconfig-paths/register scripts/tmp-bump-resume-optimization.ts
import 'dotenv/config';
import dataSource from '../src/database/data-source';
import { PromptTemplate } from '../src/prompts/entities/prompt-template.entity';
import { PromptsService } from '../src/prompts/prompts.service';

async function main() {
  await dataSource.initialize();
  try {
    const repo = dataSource.getRepository(PromptTemplate);
    const service = new PromptsService(repo, dataSource);
    const current = await repo.findOne({
      where: { key: 'resume_optimization', isActive: true },
    });
    if (!current) {
      throw new Error('No active resume_optimization version found to base the bump on.');
    }

    const newSystemTemplate = current.systemTemplate.replace(
      'Suggest at most 12 changes, ordered by impact. A candidate will not review 40.',
      'Suggest at most 20 changes, ordered by impact. A candidate will not review 40.',
    );
    if (newSystemTemplate === current.systemTemplate) {
      throw new Error(
        'Expected text "Suggest at most 12 changes..." not found in the active template — ' +
          'it may have already been bumped, or the wording has since changed.',
      );
    }

    const template = await service.createVersion({
      key: current.key,
      model: current.model,
      temperature: Number(current.temperature),
      maxTokens: 6144,
      systemTemplate: newSystemTemplate,
      userTemplate: current.userTemplate,
      variables: current.variables,
      schemaKey: current.schemaKey,
      changeNote:
        'v2: raised the suggestion cap from 12 to 20 (and maxTokens 4096 → 6144 to fit ' +
        'them) — users asked for more coverage per analysis, and the fabrication guard now ' +
        'converts an unverifiable suggestion into a needs_info row instead of silently ' +
        'dropping it, so a higher ceiling no longer means more silently-vanishing output.',
    });
    await service.activate(template.key, template.version);
    console.log(`Activated ${template.key} v${template.version}.`);
  } finally {
    await dataSource.destroy();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

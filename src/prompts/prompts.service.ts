import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { PromptTemplate } from './entities/prompt-template.entity';
import { Problems } from '../common/problems';

export interface RenderedPrompt {
  system: string;
  user: string;
}

const VAR_PATTERN = /\{\{(\w+)\}\}/g;

@Injectable()
export class PromptsService {
  constructor(
    @InjectRepository(PromptTemplate)
    private readonly repo: Repository<PromptTemplate>,
    private readonly dataSource: DataSource,
  ) {}

  async getActive(key: string): Promise<PromptTemplate> {
    const template = await this.repo.findOne({
      where: { key, isActive: true },
    });
    if (!template) throw Problems.promptNotFound(key);
    return template;
  }

  /**
   * Substitutes `{{var}}` placeholders. Checks the template's declared `variables`
   * against what's supplied BEFORE substituting, and checks every placeholder actually
   * found in the text against what's supplied DURING substitution — together these turn
   * a typo'd variable name (in either the caller or the seeded template) into a thrown
   * error instead of a literal "{{resume_txt}}" silently sent to the model.
   */
  render(
    template: PromptTemplate,
    vars: Record<string, string>,
  ): RenderedPrompt {
    for (const name of template.variables) {
      if (!(name in vars)) {
        throw new Error(
          `Prompt "${template.key}" v${template.version} expects variable "${name}" but it was not supplied`,
        );
      }
    }

    const substitute = (text: string) =>
      text.replace(VAR_PATTERN, (_match, name: string) => {
        if (!(name in vars)) {
          throw new Error(
            `Prompt "${template.key}" v${template.version} references undeclared variable "{{${name}}}"`,
          );
        }
        return vars[name];
      });

    return {
      system: substitute(template.systemTemplate),
      user: substitute(template.userTemplate),
    };
  }

  listVersions(key: string): Promise<PromptTemplate[]> {
    return this.repo.find({ where: { key }, order: { version: 'DESC' } });
  }

  /** Inserts the next version for `key` (1 if none exist yet). Never active on creation. */
  async createVersion(input: {
    key: string;
    model: string;
    temperature: number;
    maxTokens: number;
    systemTemplate: string;
    userTemplate: string;
    variables: string[];
    schemaKey: string;
    changeNote?: string;
  }): Promise<PromptTemplate> {
    const { maxVersion } = (await this.repo
      .createQueryBuilder('t')
      .select('MAX(t.version)', 'maxVersion')
      .where('t.key = :key', { key: input.key })
      .getRawOne()) ?? { maxVersion: 0 };

    const template = this.repo.create({
      key: input.key,
      version: Number(maxVersion ?? 0) + 1,
      model: input.model,
      temperature: input.temperature.toFixed(2),
      maxTokens: input.maxTokens,
      systemTemplate: input.systemTemplate,
      userTemplate: input.userTemplate,
      variables: input.variables,
      schemaKey: input.schemaKey,
      changeNote: input.changeNote ?? null,
      isActive: false,
    });
    return this.repo.save(template);
  }

  /**
   * Flips exactly one version active for `key`. Deactivate-then-activate in the same
   * transaction so the partial unique index (`one_active_version_per_key`) never sees
   * two active rows at once — order matters here, not just atomicity.
   */
  async activate(key: string, version: number): Promise<void> {
    await this.dataSource.transaction(async (m) => {
      await m.update(
        PromptTemplate,
        { key, isActive: true },
        { isActive: false },
      );
      const result = await m.update(
        PromptTemplate,
        { key, version },
        { isActive: true },
      );
      if (!result.affected) {
        throw new Error(`No prompt template "${key}" version ${version}`);
      }
    });
  }
}

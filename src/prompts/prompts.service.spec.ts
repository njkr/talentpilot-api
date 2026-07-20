import { PromptsService } from './prompts.service';
import { PromptTemplate } from './entities/prompt-template.entity';

describe('PromptsService', () => {
  let findOne: jest.Mock;
  let update: jest.Mock;
  let repo: any;
  let dataSource: any;
  let service: PromptsService;

  beforeEach(() => {
    findOne = jest.fn();
    update = jest.fn().mockResolvedValue({ affected: 1 });
    repo = { findOne, createQueryBuilder: jest.fn() };
    dataSource = {
      transaction: jest.fn((cb: any) => cb({ update })),
    };
    service = new PromptsService(repo, dataSource);
  });

  describe('getActive', () => {
    it('returns the active template for a key', async () => {
      const template = {
        key: 'resume_extraction',
        version: 1,
      } as PromptTemplate;
      findOne.mockResolvedValueOnce(template);
      await expect(service.getActive('resume_extraction')).resolves.toBe(
        template,
      );
      expect(findOne).toHaveBeenCalledWith({
        where: { key: 'resume_extraction', isActive: true },
      });
    });

    it('throws a NOT_FOUND-style AppException when there is no active version', async () => {
      findOne.mockResolvedValueOnce(null);
      await expect(service.getActive('missing_key')).rejects.toMatchObject({
        code: 'NOT_FOUND',
      });
    });
  });

  describe('render', () => {
    const template = {
      key: 'resume_extraction',
      version: 1,
      variables: ['resume_text'],
      systemTemplate: 'Extract from: {{resume_text}}',
      userTemplate: 'Text: {{resume_text}}',
    } as PromptTemplate;

    it('substitutes declared variables', () => {
      const result = service.render(template, { resume_text: 'Jane Doe' });
      expect(result).toEqual({
        system: 'Extract from: Jane Doe',
        user: 'Text: Jane Doe',
      });
    });

    it('throws if a declared variable is not supplied', () => {
      expect(() => service.render(template, {})).toThrow(
        /expects variable "resume_text"/,
      );
    });

    it('throws if the template text references a variable not supplied (typo protection)', () => {
      const typoTemplate = {
        ...template,
        variables: ['resume_text'],
        systemTemplate: 'Extract from: {{resume_txt}}', // typo'd placeholder
      } as PromptTemplate;
      expect(() =>
        service.render(typoTemplate, { resume_text: 'Jane Doe' }),
      ).toThrow(/undeclared variable "\{\{resume_txt\}\}"/);
    });
  });

  describe('activate', () => {
    it('deactivates the current active version before activating the target, in one transaction', async () => {
      await service.activate('resume_extraction', 2);
      expect(dataSource.transaction).toHaveBeenCalledTimes(1);
      expect(update).toHaveBeenNthCalledWith(
        1,
        PromptTemplate,
        { key: 'resume_extraction', isActive: true },
        { isActive: false },
      );
      expect(update).toHaveBeenNthCalledWith(
        2,
        PromptTemplate,
        { key: 'resume_extraction', version: 2 },
        { isActive: true },
      );
    });

    it('throws if the target version does not exist', async () => {
      update
        .mockResolvedValueOnce({ affected: 0 })
        .mockResolvedValueOnce({ affected: 0 });
      await expect(service.activate('resume_extraction', 99)).rejects.toThrow(
        /No prompt template "resume_extraction" version 99/,
      );
    });
  });
});

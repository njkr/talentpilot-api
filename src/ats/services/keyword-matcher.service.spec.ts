import { KeywordMatcherService } from './keyword-matcher.service';
import { ResumeSection } from '../../resumes/entities/resume-section.entity';
import { JobDescription } from '../../job-descriptions/entities/job-description.entity';

function jdWithSkills(names: string[]): JobDescription {
  return {
    id: 'jd-1',
    parsedData: {
      skills: names.map((name) => ({
        name,
        category: 'language',
        importance: 'required',
      })),
    },
  } as unknown as JobDescription;
}

function sectionsWithSkills(items: string[]): ResumeSection[] {
  return [
    {
      sectionType: 'skills',
      content: items,
    } as ResumeSection,
  ];
}

describe('KeywordMatcherService', () => {
  it('matches known aliases deterministically with no AI call', async () => {
    const complete = jest.fn();
    const matcher = new KeywordMatcherService({ complete } as any);

    const jd = jdWithSkills(['Kubernetes', 'PostgreSQL']);
    const sections = sectionsWithSkills(['k8s', 'postgres']);

    const out = await matcher.match(
      jd,
      sections,
      'irrelevant resume text',
      'user-1',
    );

    expect(out.every((m) => m.status === 'matched')).toBe(true);
    expect(out.every((m) => m.source === 'exact')).toBe(true);
    expect(complete).not.toHaveBeenCalled();
  });

  it('does not match "Java" in a resume against a "JavaScript" requirement', async () => {
    const complete = jest.fn().mockResolvedValue({
      data: {
        matches: [
          {
            keyword: 'JavaScript',
            status: 'missing',
            evidence: null,
            reasoning: 'no evidence',
          },
        ],
      },
    });
    const matcher = new KeywordMatcherService({ complete } as any);

    const jd = jdWithSkills(['JavaScript']);
    const sections: ResumeSection[] = [
      {
        sectionType: 'experience',
        content: [
          {
            company: 'Acme',
            title: 'Dev',
            highlights: ['Wrote Java backend services'],
          },
        ],
      } as unknown as ResumeSection,
    ];

    const out = await matcher.match(jd, sections, 'Java developer', 'user-1');
    // "java" must not satisfy "javascript" via the deterministic pass — falls through to AI
    expect(complete).toHaveBeenCalledTimes(1);
    expect(out[0].status).toBe('missing');
  });

  it('falls back to the AI pass only for skills the deterministic pass could not resolve', async () => {
    const complete = jest.fn().mockResolvedValue({
      data: {
        matches: [
          {
            keyword: 'GraphQL',
            status: 'matched',
            evidence: 'Built a GraphQL API',
            reasoning: 'explicit',
          },
        ],
      },
    });
    const matcher = new KeywordMatcherService({ complete } as any);

    const jd = jdWithSkills(['TypeScript', 'GraphQL']);
    const sections = sectionsWithSkills(['TypeScript']); // GraphQL not present verbatim

    const out = await matcher.match(jd, sections, 'resume text', 'user-1');

    expect(complete).toHaveBeenCalledTimes(1);
    const [callArgs] = complete.mock.calls[0];
    expect(callArgs.variables.keywords).toContain('GraphQL');
    expect(callArgs.variables.keywords).not.toContain('TypeScript');

    const ts = out.find((m) => m.keyword === 'TypeScript')!;
    const gql = out.find((m) => m.keyword === 'GraphQL')!;
    expect(ts.status).toBe('matched');
    expect(ts.source).toBe('exact');
    expect(gql.status).toBe('matched');
    expect(gql.source).toBe('ai');
  });
});

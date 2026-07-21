import { ChunkerService } from './chunker.service';
import { TokenCounterService } from '../../ai/services/token-counter.service';
import { ResumeSection } from '../../resumes/entities/resume-section.entity';
import { JobDescription } from '../../job-descriptions/entities/job-description.entity';

function section(overrides: Partial<ResumeSection>): ResumeSection {
  return {
    id: 'id',
    resumeId: 'resume-1',
    version: 1,
    orderIndex: 0,
    confidence: '1.00',
    aiGenerated: true,
    editedByUser: false,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  } as ResumeSection;
}

describe('ChunkerService', () => {
  const chunker = new ChunkerService(new TokenCounterService());

  it('renders experience using the actual Sprint 3 field names (highlights, isCurrent)', () => {
    const sections = [
      section({
        sectionType: 'experience',
        orderIndex: 0,
        content: [
          {
            company: 'Acme',
            title: 'Engineer',
            location: 'Remote',
            startDate: 'Jan 2022',
            endDate: null,
            isCurrent: true,
            highlights: ['Shipped a thing', 'Fixed a bug'],
          },
        ],
      }),
    ];

    const chunks = chunker.chunkResume(sections);
    expect(chunks).toHaveLength(1);
    expect(chunks[0].content).toContain('Engineer at Acme');
    expect(chunks[0].content).toContain('present'); // isCurrent -> 'present'
    expect(chunks[0].content).toContain('Shipped a thing');
    expect(chunks[0].metadata.sectionType).toBe('experience');
  });

  it('renders skills as a flat comma-separated line, not grouped by category', () => {
    const sections = [
      section({ sectionType: 'skills', content: ['Go', 'TypeScript', 'AWS'] }),
    ];
    const chunks = chunker.chunkResume(sections);
    expect(chunks).toHaveLength(1);
    expect(chunks[0].content).toBe('Skills: Go, TypeScript, AWS');
  });

  it('renders projects without a bullets field (technologies only)', () => {
    const sections = [
      section({
        sectionType: 'projects',
        content: [
          {
            name: 'Widget',
            description: 'A widget.',
            url: null,
            technologies: ['React', 'Node'],
          },
        ],
      }),
    ];
    const chunks = chunker.chunkResume(sections);
    expect(chunks[0].content).toContain('Project: Widget');
    expect(chunks[0].content).toContain('Technologies: React, Node');
  });

  it('skips personal_info and languages sections entirely (not embedded)', () => {
    const sections = [
      section({
        sectionType: 'personal_info',
        content: {
          fullName: 'Jane',
          email: 'j@x.com',
          phone: null,
          location: null,
          links: [],
        },
      }),
      section({
        sectionType: 'languages',
        content: [{ name: 'English', proficiency: 'native' }],
      }),
    ];
    expect(chunker.chunkResume(sections)).toHaveLength(0);
  });

  it('skips empty skills/summary/certifications instead of emitting a blank chunk', () => {
    const sections = [
      section({ sectionType: 'skills', content: [] }),
      section({ sectionType: 'summary', content: { text: null } }),
      section({ sectionType: 'certifications', content: [] }),
    ];
    expect(chunker.chunkResume(sections)).toHaveLength(0);
  });

  it('chunks a JD one-per-requirement, not per paragraph', () => {
    const jd = {
      id: 'jd-1',
      parsedData: {
        requirements: [
          {
            text: '5+ years of Go experience',
            category: 'technical',
            importance: 'required',
          },
          {
            text: 'Bachelor degree',
            category: 'education',
            importance: 'preferred',
          },
        ],
      },
    } as unknown as JobDescription;

    const chunks = chunker.chunkJd(jd);
    expect(chunks).toHaveLength(2);
    expect(chunks[0].content).toBe('5+ years of Go experience');
    expect(chunks[0].metadata.label).toBe('required');
  });

  it('throws chunking a JD that has not been analyzed yet', () => {
    const jd = { id: 'jd-1', parsedData: null } as unknown as JobDescription;
    expect(() => chunker.chunkJd(jd)).toThrow(/has not been analyzed/);
  });
});

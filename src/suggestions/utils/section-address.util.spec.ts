import {
  findSection,
  readSuggestionTarget,
  writeSuggestionTarget,
  renderSectionsWithIndices,
} from './section-address.util';

function section(sectionType: string, content: unknown) {
  return { sectionType, content } as any;
}

describe('section-address.util', () => {
  describe('summary', () => {
    it('reads and writes the whole text', () => {
      const s = section('summary', { text: 'Old summary' });
      expect(readSuggestionTarget('summary', s.content, null, null)).toBe(
        'Old summary',
      );
      expect(
        writeSuggestionTarget('summary', s.content, null, null, 'New summary'),
      ).toBe(true);
      expect(s.content.text).toBe('New summary');
    });
  });

  describe('skills', () => {
    it('reads and writes a single skill by index', () => {
      const s = section('skills', ['TypeScript', 'React']);
      expect(readSuggestionTarget('skills', s.content, 1, null)).toBe('React');
      expect(writeSuggestionTarget('skills', s.content, 1, null, 'Vue')).toBe(
        true,
      );
      expect(s.content).toEqual(['TypeScript', 'Vue']);
    });

    it('returns null for an out-of-range index', () => {
      const s = section('skills', ['TypeScript']);
      expect(readSuggestionTarget('skills', s.content, 5, null)).toBeNull();
    });
  });

  describe('experience', () => {
    it('reads and writes a specific highlight', () => {
      const s = section('experience', [
        { company: 'Acme', title: 'Eng', highlights: ['Bullet 1', 'Bullet 2'] },
      ]);
      expect(readSuggestionTarget('experience', s.content, 0, 1)).toBe(
        'Bullet 2',
      );
      expect(
        writeSuggestionTarget('experience', s.content, 0, 1, 'New bullet 2'),
      ).toBe(true);
      expect(s.content[0].highlights).toEqual(['Bullet 1', 'New bullet 2']);
    });

    it('refuses a null bulletIndex — experience has no single whole-item text field', () => {
      const s = section('experience', [
        { company: 'Acme', title: 'Eng', highlights: ['Bullet 1'] },
      ]);
      expect(readSuggestionTarget('experience', s.content, 0, null)).toBeNull();
    });
  });

  describe('projects', () => {
    it('reads and writes the whole description', () => {
      const s = section('projects', [
        { name: 'Side project', description: 'Old description' },
      ]);
      expect(readSuggestionTarget('projects', s.content, 0, null)).toBe(
        'Old description',
      );
      expect(
        writeSuggestionTarget(
          'projects',
          s.content,
          0,
          null,
          'New description',
        ),
      ).toBe(true);
      expect(s.content[0].description).toBe('New description');
    });

    it('refuses a non-null bulletIndex — projects have no bullet list', () => {
      const s = section('projects', [{ name: 'P', description: 'D' }]);
      expect(readSuggestionTarget('projects', s.content, 0, 0)).toBeNull();
    });
  });

  describe('findSection / renderSectionsWithIndices', () => {
    it('finds a section by type', () => {
      const sections = [
        section('summary', { text: 'x' }),
        section('skills', []),
      ];
      expect(findSection(sections, 'skills')).toBe(sections[1]);
      expect(findSection(sections, 'projects')).toBeUndefined();
    });

    it('renders index markers the model can reference back exactly', () => {
      const sections = [
        section('summary', { text: 'A short summary' }),
        section('skills', ['TypeScript', 'React']),
        section('experience', [
          { company: 'Acme', title: 'Engineer', highlights: ['Did a thing'] },
        ]),
      ];
      const rendered = renderSectionsWithIndices(sections);
      expect(rendered).toContain('[summary] "A short summary"');
      expect(rendered).toContain('[skills:0] "TypeScript"');
      expect(rendered).toContain('[skills:1] "React"');
      expect(rendered).toContain('[experience:0:0] "Did a thing"');
    });
  });
});

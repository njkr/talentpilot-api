import { canonicalise } from './skill-aliases';

describe('canonicalise', () => {
  it('does not destroy C++ or .NET', () => {
    expect(canonicalise('C++')).toBe('c++');
    expect(canonicalise('.NET')).toBe('c#'); // via the alias table
  });

  it('resolves common abbreviations to their canonical form', () => {
    expect(canonicalise('K8s')).toBe('kubernetes');
    expect(canonicalise('  React.JS ')).toBe('react');
    expect(canonicalise('node')).toBe('node.js');
    expect(canonicalise('postgres')).toBe('postgresql');
  });

  it('passes through unknown terms lowercased and trimmed', () => {
    expect(canonicalise('  Some Random Skill  ')).toBe('some random skill');
  });
});

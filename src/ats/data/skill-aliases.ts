/**
 * Deterministic normalization BEFORE any AI call. Roughly 70% of real-world keyword
 * matching is solved by this table, at zero cost and zero latency, with perfectly
 * reproducible results. Only what's left goes to the model.
 *
 * Canonical form → every variant seen in the wild.
 */
export const SKILL_ALIASES: Record<string, string[]> = {
  javascript: ['js', 'ecmascript', 'es6', 'es2015', 'vanilla js'],
  typescript: ['ts'],
  react: ['react.js', 'reactjs', 'react js'],
  'node.js': ['node', 'nodejs', 'node js'],
  postgresql: ['postgres', 'psql', 'postgre sql'],
  kubernetes: ['k8s', 'kube'],
  'amazon web services': ['aws'],
  'google cloud platform': ['gcp', 'google cloud'],
  'ci/cd': [
    'cicd',
    'continuous integration',
    'continuous deployment',
    'continuous delivery',
  ],
  'rest api': ['rest', 'restful', 'restful api', 'rest apis'],
  'machine learning': ['ml'],
  'natural language processing': ['nlp'],
  'object oriented programming': ['oop', 'object-oriented'],
  'test driven development': ['tdd'],
  'c#': ['csharp', 'c sharp', '.net'],
  'c++': ['cpp', 'cplusplus'],
  // ...grow this from real misses. Every alias added here is an AI call stopped paying for.
};

const REVERSE = new Map<string, string>();
for (const [canon, aliases] of Object.entries(SKILL_ALIASES)) {
  REVERSE.set(canon, canon);
  for (const a of aliases) REVERSE.set(a, canon);
}

/**
 * Careful: strip punctuation but PRESERVE the chars that ARE the name. Naive \W+
 * stripping turns "C++" into "c" and ".NET" into "net" — then C++ matches every resume
 * containing the letter C. This bug is easy to ship and hard to spot.
 */
export function canonicalise(term: string): string {
  const t = term
    .toLowerCase()
    .trim()
    .replace(/[®™]/g, '')
    .replace(/\s+/g, ' ')
    .replace(/[^\w\s+#./-]/g, '');
  return REVERSE.get(t) ?? t;
}

import { StepRegistry } from './step.registry';

function step(name: string, dependsOn: string[], progressWeight: number) {
  return { name, dependsOn, progressWeight, creditWeight: 1 } as any;
}

// StepRegistry's constructor takes exactly 12 positional step args (one per real
// pipeline step, Sprints 5-8) and builds `this.steps` from all 12 positionally — so
// every test must supply exactly 12, even when only testing a handful of them. Padding
// with zero-weight, dependency-free filler steps keeps the "weights sum to 100" and
// "no cycle" assertions unaffected by steps the test doesn't care about.
function pad(steps: any[]): any[] {
  const filler = Array.from({ length: 12 - steps.length }, (_, i) =>
    step(`filler-${i}`, [], 0),
  );
  return [...steps, ...filler];
}

function make(steps: any[]) {
  return new (StepRegistry as any)(...pad(steps));
}

function build(steps: any[]) {
  return () => make(steps);
}

describe('StepRegistry (boot-time validation)', () => {
  it('constructs successfully with a valid DAG whose weights sum to 100', () => {
    const registry = make([
      step('a', [], 20),
      step('b', [], 20),
      step('c', ['a', 'b'], 20),
      step('d', ['c'], 20),
      step('e', ['d'], 20),
    ]);
    expect(
      registry
        .all()
        .map((s: any) => s.name)
        .slice(0, 5),
    ).toEqual(['a', 'b', 'c', 'd', 'e']);
  });

  it('throws if a step depends on a name that does not exist', () => {
    expect(
      build([
        step('a', [], 20),
        step('b', ['nonexistent'], 20),
        step('c', [], 20),
        step('d', [], 20),
        step('e', [], 20),
      ]),
    ).toThrow(/depends on unknown step "nonexistent"/);
  });

  it('throws if progress weights do not sum to 100', () => {
    expect(
      build([
        step('a', [], 10),
        step('b', [], 10),
        step('c', [], 10),
        step('d', [], 10),
        step('e', [], 10),
      ]),
    ).toThrow(/Progress weights must sum to 100, got 50/);
  });

  it('throws on a cycle in the dependency graph', () => {
    expect(
      build([
        step('a', ['e'], 20),
        step('b', ['a'], 20),
        step('c', ['b'], 20),
        step('d', ['c'], 20),
        step('e', ['d'], 20),
      ]),
    ).toThrow(/Cycle detected/);
  });

  it('get() looks a step up by name', () => {
    const registry = make([
      step('a', [], 20),
      step('b', [], 20),
      step('c', [], 20),
      step('d', [], 20),
      step('e', [], 20),
    ]);
    expect(registry.get('c')?.name).toBe('c');
    expect(registry.get('missing')).toBeUndefined();
  });
});

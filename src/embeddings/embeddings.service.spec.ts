import { EmbeddingsService } from './embeddings.service';
import { Chunk } from './services/chunker.service';

describe('EmbeddingsService', () => {
  const chunks: Chunk[] = [
    {
      index: 0,
      content: 'Senior Engineer at Acme',
      tokenCount: 5,
      metadata: {},
    },
    {
      index: 1,
      content: 'Skills: Go, TypeScript',
      tokenCount: 4,
      metadata: {},
    },
  ];

  function build(existingHashes: Map<number, string>) {
    const find = jest.fn().mockResolvedValue(
      [...existingHashes.entries()].map(([chunkIndex, contentHash]) => ({
        chunkIndex,
        contentHash,
      })),
    );
    const repo = { find, delete: jest.fn() } as any;
    const embed = jest.fn().mockResolvedValue({
      vectors: chunks.map(() => Array(1536).fill(0)),
      usage: { promptTokens: 10, costUsd: '0.000001', durationMs: 5 },
    });
    const ai = { embed } as any;
    const query = jest.fn().mockResolvedValue(undefined);
    const dataSource = {
      transaction: jest.fn((cb: any) => cb({ query })),
      query,
    } as any;
    const service = new EmbeddingsService(repo, ai, dataSource);
    return { service, embed, query };
  }

  it('embeds every chunk on the first call (no existing rows)', async () => {
    const { service, embed } = build(new Map());
    const result = await service.embedOwner(
      'resume',
      'r-1',
      1,
      chunks,
      'user-1',
    );
    expect(result).toEqual({ embedded: 2, reused: 0 });
    expect(embed).toHaveBeenCalledTimes(1); // one batch for both chunks
  });

  it('re-running with unchanged content makes ZERO embedding API calls', async () => {
    const { createHash } = await import('crypto');
    const hashes = new Map(
      chunks.map((c) => [
        c.index,
        createHash('sha256').update(c.content).digest('hex'),
      ]),
    );
    const { service, embed } = build(hashes);

    const result = await service.embedOwner(
      'resume',
      'r-1',
      1,
      chunks,
      'user-1',
    );

    expect(result).toEqual({ embedded: 0, reused: 2 });
    expect(embed).not.toHaveBeenCalled();
  });

  it('only re-embeds the chunk whose content actually changed', async () => {
    const { createHash } = await import('crypto');
    const hashes = new Map([
      [0, createHash('sha256').update(chunks[0].content).digest('hex')],
      [1, 'stale-hash-does-not-match'],
    ]);
    const { service, embed } = build(hashes);

    const result = await service.embedOwner(
      'resume',
      'r-1',
      1,
      chunks,
      'user-1',
    );

    expect(result).toEqual({ embedded: 1, reused: 1 });
    expect(embed).toHaveBeenCalledTimes(1);
    expect(embed.mock.calls[0][0]).toEqual([chunks[1].content]);
  });

  it('matchRequirements runs ONE query via the lateral join, not one per requirement', async () => {
    const query = jest.fn().mockResolvedValue([]);
    const dataSource = { query } as any;
    const service = new EmbeddingsService({} as any, {} as any, dataSource);

    await service.matchRequirements('resume-1', 1, 'jd-1');

    expect(query).toHaveBeenCalledTimes(1);
    expect(query.mock.calls[0][0]).toContain('LATERAL');
  });
});

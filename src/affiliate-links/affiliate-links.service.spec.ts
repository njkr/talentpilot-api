import { NotFoundException } from '@nestjs/common';
import { AffiliateLinksService } from './affiliate-links.service';

function makeLink(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 'link-1',
    resourceType: 'course',
    keyword: null,
    urlTemplate: 'https://example.com/search?q={query}',
    label: 'Default',
    active: true,
    priority: 0,
    ...overrides,
  };
}

function build() {
  const links = {
    find: jest.fn().mockResolvedValue([]),
    findOne: jest.fn(),
    create: jest.fn((x) => x),
    save: jest.fn((x) => Promise.resolve({ id: 'link-1', ...x })),
    delete: jest.fn(),
  };
  const service = new AffiliateLinksService(links as any);
  return { service, links };
}

describe('AffiliateLinksService.findAffiliateUrl', () => {
  it('returns null when nothing is configured for the resourceType', async () => {
    const { service, links } = build();
    links.find.mockResolvedValue([]);

    const result = await service.findAffiliateUrl('book', 'Fluent Python');

    expect(result).toBeNull();
  });

  it('falls back to the default (keyword null) template when no keyword matches', async () => {
    const { service, links } = build();
    links.find.mockResolvedValue([
      makeLink({
        keyword: null,
        urlTemplate: 'https://default.example/{query}',
      }),
    ]);

    const result = await service.findAffiliateUrl('course', 'Fluent Python');

    expect(result).toBe('https://default.example/Fluent%20Python');
  });

  it('a keyword match wins over the default template', async () => {
    const { service, links } = build();
    links.find.mockResolvedValue([
      makeLink({
        keyword: null,
        urlTemplate: 'https://default.example/{query}',
      }),
      makeLink({
        id: 'link-2',
        keyword: 'aws',
        urlTemplate: 'https://aws-deal.example/{query}',
      }),
    ]);

    const result = await service.findAffiliateUrl(
      'course',
      'AWS Certified Solutions Architect',
    );

    expect(result).toBe(
      'https://aws-deal.example/AWS%20Certified%20Solutions%20Architect',
    );
  });

  it('keyword matching is case-insensitive', async () => {
    const { service, links } = build();
    links.find.mockResolvedValue([
      makeLink({
        keyword: 'python',
        urlTemplate: 'https://py.example/{query}',
      }),
    ]);

    const result = await service.findAffiliateUrl('course', 'FLUENT PYTHON');

    expect(result).toBe('https://py.example/FLUENT%20PYTHON');
  });

  it('among multiple keyword matches, higher priority wins', async () => {
    const { service, links } = build();
    links.find.mockResolvedValue([
      makeLink({
        id: 'low',
        keyword: 'python',
        priority: 0,
        urlTemplate: 'https://low.example/{query}',
      }),
      makeLink({
        id: 'high',
        keyword: 'python',
        priority: 10,
        urlTemplate: 'https://high.example/{query}',
      }),
    ]);

    const result = await service.findAffiliateUrl(
      'course',
      'Python for beginners',
    );

    expect(result).toContain('high.example');
  });

  it('among equal-priority keyword matches, the longer (more specific) keyword wins', async () => {
    const { service, links } = build();
    links.find.mockResolvedValue([
      makeLink({
        id: 'short',
        keyword: 'python',
        urlTemplate: 'https://short.example/{query}',
      }),
      makeLink({
        id: 'long',
        keyword: 'python for data science',
        urlTemplate: 'https://long.example/{query}',
      }),
    ]);

    const result = await service.findAffiliateUrl(
      'course',
      'Python for Data Science Bootcamp',
    );

    expect(result).toContain('long.example');
  });

  it('only queries active rows — inactive templates never match', async () => {
    const { service, links } = build();
    links.find.mockResolvedValue([]);

    await service.findAffiliateUrl('book', 'Fluent Python');

    expect(links.find).toHaveBeenCalledWith({
      where: { resourceType: 'book', active: true },
    });
  });
});

describe('AffiliateLinksService admin CRUD', () => {
  it('list() returns every row, active or not', async () => {
    const { service, links } = build();
    links.find.mockResolvedValue([makeLink(), makeLink({ active: false })]);

    const result = await service.list();

    expect(result).toHaveLength(2);
    expect(links.find).toHaveBeenCalledWith(
      expect.objectContaining({
        order: { resourceType: 'ASC', priority: 'DESC' },
      }),
    );
  });

  it('update() 404s for an unknown id', async () => {
    const { service, links } = build();
    links.findOne.mockResolvedValue(null);

    await expect(service.update('ghost', { label: 'x' })).rejects.toThrow(
      NotFoundException,
    );
  });

  it('delete() 404s when nothing was affected', async () => {
    const { service, links } = build();
    links.delete.mockResolvedValue({ affected: 0 });

    await expect(service.delete('ghost')).rejects.toThrow(NotFoundException);
  });

  it('delete() succeeds when a row was removed', async () => {
    const { service, links } = build();
    links.delete.mockResolvedValue({ affected: 1 });

    await expect(service.delete('link-1')).resolves.toBeUndefined();
  });
});

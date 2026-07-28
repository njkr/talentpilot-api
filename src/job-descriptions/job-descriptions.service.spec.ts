import { JobDescriptionsService } from './job-descriptions.service';
import { JdResponse, UNTITLED_POSITION } from './dto/jd-response.dto';

const LONG_JD_TEXT = 'We are hiring a backend engineer. '.repeat(10); // > 100 chars

describe('JobDescriptionsService', () => {
  function build() {
    const findOne = jest.fn();
    const save = jest.fn((x) => Promise.resolve({ id: 'jd-1', ...x }));
    const create = jest.fn((x) => x);
    const update = jest.fn().mockResolvedValue(undefined);
    const jds = { findOne, save, create, update } as any;

    const complete = jest.fn().mockResolvedValue({
      data: {
        company: 'Acme',
        position: 'Backend Engineer',
        seniority: 'senior',
        employmentType: 'full_time',
        location: 'Remote',
        remoteType: 'remote',
        experienceRequired: '5+ years',
        salary: { min: null, max: null, currency: null },
        requirements: [],
        skills: [],
        responsibilities: [],
        keywords: [],
      },
    });
    const ai = { complete } as any;
    const extractor = {} as any;
    const validator = {} as any;

    const service = new JobDescriptionsService(jds, ai, extractor, validator);
    return { service, jds, complete };
  }

  it('pasting the same JD text twice reuses the analysed row (no second AI call)', async () => {
    const { service, jds, complete } = build();

    // First paste: no existing analyzed row -> proceeds to analyse.
    jds.findOne.mockResolvedValueOnce(null);
    jds.findOne.mockResolvedValueOnce({ id: 'jd-1', userId: 'user-1' }); // findOwned() inside analyse()
    const first = await service.paste('user-1', LONG_JD_TEXT);
    expect(complete).toHaveBeenCalledTimes(1);
    expect(first.id).toBe('jd-1');

    // Second paste: an analyzed row with the same content hash already exists.
    jds.findOne.mockResolvedValueOnce({
      id: 'jd-1',
      userId: 'user-1',
      status: 'analyzed',
    });
    const second = await service.paste('user-1', LONG_JD_TEXT);

    expect(second.id).toBe('jd-1');
    expect(complete).toHaveBeenCalledTimes(1); // still 1 — no second AI call
  });

  it('rejects text under the minimum length as JD_TOO_SHORT', async () => {
    const { service, complete } = build();
    await expect(service.paste('user-1', 'too short')).rejects.toMatchObject({
      code: 'JD_TOO_SHORT',
    });
    expect(complete).not.toHaveBeenCalled();
  });

  it('marks the row failed with a safe message when analysis throws', async () => {
    const { service, jds, complete } = build();
    jds.findOne.mockResolvedValueOnce(null);
    complete.mockRejectedValueOnce(
      new Error('raw provider error, not for users'),
    );

    await expect(service.paste('user-1', LONG_JD_TEXT)).rejects.toThrow();

    expect(jds.update).toHaveBeenCalledWith(
      'jd-1',
      expect.objectContaining({ status: 'failed' }),
    );
    const [, payload] = jds.update.mock.calls.at(-1)!;
    expect(payload.parseError).not.toContain('raw provider error');
  });

  describe('updateFields', () => {
    it('applies a user-supplied company/position without re-running analysis', async () => {
      const { service, jds, complete } = build();
      jds.findOne.mockResolvedValue({
        id: 'jd-1',
        userId: 'user-1',
        company: null,
      });

      await service.updateFields('jd-1', 'user-1', { company: 'Acme Corp' });

      expect(jds.update).toHaveBeenCalledWith('jd-1', { company: 'Acme Corp' });
      expect(complete).not.toHaveBeenCalled();
    });

    it('is a no-op when neither field is given', async () => {
      const { service, jds } = build();
      jds.findOne.mockResolvedValue({ id: 'jd-1', userId: 'user-1' });

      await service.updateFields('jd-1', 'user-1', {});

      expect(jds.update).not.toHaveBeenCalled();
    });

    it('404s on a JD that does not belong to the caller', async () => {
      const { service, jds } = build();
      jds.findOne.mockResolvedValue(null);

      await expect(
        service.updateFields('jd-1', 'someone-elses-id', { company: 'Acme' }),
      ).rejects.toThrow();
    });
  });
});

describe('JdResponse.missingFields', () => {
  const base = {
    id: 'jd-1',
    position: 'Backend Engineer',
    company: 'Acme Corp',
    source: 'upload',
    employmentType: null,
    location: null,
    remoteType: null,
    experienceRequired: null,
    salaryMin: null,
    salaryMax: null,
    salaryCurrency: null,
    parsedData: null,
    status: 'analyzed',
    parseError: null,
    createdAt: new Date(),
  };

  it('is empty when both company and position are set', () => {
    expect(new JdResponse(base as any).missingFields).toEqual([]);
  });

  it('flags company when null (the reported bug: a JD upload with no company mentioned)', () => {
    const jd = { ...base, company: null };
    expect(new JdResponse(jd as any).missingFields).toEqual(['company']);
  });

  it('flags position when it is still the ingest() fallback sentinel', () => {
    const jd = { ...base, position: UNTITLED_POSITION };
    expect(new JdResponse(jd as any).missingFields).toEqual(['position']);
  });

  it('flags both when neither was ever provided', () => {
    const jd = { ...base, company: null, position: UNTITLED_POSITION };
    expect(new JdResponse(jd as any).missingFields).toEqual([
      'company',
      'position',
    ]);
  });
});

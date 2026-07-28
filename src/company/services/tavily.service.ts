import { Injectable } from '@nestjs/common';
import { Env } from '../../config/config.module';
import { IntegrationCallRecorderService } from '../../integration-calls/integration-call-recorder.service';

export interface TavilyResult {
  title: string;
  url: string;
  content: string;
}

interface TavilySearchResponse {
  results: Array<{ title: string; url: string; content: string }>;
}

const SEARCH_TIMEOUT_MS = 10_000;
const RESULTS_PER_QUERY = 3;

@Injectable()
export class TavilyService {
  constructor(
    private readonly env: Env,
    private readonly integrationCalls: IntegrationCallRecorderService,
  ) {}

  /**
   * Grounding. Without real search results, the company_synthesis prompt would
   * produce confident, plausible, completely invented "company culture" — the worst
   * possible output, because the user takes it into an interview.
   */
  async research(company: string): Promise<TavilyResult[]> {
    return this.searchMultiple([
      `${company} company culture employee reviews`,
      `${company} interview process candidates`,
      `${company} products technology stack`,
      `${company} recent news`,
    ]);
  }

  /**
   * General multi-query search, shared by company research and salary estimation —
   * both need "run several queries, tolerate individual failures, flatten the results"
   * rather than a company-specific query set.
   */
  async searchMultiple(queries: string[]): Promise<TavilyResult[]> {
    const results = await Promise.allSettled(
      queries.map((q) => this.search(q, RESULTS_PER_QUERY)),
    );
    // allSettled, not all: one failed query must not lose the others.
    return results.flatMap((r) => (r.status === 'fulfilled' ? r.value : []));
  }

  private async search(
    query: string,
    maxResults: number,
  ): Promise<TavilyResult[]> {
    const start = Date.now();
    try {
      const res = await fetch('https://api.tavily.com/search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          api_key: this.env.get('TAVILY_API_KEY'),
          query,
          max_results: maxResults,
          search_depth: 'basic',
        }),
        signal: AbortSignal.timeout(SEARCH_TIMEOUT_MS),
      });
      if (!res.ok) throw new Error(`Tavily ${res.status}`);
      const data = (await res.json()) as TavilySearchResponse;
      await this.integrationCalls.record({
        provider: 'tavily',
        operation: 'search',
        success: true,
        durationMs: Date.now() - start,
      });
      return data.results.map((r) => ({
        title: r.title,
        url: r.url,
        content: r.content,
      }));
    } catch (err) {
      await this.integrationCalls.record({
        provider: 'tavily',
        operation: 'search',
        success: false,
        errorType: err instanceof Error ? err.message : String(err),
        durationMs: Date.now() - start,
      });
      throw err;
    }
  }
}

// One-off, READ-ONLY: lists every AiSuggestion whose keywordsAdded includes a JD gap
// keyword (missing/partial AT GENERATION TIME, joined via ats_reports.run_id = the
// suggestion's own run_id — not just "the workspace's latest report") that's absent
// from the resume's raw_text. This is exactly what the new FabricationGuardService
// keyword check (2026-08-05) would have caught, applied retroactively to suggestions
// created before the fix shipped. No updates, no reverts — for manual review only.
// Run: npx ts-node -r tsconfig-paths/register scripts/tmp-audit-unevidenced-keywords.ts
import 'dotenv/config';
import dataSource from '../src/database/data-source';

interface AuditRow {
  suggestion_id: string;
  status: string;
  workspace_id: string;
  resume_id: string;
  new_text: string;
  raw_text: string | null;
  keyword: string;
}

function wordBoundaryRegex(phrase: string): RegExp {
  const escaped = phrase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(^|[^a-zA-Z0-9])${escaped}([^a-zA-Z0-9]|$)`, 'i');
}

async function main() {
  await dataSource.initialize();
  try {
    const rows: AuditRow[] = await dataSource.query(`
      SELECT s.id AS suggestion_id, s.status, s.workspace_id, w.resume_id,
             s.new_text, r.raw_text, m.keyword
      FROM ai_suggestions s
      JOIN workspaces w ON w.id = s.workspace_id
      JOIN resumes r ON r.id = w.resume_id
      JOIN ats_reports rep ON rep.run_id = s.run_id
      JOIN keyword_matches m ON m.ats_report_id = rep.id
                             AND m.status IN ('missing', 'partial')
      WHERE jsonb_array_length(s.keywords_added) > 0
    `);

    const leaks: AuditRow[] = [];
    for (const row of rows) {
      const pattern = wordBoundaryRegex(row.keyword);
      if (!pattern.test(row.new_text)) continue; // this suggestion doesn't claim it
      if (!pattern.test(row.raw_text ?? '')) leaks.push(row);
    }

    const accepted = leaks.filter((l) => l.status === 'accepted');
    const others = leaks.filter((l) => l.status !== 'accepted');

    console.log(
      `Checked ${rows.length} (suggestion, gap-keyword) pairs across the DB.`,
    );
    console.log(`Found ${leaks.length} unevidenced keyword claims total.\n`);

    console.log(
      `── ${accepted.length} ALREADY ACCEPTED (live on a real resume version — review these first) ──`,
    );
    for (const l of accepted) {
      console.log(
        `  suggestion=${l.suggestion_id} workspace=${l.workspace_id} resume=${l.resume_id} keyword="${l.keyword}"`,
      );
      console.log(`    newText: ${l.new_text.slice(0, 160)}`);
    }

    console.log(
      `\n── ${others.length} not yet accepted (pending/rejected/needs_info/stale — will stay blocked going forward, no action needed) ──`,
    );
    for (const l of others) {
      console.log(
        `  suggestion=${l.suggestion_id} status=${l.status} workspace=${l.workspace_id} keyword="${l.keyword}"`,
      );
    }
  } finally {
    await dataSource.destroy();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

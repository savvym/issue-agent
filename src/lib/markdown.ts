import type { IssueReport } from '../schemas/report.js';

export function renderReportMarkdown(report: IssueReport): string {
  const lines: string[] = [];

  lines.push(`# Issue Analysis Report: ${report.repository}#${report.issueNumber}`);
  lines.push('');
  lines.push(`- **Issue URL:** ${report.issueUrl}`);
  lines.push(`- **Generated At:** ${report.generatedAt}`);
  lines.push(`- **Type:** ${report.classification.type}`);
  lines.push(`- **Severity:** ${report.classification.severity}`);
  lines.push(`- **Complexity:** ${report.classification.complexity}`);
  lines.push(`- **Risk Level:** ${report.classification.riskLevel}`);
  lines.push('');

  lines.push('## Executive Summary');
  lines.push('');
  lines.push(report.executiveSummary);
  lines.push('');

  lines.push('## Root Cause Hypotheses');
  lines.push('');
  for (const hypothesis of report.rootCauseHypotheses) {
    lines.push(`### ${hypothesis.title} (${hypothesis.confidence})`);
    lines.push('');
    lines.push(hypothesis.description);
    lines.push('');
    lines.push('Impacted paths:');
    for (const path of hypothesis.impactedPaths) {
      lines.push(`- \`${path}\``);
    }
    lines.push('');
  }

  lines.push('## Evidence');
  lines.push('');
  for (const item of report.evidence) {
    lines.push(`### \`${item.filePath}\` (${item.confidence})`);
    lines.push('');
    lines.push(`- Rationale: ${item.rationale}`);
    if (item.excerpt) {
      lines.push('- Excerpt:');
      lines.push('');
      lines.push('```text');
      lines.push(item.excerpt);
      lines.push('```');
    }
    lines.push('');
  }

  lines.push('## Implementation Plan');
  lines.push('');
  for (const step of report.implementationPlan) {
    lines.push(`### ${step.order}. ${step.step}`);
    lines.push('');
    lines.push(`- Detail: ${step.detail}`);
    lines.push(`- Verification: ${step.verification}`);
    lines.push('');
  }

  lines.push('## Testing Checklist');
  lines.push('');
  for (const test of report.testingChecklist) {
    lines.push(`- [ ] ${test}`);
  }
  lines.push('');

  lines.push('## Open Questions');
  lines.push('');
  if (report.openQuestions.length === 0) {
    lines.push('- None.');
  } else {
    for (const question of report.openQuestions) {
      lines.push(`- ${question}`);
    }
  }
  lines.push('');

  lines.push('## Artifacts');
  lines.push('');
  lines.push(`- Issue Snapshot: \`${report.artifacts.issueSnapshotPath}\``);
  lines.push(`- JSON Report: \`${report.artifacts.reportJsonPath}\``);
  lines.push(`- Markdown Report: \`${report.artifacts.reportMarkdownPath}\``);

  return lines.join('\n');
}

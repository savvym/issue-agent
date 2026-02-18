import type { IssueBundle } from '../lib/github.js';
import { loadSkill, mergeInstructions } from '../skills/loader.js';
import type { ModelLike } from './model.js';
import { generateMarkdownText } from './markdown-generation.js';

interface ArtifactPaths {
  issueSnapshotPath: string;
  reportJsonPath: string;
  reportMarkdownPath: string;
}

interface RunReportWriterMarkdownParams {
  model: ModelLike;
  issueBundle: IssueBundle;
  understandingMarkdown: string;
  investigationMarkdown: string;
  planMarkdown: string;
  artifacts: ArtifactPaths;
  rootDir: string;
  language: string;
  onTextDelta?: (delta: string) => void;
}

export async function runReportWriterMarkdownAgent(
  params: RunReportWriterMarkdownParams,
): Promise<string> {
  const skillText = loadSkill('report-writing', params.rootDir);
  const system = mergeInstructions(
    [
      `You are a principal engineer writing an implementation-ready issue analysis report. Reply in ${params.language}.`,
      'Return a complete markdown report only.',
      'Use sections:',
      '1) Executive Summary',
      '2) Classification',
      '3) Root Cause Hypotheses',
      '4) Evidence',
      '5) Implementation Plan',
      '6) Testing Checklist',
      '7) Open Questions',
      '8) Artifacts',
      '',
      'Be concise but actionable.',
    ].join('\n'),
    skillText,
  );

  const prompt = [
    `Repository: ${params.issueBundle.reference.owner}/${params.issueBundle.reference.repo}`,
    `Issue #${params.issueBundle.issue.number}: ${params.issueBundle.issue.title}`,
    `Issue URL: ${params.issueBundle.reference.issueUrl}`,
    `Generated At: ${new Date().toISOString()}`,
    '',
    'Issue understanding:',
    params.understandingMarkdown,
    '',
    'Code investigation:',
    params.investigationMarkdown,
    '',
    'Execution plan:',
    params.planMarkdown,
    '',
    'Artifacts (must include these paths in Artifacts section):',
    JSON.stringify(params.artifacts, null, 2),
  ].join('\n');

  return generateMarkdownText({
    model: params.model,
    system,
    prompt,
    onTextDelta: params.onTextDelta,
  });
}

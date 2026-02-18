import type { IssueBundle } from '../lib/github.js';
import type {
  CodeInvestigation,
  ExecutionPlan,
  IssueReport,
  IssueUnderstanding,
} from '../schemas/report.js';
import { issueReportSchema } from '../schemas/report.js';
import { loadSkill, mergeInstructions } from '../skills/loader.js';
import type { ModelLike } from './model.js';
import { generateStructuredObject } from './structured-generation.js';

interface ArtifactPaths {
  issueSnapshotPath: string;
  reportJsonPath: string;
  reportMarkdownPath: string;
}

interface RunReportWriterParams {
  model: ModelLike;
  issueBundle: IssueBundle;
  understanding: IssueUnderstanding;
  investigation: CodeInvestigation;
  plan: ExecutionPlan;
  artifacts: ArtifactPaths;
  rootDir: string;
  language: string;
}

export async function runReportWriterAgent(params: RunReportWriterParams): Promise<IssueReport> {
  const skillText = loadSkill('report-writing', params.rootDir);
  const system = mergeInstructions(
    `You are a principal engineer writing an implementation-ready issue analysis report. Reply in ${params.language}. Stay grounded in evidence.`,
    skillText,
  );

  const evidence = params.investigation.hypotheses.flatMap((hypothesis) => hypothesis.evidence);

  const prompt = [
    `Repository: ${params.issueBundle.reference.owner}/${params.issueBundle.reference.repo}`,
    `Issue #${params.issueBundle.issue.number}: ${params.issueBundle.issue.title}`,
    `Issue URL: ${params.issueBundle.reference.issueUrl}`,
    `Generated At: ${new Date().toISOString()}`,
    '',
    'Issue understanding:',
    JSON.stringify(params.understanding, null, 2),
    '',
    'Code investigation:',
    JSON.stringify(params.investigation, null, 2),
    '',
    'Execution plan:',
    JSON.stringify(params.plan, null, 2),
    '',
    'Artifacts (must be copied exactly):',
    JSON.stringify(params.artifacts, null, 2),
    '',
    'Evidence list:',
    JSON.stringify(evidence, null, 2),
  ].join('\n');

  return generateStructuredObject({
    model: params.model,
    schema: issueReportSchema,
    system,
    prompt,
  });
}

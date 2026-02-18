import type { IssueBundle } from '../lib/github.js';
import type { FileEvidenceContext } from '../lib/evidence.js';
import type { IssueUnderstanding } from '../schemas/report.js';
import { codeInvestigationSchema, type CodeInvestigation } from '../schemas/report.js';
import { loadSkill, mergeInstructions } from '../skills/loader.js';
import type { ModelLike } from './model.js';
import { generateStructuredObject } from './structured-generation.js';

interface RunCodeInvestigationParams {
  model: ModelLike;
  issueBundle: IssueBundle;
  understanding: IssueUnderstanding;
  evidenceFiles: FileEvidenceContext[];
  rootDir: string;
  language: string;
}

function serializeCodeContext(files: FileEvidenceContext[]): string {
  if (files.length === 0) {
    return 'No file evidence was found from GitHub code search.';
  }

  return files
    .map((file, index) => {
      const truncatedFlag = file.truncated ? 'yes' : 'no';
      return [
        `File ${index + 1}: ${file.path}`,
        `Source query: ${file.sourceQuery}`,
        `GitHub URL: ${file.url}`,
        `Truncated: ${truncatedFlag}`,
        'Content:',
        file.content,
      ].join('\n');
    })
    .join('\n\n====\n\n');
}

export async function runCodeInvestigationAgent(
  params: RunCodeInvestigationParams,
): Promise<CodeInvestigation> {
  const skillText = loadSkill('code-root-cause', params.rootDir);
  const system = mergeInstructions(
    `You are a senior software engineer investigating root causes for GitHub issues. Reply in ${params.language}. Only cite files provided in the code context unless explicitly stating missing evidence.`,
    skillText,
  );

  const prompt = [
    `Repository: ${params.issueBundle.reference.owner}/${params.issueBundle.reference.repo}`,
    `Issue #${params.issueBundle.issue.number}: ${params.issueBundle.issue.title}`,
    '',
    'Issue understanding:',
    JSON.stringify(params.understanding, null, 2),
    '',
    'Issue body:',
    params.issueBundle.issue.body ?? '(empty)',
    '',
    'Evidence files:',
    serializeCodeContext(params.evidenceFiles),
  ].join('\n');

  return generateStructuredObject({
    model: params.model,
    schema: codeInvestigationSchema,
    system,
    prompt,
  });
}

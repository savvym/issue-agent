import type { IssueBundle } from '../lib/github.js';
import type { FileEvidenceContext } from '../lib/evidence.js';
import { loadSkill, mergeInstructions } from '../skills/loader.js';
import type { ModelLike } from './model.js';
import { generateMarkdownText } from './markdown-generation.js';

interface RunCodeInvestigationMarkdownParams {
  model: ModelLike;
  issueBundle: IssueBundle;
  understandingMarkdown: string;
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

export async function runCodeInvestigationMarkdownAgent(
  params: RunCodeInvestigationMarkdownParams,
): Promise<string> {
  const skillText = loadSkill('code-root-cause', params.rootDir);
  const system = mergeInstructions(
    [
      `You are a senior software engineer investigating root causes for GitHub issues. Reply in ${params.language}.`,
      'Return a markdown document with sections:',
      '- Root Cause Hypotheses',
      '- Evidence Mapping',
      '- Impacted Code Paths',
      '- Missing Evidence',
      '',
      'Use explicit file paths in every hypothesis.',
    ].join('\n'),
    skillText,
  );

  const prompt = [
    `Repository: ${params.issueBundle.reference.owner}/${params.issueBundle.reference.repo}`,
    `Issue #${params.issueBundle.issue.number}: ${params.issueBundle.issue.title}`,
    '',
    'Issue understanding:',
    params.understandingMarkdown,
    '',
    'Issue body:',
    params.issueBundle.issue.body ?? '(empty)',
    '',
    'Evidence files:',
    serializeCodeContext(params.evidenceFiles),
  ].join('\n');

  return generateMarkdownText({
    model: params.model,
    system,
    prompt,
  });
}

import type { IssueBundle } from '../lib/github.js';
import { loadSkill, mergeInstructions } from '../skills/loader.js';
import type { ModelLike } from './model.js';
import { generateMarkdownText } from './markdown-generation.js';

interface RunExecutionPlanMarkdownParams {
  model: ModelLike;
  issueBundle: IssueBundle;
  understandingMarkdown: string;
  investigationMarkdown: string;
  rootDir: string;
  language: string;
}

export async function runExecutionPlanMarkdownAgent(
  params: RunExecutionPlanMarkdownParams,
): Promise<string> {
  const skillText = loadSkill('execution-planning', params.rootDir);
  const system = mergeInstructions(
    [
      `You are a technical lead creating an implementation plan for a GitHub issue. Reply in ${params.language}.`,
      'Return a markdown document with sections:',
      '- Complexity and Risk',
      '- Implementation Plan (ordered list)',
      '- Test Plan',
      '- Rollout Notes',
      '',
      'Each implementation step must include a concrete verification method.',
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
    'Root cause investigation:',
    params.investigationMarkdown,
  ].join('\n');

  return generateMarkdownText({
    model: params.model,
    system,
    prompt,
  });
}

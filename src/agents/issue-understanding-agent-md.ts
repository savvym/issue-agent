import type { IssueBundle } from '../lib/github.js';
import { loadSkill, mergeInstructions } from '../skills/loader.js';
import type { ModelLike } from './model.js';
import { generateMarkdownText } from './markdown-generation.js';

interface RunIssueUnderstandingMarkdownParams {
  model: ModelLike;
  issueBundle: IssueBundle;
  rootDir: string;
  language: string;
}

export interface IssueUnderstandingMarkdownResult {
  markdown: string;
  searchKeywords: string[];
}

function serializeIssue(bundle: IssueBundle): string {
  const comments = bundle.comments
    .slice(0, 20)
    .map((comment, idx) => {
      const body = (comment.body ?? '').slice(0, 1200);
      return `Comment ${idx + 1} by ${comment.user} at ${comment.createdAt}:\n${body}`;
    })
    .join('\n\n---\n\n');

  return [
    `Repository: ${bundle.reference.owner}/${bundle.reference.repo}`,
    `Issue: #${bundle.issue.number} ${bundle.issue.title}`,
    `Author: ${bundle.issue.user}`,
    `Labels: ${bundle.issue.labels.join(', ') || 'none'}`,
    `Created: ${bundle.issue.createdAt}`,
    `Updated: ${bundle.issue.updatedAt}`,
    '',
    'Issue body:',
    bundle.issue.body ?? '(empty)',
    '',
    'Issue comments:',
    comments || '(no comments)',
  ].join('\n');
}

function deriveKeywords(text: string): string[] {
  return [...new Set(
    text
      .split(/[^a-zA-Z0-9_./:-]+/)
      .map((token) => token.trim())
      .filter((token) => token.length >= 4),
  )].slice(0, 12);
}

export async function runIssueUnderstandingMarkdownAgent(
  params: RunIssueUnderstandingMarkdownParams,
): Promise<IssueUnderstandingMarkdownResult> {
  const skillText = loadSkill('issue-triage', params.rootDir);
  const system = mergeInstructions(
    [
      `You are an issue triage specialist. Reply in ${params.language}.`,
      'Return a concise markdown document with sections:',
      '- Issue Classification',
      '- Key Symptoms',
      '- Acceptance Signals',
      '- Suggested Search Keywords',
      '',
      'In "Suggested Search Keywords", add 8-12 concrete terms as a bullet list.',
    ].join('\n'),
    skillText,
  );

  const markdown = await generateMarkdownText({
    model: params.model,
    system,
    prompt: serializeIssue(params.issueBundle),
  });

  const keywordLines = markdown
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => /^[-*]\s+/.test(line))
    .map((line) => line.replace(/^[-*]\s+/, '').trim())
    .filter((line) => line.length >= 3);

  const searchKeywords = [...new Set([...keywordLines, ...deriveKeywords(params.issueBundle.issue.title), ...deriveKeywords(params.issueBundle.issue.body ?? ''), ...deriveKeywords(markdown)])].slice(0, 12);

  return {
    markdown,
    searchKeywords,
  };
}

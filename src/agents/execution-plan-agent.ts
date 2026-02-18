import type { IssueBundle } from '../lib/github.js';
import type { CodeInvestigation, IssueUnderstanding } from '../schemas/report.js';
import { executionPlanSchema, type ExecutionPlan } from '../schemas/report.js';
import { loadSkill, mergeInstructions } from '../skills/loader.js';
import type { ModelLike } from './model.js';
import { generateStructuredObject } from './structured-generation.js';

interface RunExecutionPlanParams {
  model: ModelLike;
  issueBundle: IssueBundle;
  understanding: IssueUnderstanding;
  investigation: CodeInvestigation;
  rootDir: string;
  language: string;
}

export async function runExecutionPlanAgent(params: RunExecutionPlanParams): Promise<ExecutionPlan> {
  const skillText = loadSkill('execution-planning', params.rootDir);
  const system = mergeInstructions(
    `You are a technical lead creating an implementation plan for a GitHub issue. Reply in ${params.language}. Keep steps concrete and testable.`,
    skillText,
  );

  const prompt = [
    `Repository: ${params.issueBundle.reference.owner}/${params.issueBundle.reference.repo}`,
    `Issue #${params.issueBundle.issue.number}: ${params.issueBundle.issue.title}`,
    '',
    'Issue understanding:',
    JSON.stringify(params.understanding, null, 2),
    '',
    'Root cause investigation:',
    JSON.stringify(params.investigation, null, 2),
  ].join('\n');

  return generateStructuredObject({
    model: params.model,
    schema: executionPlanSchema,
    system,
    prompt,
  });
}

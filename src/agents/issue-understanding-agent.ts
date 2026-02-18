import { NoObjectGeneratedError } from 'ai';
import type { IssueBundle } from '../lib/github.js';
import { issueUnderstandingSchema, type IssueUnderstanding } from '../schemas/report.js';
import { loadSkill, mergeInstructions } from '../skills/loader.js';
import type { ModelLike } from './model.js';
import { generateStructuredObject } from './structured-generation.js';

interface RunIssueUnderstandingParams {
  model: ModelLike;
  issueBundle: IssueBundle;
  rootDir: string;
  language: string;
}

function serializeIssue(bundle: IssueBundle): string {
  const comments = bundle.comments
    .slice(0, 15)
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

const ISSUE_TYPES = ['bug', 'feature', 'refactor', 'documentation', 'question', 'other'] as const;
const SEVERITIES = ['low', 'medium', 'high', 'critical'] as const;

function normalizeIssueType(value: unknown): IssueUnderstanding['issueType'] {
  if (typeof value !== 'string') {
    return 'other';
  }

  const normalized = value.trim().toLowerCase();
  if ((ISSUE_TYPES as readonly string[]).includes(normalized)) {
    return normalized as IssueUnderstanding['issueType'];
  }

  if (normalized.includes('bug') || normalized.includes('regression') || normalized.includes('incident')) {
    return 'bug';
  }
  if (normalized.includes('feature') || normalized.includes('enhancement') || normalized.includes('request')) {
    return 'feature';
  }
  if (normalized.includes('refactor') || normalized.includes('cleanup')) {
    return 'refactor';
  }
  if (normalized.includes('doc')) {
    return 'documentation';
  }
  if (normalized.includes('question') || normalized.includes('help')) {
    return 'question';
  }

  return 'other';
}

function normalizeSeverity(value: unknown): IssueUnderstanding['severity'] {
  if (typeof value !== 'string') {
    return 'medium';
  }

  const normalized = value.trim().toLowerCase();
  if ((SEVERITIES as readonly string[]).includes(normalized)) {
    return normalized as IssueUnderstanding['severity'];
  }

  if (normalized.includes('critical') || normalized.includes('blocker') || normalized.includes('p0')) {
    return 'critical';
  }
  if (normalized.includes('high') || normalized.includes('major') || normalized.includes('p1')) {
    return 'high';
  }
  if (normalized.includes('low') || normalized.includes('minor') || normalized.includes('p3')) {
    return 'low';
  }

  return 'medium';
}

function toStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((item) => {
      if (typeof item === 'string') {
        return item.trim();
      }

      if (item && typeof item === 'object') {
        const candidates = ['signal', 'value', 'name', 'title', 'text', 'description']
          .map((key) => (item as Record<string, unknown>)[key])
          .filter((part): part is string => typeof part === 'string');
        return candidates[0]?.trim() ?? '';
      }

      return '';
    })
    .filter((item) => item.length > 0);
}

function extractBalancedJsonObject(text: string): string | undefined {
  const start = text.indexOf('{');
  if (start < 0) {
    return undefined;
  }

  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let idx = start; idx < text.length; idx += 1) {
    const char = text[idx];

    if (inString) {
      if (escaped) {
        escaped = false;
        continue;
      }
      if (char === '\\') {
        escaped = true;
        continue;
      }
      if (char === '"') {
        inString = false;
      }
      continue;
    }

    if (char === '"') {
      inString = true;
      continue;
    }

    if (char === '{') {
      depth += 1;
      continue;
    }

    if (char === '}') {
      depth -= 1;
      if (depth === 0) {
        return text.slice(start, idx + 1);
      }
    }
  }

  return undefined;
}

function deriveKeywordsFromText(text: string): string[] {
  return text
    .split(/[^a-zA-Z0-9_/.:-]+/)
    .map((token) => token.trim())
    .filter((token) => token.length >= 3)
    .slice(0, 8);
}

function firstString(...values: unknown[]): string | undefined {
  for (const value of values) {
    if (typeof value === 'string' && value.trim()) {
      return value.trim();
    }
  }
  return undefined;
}

function recoverIssueUnderstandingFromText(
  text: string | undefined,
  issueBundle: IssueBundle,
): IssueUnderstanding | undefined {
  if (!text) {
    return undefined;
  }

  const objectRaw = extractBalancedJsonObject(text);
  if (!objectRaw) {
    return undefined;
  }

  try {
    const parsed = JSON.parse(objectRaw) as Record<string, unknown>;
    const classification =
      parsed.classification && typeof parsed.classification === 'object'
        ? (parsed.classification as Record<string, unknown>)
        : undefined;

    const keySymptomsRaw = [
      ...toStringArray(parsed.keySymptoms ?? parsed.key_symptoms ?? parsed.symptoms),
      ...toStringArray(parsed.facts),
    ];
    const keySymptoms = [...new Set(keySymptomsRaw)].slice(0, 12);

    const acceptanceRaw = toStringArray(
      parsed.acceptanceSignals ?? parsed.acceptance_signals ?? parsed.expected_signals,
    );
    const acceptanceSignals = [...new Set(acceptanceRaw)].slice(0, 12);

    const keywordRaw = toStringArray(
      parsed.searchKeywords ?? parsed.search_keywords ?? parsed.keywords ?? parsed.search_terms,
    );
    const keywordPool = [
      ...keywordRaw,
      ...deriveKeywordsFromText(issueBundle.issue.title),
      ...deriveKeywordsFromText(issueBundle.issue.body ?? ''),
    ];
    const searchKeywords = [...new Set(keywordPool)].slice(0, 12);

    const candidate: IssueUnderstanding = {
      issueType: normalizeIssueType(parsed.issueType ?? parsed.issue_type ?? classification?.type),
      severity: normalizeSeverity(parsed.severity ?? parsed.priority ?? classification?.severity),
      summary:
        firstString(parsed.summary, parsed.executiveSummary, parsed.title, issueBundle.issue.title) ??
        issueBundle.issue.title,
      keySymptoms:
        keySymptoms.length > 0
          ? keySymptoms
          : [firstString(parsed.title, issueBundle.issue.title) ?? 'Issue symptom captured in report.'],
      acceptanceSignals:
        acceptanceSignals.length > 0
          ? acceptanceSignals
          : ['Behavior should be reproducible and verifiable with endpoint responses.'],
      searchKeywords:
        searchKeywords.length >= 3
          ? searchKeywords
          : [...searchKeywords, ...deriveKeywordsFromText(issueBundle.reference.issueUrl)].slice(0, 12),
    };

    if (candidate.searchKeywords.length < 3) {
      candidate.searchKeywords.push(
        `${issueBundle.reference.owner}/${issueBundle.reference.repo}`,
        String(issueBundle.issue.number),
      );
    }

    const validated = issueUnderstandingSchema.safeParse(candidate);
    if (validated.success) {
      return validated.data;
    }
  } catch {
    return undefined;
  }

  return undefined;
}

export async function runIssueUnderstandingAgent(
  params: RunIssueUnderstandingParams,
): Promise<IssueUnderstanding> {
  const skillText = loadSkill('issue-triage', params.rootDir);
  const system = mergeInstructions(
    `You are an issue triage specialist. Reply in ${params.language}. Use only available evidence from the issue and comments.`,
    skillText,
  );

  try {
    return await generateStructuredObject({
      model: params.model,
      schema: issueUnderstandingSchema,
      system,
      prompt: serializeIssue(params.issueBundle),
    });
  } catch (error) {
    if (!NoObjectGeneratedError.isInstance(error)) {
      throw error;
    }

    const recovered = recoverIssueUnderstandingFromText(error.text, params.issueBundle);
    if (recovered) {
      return recovered;
    }

    throw error;
  }
}

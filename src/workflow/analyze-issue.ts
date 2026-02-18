import path from 'node:path';
import { createOpenAI } from '@ai-sdk/openai';
import { runIssueUnderstandingMarkdownAgent } from '../agents/issue-understanding-agent-md.js';
import { runCodeInvestigationMarkdownAgent } from '../agents/code-investigation-agent-md.js';
import { runExecutionPlanMarkdownAgent } from '../agents/execution-plan-agent-md.js';
import { runReportWriterMarkdownAgent } from '../agents/report-writer-agent-md.js';
import { createRunOutputDir, writeJsonFile, writeTextFile } from '../lib/files.js';
import { fetchIssueBundle, parseIssueReference, createGitHubClient } from '../lib/github.js';
import { collectEvidenceFiles } from '../lib/evidence.js';

export type OpenAIApiType = 'responses' | 'chat';
export type AnalyzeTraceStatus = 'start' | 'success' | 'error';

export interface AnalyzeTraceEvent {
  timestamp: string;
  stage: string;
  status: AnalyzeTraceStatus;
  durationMs?: number;
  detail?: Record<string, unknown>;
}

export interface AnalyzeIssueOptions {
  issueUrl?: string;
  repository?: string;
  issueNumber?: number;
  outputBaseDir: string;
  rootDir: string;
  language: string;
  model: string;
  openaiApiType?: OpenAIApiType;
  openaiBaseURL?: string;
  openaiApiKey?: string;
  openaiOrganization?: string;
  openaiProject?: string;
  openaiProviderName?: string;
  githubToken?: string;
  trace?: (event: AnalyzeTraceEvent) => void;
  reportDelta?: (delta: string) => void;
}

export interface AnalyzeIssueResult {
  outputDir: string;
  issueSnapshotPath: string;
  issueUnderstandingPath: string;
  codeInvestigationPath: string;
  executionPlanPath: string;
  reportJsonPath: string;
  reportMarkdownPath: string;
  tracePath: string;
  report: null;
  trace: AnalyzeTraceEvent[];
}

function buildModel(
  modelId: string,
  apiType: OpenAIApiType,
  options: {
    baseURL?: string;
    apiKey?: string;
    organization?: string;
    project?: string;
    providerName?: string;
  },
) {
  const provider = createOpenAI({
    baseURL: options.baseURL?.trim() ? options.baseURL.trim() : undefined,
    apiKey: options.apiKey?.trim() ? options.apiKey.trim() : undefined,
    organization: options.organization?.trim() ? options.organization.trim() : undefined,
    project: options.project?.trim() ? options.project.trim() : undefined,
    name: options.providerName?.trim() ? options.providerName.trim() : undefined,
  });
  const normalized = modelId.includes('/') ? modelId.split('/').at(-1) ?? modelId : modelId;
  return apiType === 'chat' ? provider.chat(normalized) : provider.responses(normalized);
}

function deriveExtraKeywords(text: string): string[] {
  return text
    .split(/[^a-zA-Z0-9_]+/)
    .map((token) => token.trim())
    .filter((token) => token.length >= 4)
    .slice(0, 6);
}

function toErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  return String(error);
}

function maskSecret(value: string | undefined): string {
  if (!value) {
    return 'unset';
  }

  return `set(len=${value.length})`;
}

async function runStage<T>(
  trace: AnalyzeTraceEvent[],
  emit: (event: AnalyzeTraceEvent) => void,
  stage: string,
  fn: () => Promise<T>,
  startDetail?: Record<string, unknown>,
  successDetail?: (value: T) => Record<string, unknown> | undefined,
): Promise<T> {
  const startedAt = Date.now();
  const startEvent: AnalyzeTraceEvent = {
    timestamp: new Date().toISOString(),
    stage,
    status: 'start',
    detail: startDetail,
  };
  trace.push(startEvent);
  emit(startEvent);

  try {
    const result = await fn();
    const successEvent: AnalyzeTraceEvent = {
      timestamp: new Date().toISOString(),
      stage,
      status: 'success',
      durationMs: Date.now() - startedAt,
      detail: successDetail?.(result),
    };
    trace.push(successEvent);
    emit(successEvent);
    return result;
  } catch (error) {
    const errorEvent: AnalyzeTraceEvent = {
      timestamp: new Date().toISOString(),
      stage,
      status: 'error',
      durationMs: Date.now() - startedAt,
      detail: {
        message: toErrorMessage(error),
      },
    };
    trace.push(errorEvent);
    emit(errorEvent);
    throw error;
  }
}

export async function analyzeIssue(options: AnalyzeIssueOptions): Promise<AnalyzeIssueResult> {
  const trace: AnalyzeTraceEvent[] = [];
  const emit = (event: AnalyzeTraceEvent) => {
    options.trace?.(event);
  };

  const reference = await runStage(
    trace,
    emit,
    'parse-reference',
    async () =>
      parseIssueReference({
        issueUrl: options.issueUrl,
        repository: options.repository,
        issueNumber: options.issueNumber,
      }),
  );

  const client = createGitHubClient(options.githubToken);
  const issueBundle = await runStage(
    trace,
    emit,
    'fetch-issue',
    async () => fetchIssueBundle(client, reference),
    {
      repository: `${reference.owner}/${reference.repo}`,
      issueNumber: reference.issueNumber,
    },
    (bundle) => ({
      title: bundle.issue.title,
      commentCount: bundle.comments.length,
      labels: bundle.issue.labels.slice(0, 10),
    }),
  );

  const outputDir = await runStage(
    trace,
    emit,
    'create-output-dir',
    async () =>
      createRunOutputDir(
        options.outputBaseDir,
        `${reference.owner}/${reference.repo}`,
        reference.issueNumber,
      ),
  );

  const issueSnapshotPath = path.join(outputDir, 'issue-snapshot.json');
  const issueUnderstandingPath = path.join(outputDir, 'issue-understanding.md');
  const codeInvestigationPath = path.join(outputDir, 'code-investigation.md');
  const executionPlanPath = path.join(outputDir, 'execution-plan.md');
  const reportJsonPath = path.join(outputDir, 'analysis-report.json');
  const reportMarkdownPath = path.join(outputDir, 'analysis-report.md');
  const tracePath = path.join(outputDir, 'analysis-trace.json');

  writeJsonFile(issueSnapshotPath, issueBundle);

  const model = await runStage(
    trace,
    emit,
    'build-model',
    async () =>
      buildModel(
        options.model,
        options.openaiApiType ?? 'responses',
        {
          baseURL: options.openaiBaseURL,
          apiKey: options.openaiApiKey,
          organization: options.openaiOrganization,
          project: options.openaiProject,
          providerName: options.openaiProviderName,
        },
      ),
    {
      model: options.model,
      apiType: options.openaiApiType ?? 'responses',
      baseURL: options.openaiBaseURL || 'default',
      providerName: options.openaiProviderName || 'openai',
      apiKey: maskSecret(options.openaiApiKey),
      githubToken: maskSecret(options.githubToken),
    },
  );

  const understanding = await runStage(
    trace,
    emit,
    'issue-understanding',
    async () =>
      runIssueUnderstandingMarkdownAgent({
        model,
        issueBundle,
        rootDir: options.rootDir,
        language: options.language,
      }),
    {
      issueTitleLength: issueBundle.issue.title.length,
      issueBodyLength: issueBundle.issue.body?.length ?? 0,
      commentCount: issueBundle.comments.length,
    },
    (value) => ({
      markdownLength: value.markdown.length,
      keywordCount: value.searchKeywords.length,
    }),
  );
  writeTextFile(issueUnderstandingPath, understanding.markdown);

  const extraKeywords = deriveExtraKeywords(issueBundle.issue.title);
  const evidenceCollection = await runStage(
    trace,
    emit,
    'collect-evidence',
    async () =>
      collectEvidenceFiles({
        client,
        reference,
        keywords: [...understanding.searchKeywords, ...extraKeywords],
        maxQueries: 8,
        maxFiles: 10,
        searchPerQuery: 8,
        maxCharsPerFile: 4500,
      }),
    {
      requestedKeywords: [...understanding.searchKeywords, ...extraKeywords].slice(0, 12),
    },
    (result) => ({
      queryCount: result.queries.length,
      evidenceFileCount: result.files.length,
      skippedFileCount: result.skippedFiles.length,
    }),
  );

  const investigation = await runStage(
    trace,
    emit,
    'code-investigation',
    async () =>
      runCodeInvestigationMarkdownAgent({
        model,
        issueBundle,
        understandingMarkdown: understanding.markdown,
        evidenceFiles: evidenceCollection.files,
        rootDir: options.rootDir,
        language: options.language,
      }),
    {
      evidenceFileCount: evidenceCollection.files.length,
      searchQueryCount: evidenceCollection.queries.length,
    },
    (value) => ({
      markdownLength: value.length,
    }),
  );
  writeTextFile(codeInvestigationPath, investigation);

  const plan = await runStage(
    trace,
    emit,
    'execution-plan',
    async () =>
      runExecutionPlanMarkdownAgent({
        model,
        issueBundle,
        understandingMarkdown: understanding.markdown,
        investigationMarkdown: investigation,
        rootDir: options.rootDir,
        language: options.language,
      }),
    {
      investigationLength: investigation.length,
    },
    (value) => ({
      markdownLength: value.length,
    }),
  );
  writeTextFile(executionPlanPath, plan);

  const reportMarkdown = await runStage(
    trace,
    emit,
    'report-writer',
    async () =>
      runReportWriterMarkdownAgent({
        model,
        issueBundle,
        understandingMarkdown: understanding.markdown,
        investigationMarkdown: investigation,
        planMarkdown: plan,
        artifacts: {
          issueSnapshotPath,
          reportJsonPath,
          reportMarkdownPath,
        },
        rootDir: options.rootDir,
        language: options.language,
        onTextDelta: options.reportDelta,
      }),
    {
      understandingLength: understanding.markdown.length,
      investigationLength: investigation.length,
      planLength: plan.length,
    },
    (value) => ({
      markdownLength: value.length,
    }),
  );

  await runStage(
    trace,
    emit,
    'write-report-files',
    async () => {
      writeJsonFile(reportJsonPath, {
        repository: `${reference.owner}/${reference.repo}`,
        issueNumber: reference.issueNumber,
        issueUrl: reference.issueUrl,
        generatedAt: new Date().toISOString(),
        artifacts: {
          issueSnapshotPath,
          issueUnderstandingPath,
          codeInvestigationPath,
          executionPlanPath,
          reportMarkdownPath,
        },
        searchedQueries: evidenceCollection.queries,
        skippedFiles: evidenceCollection.skippedFiles,
        reportMarkdown,
      });
      writeTextFile(reportMarkdownPath, reportMarkdown);
    },
  );
  writeJsonFile(tracePath, trace);

  return {
    outputDir,
    issueSnapshotPath,
    issueUnderstandingPath,
    codeInvestigationPath,
    executionPlanPath,
    reportJsonPath,
    reportMarkdownPath,
    tracePath,
    report: null,
    trace,
  };
}

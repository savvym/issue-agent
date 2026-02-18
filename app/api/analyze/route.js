import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { analyzeIssue } from '../../../dist/workflow/analyze-issue.js';
import { requestSchema, resolveEffectiveSettings, toApiErrorPayload } from './shared.js';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

export async function POST(request) {
  const trace = [];

  try {
    const input = requestSchema.parse(await request.json());
    const effective = resolveEffectiveSettings(input);

    if (!effective.apiKey) {
      return NextResponse.json(
        { error: 'OPENAI_API_KEY is required (from settings or server environment).' },
        { status: 400 },
      );
    }

    if (!effective.githubToken) {
      return NextResponse.json(
        { error: 'GITHUB_TOKEN is required (from settings or server environment).' },
        { status: 400 },
      );
    }

    const result = await analyzeIssue({
      issueUrl: input.issueUrl,
      repository: input.repo,
      issueNumber: input.issueNumber,
      outputBaseDir: path.resolve(process.cwd(), 'reports'),
      rootDir: process.cwd(),
      language: input.lang,
      model: input.model,
      openaiApiType: input.apiType,
      openaiBaseURL: effective.baseURL,
      openaiApiKey: effective.apiKey,
      openaiOrganization: effective.organization,
      openaiProject: effective.project,
      openaiProviderName: effective.providerName,
      githubToken: effective.githubToken,
      trace: (event) => {
        trace.push(event);
        const durationText = typeof event.durationMs === 'number' ? `${event.durationMs}ms` : '-';
        console.info('[analyze:trace]', event.stage, event.status, durationText);
      },
    });

    const markdown = await readFile(result.reportMarkdownPath, 'utf-8');

    return NextResponse.json({
      outputDir: result.outputDir,
      issueSnapshotPath: result.issueSnapshotPath,
      issueUnderstandingPath: result.issueUnderstandingPath,
      codeInvestigationPath: result.codeInvestigationPath,
      executionPlanPath: result.executionPlanPath,
      reportJsonPath: result.reportJsonPath,
      reportMarkdownPath: result.reportMarkdownPath,
      tracePath: result.tracePath,
      markdown,
      report: result.report,
      trace: result.trace,
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: error.issues.map((issue) => issue.message).join('; '), trace },
        { status: 400 },
      );
    }

    const apiError = toApiErrorPayload(error);
    if (apiError) {
      console.error('[analyze] provider error', apiError.detail);
      return NextResponse.json(
        {
          error: apiError.userMessage,
          detail: apiError.detail,
          trace,
        },
        { status: apiError.status },
      );
    }

    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: message, trace }, { status: 500 });
  }
}

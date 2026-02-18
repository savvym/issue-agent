import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { analyzeIssue } from '../../../../dist/workflow/analyze-issue.js';
import { requestSchema, resolveEffectiveSettings, toApiErrorPayload } from '../shared.js';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

function createSseChunk(event, payload) {
  return `event: ${event}\ndata: ${JSON.stringify(payload)}\n\n`;
}

export async function POST(request) {
  let parsedInput;
  try {
    parsedInput = requestSchema.parse(await request.json());
  } catch (error) {
    if (error instanceof z.ZodError) {
      return new Response(
        JSON.stringify({ error: error.issues.map((issue) => issue.message).join('; ') }),
        { status: 400, headers: { 'Content-Type': 'application/json' } },
      );
    }

    const message = error instanceof Error ? error.message : String(error);
    return new Response(JSON.stringify({ error: message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const effective = resolveEffectiveSettings(parsedInput);
  if (!effective.apiKey) {
    return new Response(
      JSON.stringify({ error: 'OPENAI_API_KEY is required (from settings or server environment).' }),
      { status: 400, headers: { 'Content-Type': 'application/json' } },
    );
  }

  if (!effective.githubToken) {
    return new Response(
      JSON.stringify({ error: 'GITHUB_TOKEN is required (from settings or server environment).' }),
      { status: 400, headers: { 'Content-Type': 'application/json' } },
    );
  }

  const encoder = new TextEncoder();
  const trace = [];
  const streamId = randomUUID();
  let fullMarkdown = '';
  let closed = false;

  const stream = new ReadableStream({
    start(controller) {
      const send = (event, payload) => {
        if (closed) {
          return;
        }

        controller.enqueue(encoder.encode(createSseChunk(event, payload)));
      };

      const finish = () => {
        if (closed) {
          return;
        }
        closed = true;
        controller.close();
      };

      send('ready', {
        runId: streamId,
        startedAt: new Date().toISOString(),
      });

      void (async () => {
        try {
          const result = await analyzeIssue({
            issueUrl: parsedInput.issueUrl,
            repository: parsedInput.repo,
            issueNumber: parsedInput.issueNumber,
            outputBaseDir: path.resolve(process.cwd(), 'reports'),
            rootDir: process.cwd(),
            language: parsedInput.lang,
            model: parsedInput.model,
            openaiApiType: parsedInput.apiType,
            openaiBaseURL: effective.baseURL,
            openaiApiKey: effective.apiKey,
            openaiOrganization: effective.organization,
            openaiProject: effective.project,
            openaiProviderName: effective.providerName,
            githubToken: effective.githubToken,
            trace: (event) => {
              trace.push(event);
              send('trace', event);
            },
            reportDelta: (delta) => {
              fullMarkdown += delta;
              send('report-delta', { delta });
            },
          });

          if (!fullMarkdown.trim()) {
            fullMarkdown = await readFile(result.reportMarkdownPath, 'utf-8');
          }

          send('result', {
            outputDir: result.outputDir,
            issueSnapshotPath: result.issueSnapshotPath,
            issueUnderstandingPath: result.issueUnderstandingPath,
            codeInvestigationPath: result.codeInvestigationPath,
            executionPlanPath: result.executionPlanPath,
            reportJsonPath: result.reportJsonPath,
            reportMarkdownPath: result.reportMarkdownPath,
            tracePath: result.tracePath,
            markdown: fullMarkdown,
            report: result.report,
            trace: result.trace,
          });
          send('done', {
            finishedAt: new Date().toISOString(),
          });
        } catch (error) {
          const apiError = toApiErrorPayload(error);
          if (apiError) {
            send('error', {
              error: apiError.userMessage,
              detail: apiError.detail,
              trace,
            });
          } else {
            const message = error instanceof Error ? error.message : String(error);
            send('error', {
              error: message,
              trace,
            });
          }
        } finally {
          finish();
        }
      })();
    },
    cancel() {
      closed = true;
    },
  });

  return new Response(stream, {
    status: 200,
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  });
}

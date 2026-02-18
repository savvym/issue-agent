#!/usr/bin/env node
import 'dotenv/config';
import path from 'node:path';
import process from 'node:process';
import { Command } from 'commander';
import { analyzeIssue, type OpenAIApiType } from './workflow/analyze-issue.js';

const program = new Command();
const defaultApiType: OpenAIApiType = process.env.OPENAI_API_TYPE === 'chat' ? 'chat' : 'responses';

program
  .name('issue-analysis-agent')
  .description('Analyze a GitHub issue and generate an implementation-ready report')
  .option('--lang <language>', 'output language, e.g. zh-CN or en-US', 'zh-CN')
  .option('--issue-url <url>', 'GitHub issue URL')
  .option('--repo <owner/repo>', 'GitHub repository, example vercel/ai')
  .option('--issue-number <number>', 'Issue number when --repo is used', (raw) => Number(raw))
  .option('--model <id>', 'OpenAI model id (provider prefix optional)', 'gpt-4.1')
  .option('--api-type <type>', 'OpenAI API type: responses | chat', defaultApiType)
  .option('--out-dir <dir>', 'Base output directory', path.resolve(process.cwd(), 'reports'))
  .parse(process.argv);

const options = program.opts<{
  issueUrl?: string;
  repo?: string;
  issueNumber?: number;
  lang: string;
  model: string;
  apiType: OpenAIApiType;
  outDir: string;
}>();

async function main(): Promise<void> {
  if (!process.env.OPENAI_API_KEY) {
    throw new Error('OPENAI_API_KEY is required.');
  }

  const githubToken = process.env.GITHUB_TOKEN || process.env.GH_TOKEN;
  if (!githubToken) {
    throw new Error('GITHUB_TOKEN (or GH_TOKEN) is required to fetch issue and code context.');
  }

  if (options.apiType !== 'responses' && options.apiType !== 'chat') {
    throw new Error(`Invalid --api-type: ${options.apiType}. Use responses or chat.`);
  }

  if (!options.issueUrl && (!options.repo || !options.issueNumber)) {
    throw new Error('Provide --issue-url OR both --repo and --issue-number.');
  }

  const result = await analyzeIssue({
    issueUrl: options.issueUrl,
    repository: options.repo,
    issueNumber: options.issueNumber,
    outputBaseDir: options.outDir,
    rootDir: process.cwd(),
    language: options.lang,
    model: options.model,
    openaiApiType: options.apiType,
    openaiBaseURL: process.env.OPENAI_BASE_URL,
    openaiApiKey: process.env.OPENAI_API_KEY,
    openaiOrganization: process.env.OPENAI_ORGANIZATION,
    openaiProject: process.env.OPENAI_PROJECT,
    openaiProviderName: process.env.OPENAI_PROVIDER_NAME,
    githubToken,
  });

  process.stdout.write(`\nAnalysis completed.\n`);
  process.stdout.write(`Output directory: ${result.outputDir}\n`);
  process.stdout.write(`Markdown report: ${result.reportMarkdownPath}\n`);
  process.stdout.write(`JSON report: ${result.reportJsonPath}\n\n`);
  process.stdout.write(`Trace file: ${result.tracePath}\n\n`);
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`Error: ${message}\n`);
  process.exitCode = 1;
});

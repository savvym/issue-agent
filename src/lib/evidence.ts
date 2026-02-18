import type { Octokit } from '@octokit/rest';
import type { IssueReference } from './github.js';
import { fetchFileContent, searchCodeInRepo } from './github.js';

export interface FileEvidenceContext {
  path: string;
  sourceQuery: string;
  url: string;
  content: string;
  truncated: boolean;
}

export interface EvidenceCollectionResult {
  files: FileEvidenceContext[];
  queries: string[];
  skippedFiles: string[];
}

interface CollectEvidenceParams {
  client: Octokit;
  reference: IssueReference;
  keywords: string[];
  maxQueries?: number;
  maxFiles?: number;
  searchPerQuery?: number;
  maxCharsPerFile?: number;
}

function normalizeKeywords(keywords: string[], maxQueries: number): string[] {
  const seen = new Set<string>();
  const normalized: string[] = [];

  for (const keyword of keywords) {
    const clean = keyword.trim();
    if (!clean) {
      continue;
    }
    const key = clean.toLowerCase();
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    normalized.push(clean);
    if (normalized.length >= maxQueries) {
      break;
    }
  }

  return normalized;
}

export async function collectEvidenceFiles(params: CollectEvidenceParams): Promise<EvidenceCollectionResult> {
  const maxQueries = params.maxQueries ?? 6;
  const maxFiles = params.maxFiles ?? 8;
  const searchPerQuery = params.searchPerQuery ?? 6;
  const maxCharsPerFile = params.maxCharsPerFile ?? 5000;
  const queries = normalizeKeywords(params.keywords, maxQueries);

  if (queries.length === 0) {
    return { files: [], queries: [], skippedFiles: [] };
  }

  const bestByPath = new Map<
    string,
    {
      path: string;
      url: string;
      score: number;
      sourceQuery: string;
    }
  >();

  for (const query of queries) {
    try {
      const results = await searchCodeInRepo(params.client, params.reference, query, searchPerQuery);
      for (const item of results) {
        const existing = bestByPath.get(item.path);
        if (!existing || item.score > existing.score) {
          bestByPath.set(item.path, {
            path: item.path,
            url: item.url,
            score: item.score,
            sourceQuery: query,
          });
        }
      }
    } catch {
      // Keep going even if one query fails due to GitHub API search limits.
    }
  }

  const ranked = [...bestByPath.values()].sort((a, b) => b.score - a.score).slice(0, maxFiles);

  const files: FileEvidenceContext[] = [];
  const skippedFiles: string[] = [];

  for (const file of ranked) {
    try {
      const content = await fetchFileContent(
        params.client,
        params.reference,
        file.path,
        'HEAD',
        maxCharsPerFile,
      );

      files.push({
        path: file.path,
        sourceQuery: file.sourceQuery,
        url: file.url,
        content: content.content,
        truncated: content.truncated,
      });
    } catch {
      skippedFiles.push(file.path);
    }
  }

  return {
    files,
    queries,
    skippedFiles,
  };
}

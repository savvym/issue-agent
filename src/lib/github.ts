import { Octokit } from '@octokit/rest';

export interface IssueReference {
  owner: string;
  repo: string;
  issueNumber: number;
  issueUrl: string;
}

export interface IssueSnapshot {
  id: number;
  number: number;
  title: string;
  state: string;
  body: string | null;
  user: string;
  labels: string[];
  assignees: string[];
  createdAt: string;
  updatedAt: string;
  comments: number;
}

export interface IssueCommentSnapshot {
  id: number;
  user: string;
  body: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface IssueBundle {
  reference: IssueReference;
  issue: IssueSnapshot;
  comments: IssueCommentSnapshot[];
}

export interface CodeSearchResult {
  name: string;
  path: string;
  sha: string;
  url: string;
  score: number;
}

export interface FileContentResult {
  path: string;
  ref: string;
  content: string;
  truncated: boolean;
}

const DEFAULT_TEXT_LIMIT = 5000;

export function createGitHubClient(token?: string): Octokit {
  return new Octokit({ auth: token });
}

export function parseIssueReference(input: {
  issueUrl?: string;
  repository?: string;
  issueNumber?: number;
}): IssueReference {
  if (input.issueUrl) {
    const match = input.issueUrl.match(
      /https?:\/\/github\.com\/([^/]+)\/([^/]+)\/issues\/(\d+)/i,
    );

    if (!match) {
      throw new Error(`Invalid issue URL: ${input.issueUrl}`);
    }

    const [, owner, repo, issueNumberRaw] = match;
    const issueNumber = Number(issueNumberRaw);

    return {
      owner,
      repo,
      issueNumber,
      issueUrl: `https://github.com/${owner}/${repo}/issues/${issueNumber}`,
    };
  }

  if (!input.repository || !input.issueNumber) {
    throw new Error('Provide either --issue-url or both --repo and --issue-number.');
  }

  const [owner, repo] = input.repository.split('/');
  if (!owner || !repo) {
    throw new Error(`Invalid repository format: ${input.repository}. Expected owner/repo.`);
  }

  return {
    owner,
    repo,
    issueNumber: input.issueNumber,
    issueUrl: `https://github.com/${owner}/${repo}/issues/${input.issueNumber}`,
  };
}

export async function fetchIssueBundle(client: Octokit, reference: IssueReference): Promise<IssueBundle> {
  const issueResponse = await client.issues.get({
    owner: reference.owner,
    repo: reference.repo,
    issue_number: reference.issueNumber,
  });

  if ('pull_request' in issueResponse.data && issueResponse.data.pull_request) {
    throw new Error(
      `Issue #${reference.issueNumber} in ${reference.owner}/${reference.repo} is a pull request, not a regular issue.`,
    );
  }

  const comments = await client.paginate(client.issues.listComments, {
    owner: reference.owner,
    repo: reference.repo,
    issue_number: reference.issueNumber,
    per_page: 100,
  });

  return {
    reference,
    issue: {
      id: issueResponse.data.id,
      number: issueResponse.data.number,
      title: issueResponse.data.title,
      state: issueResponse.data.state,
      body: issueResponse.data.body ?? null,
      user: issueResponse.data.user?.login ?? 'unknown',
      labels: issueResponse.data.labels
        .map((label) => (typeof label === 'string' ? label : label.name))
        .filter((label): label is string => Boolean(label)),
      assignees: issueResponse.data.assignees?.map((assignee) => assignee.login).filter(Boolean) ?? [],
      createdAt: issueResponse.data.created_at,
      updatedAt: issueResponse.data.updated_at,
      comments: issueResponse.data.comments,
    },
    comments: comments.map((comment) => ({
      id: comment.id,
      user: comment.user?.login ?? 'unknown',
      body: comment.body ?? null,
      createdAt: comment.created_at,
      updatedAt: comment.updated_at,
    })),
  };
}

export async function searchCodeInRepo(
  client: Octokit,
  reference: IssueReference,
  query: string,
  perPage = 8,
): Promise<CodeSearchResult[]> {
  const normalized = query.trim();
  if (!normalized) {
    return [];
  }

  const scopedQuery = `${normalized} repo:${reference.owner}/${reference.repo}`;
  const response = await client.search.code({ q: scopedQuery, per_page: perPage });

  return response.data.items.map((item) => ({
    name: item.name,
    path: item.path,
    sha: item.sha,
    url: item.html_url,
    score: item.score,
  }));
}

function sanitizeText(input: string): string {
  return input.replace(/\u0000/g, '').trim();
}

export async function fetchFileContent(
  client: Octokit,
  reference: IssueReference,
  path: string,
  targetRef = 'HEAD',
  maxChars = DEFAULT_TEXT_LIMIT,
): Promise<FileContentResult> {
  const response = await client.repos.getContent({
    owner: reference.owner,
    repo: reference.repo,
    path,
    ref: targetRef,
  });

  if (Array.isArray(response.data) || response.data.type !== 'file') {
    throw new Error(`Path is not a file: ${path}`);
  }

  if (!response.data.content) {
    throw new Error(`No file content returned for ${path}`);
  }

  const encoding = response.data.encoding;
  if (encoding !== 'base64') {
    throw new Error(`Unsupported encoding (${encoding}) for ${path}`);
  }

  const decoded = Buffer.from(response.data.content, 'base64').toString('utf-8');
  const sanitized = sanitizeText(decoded);

  if (sanitized.length <= maxChars) {
    return {
      path,
      ref: targetRef,
      content: sanitized,
      truncated: false,
    };
  }

  return {
    path,
    ref: targetRef,
    content: sanitized.slice(0, maxChars),
    truncated: true,
  };
}

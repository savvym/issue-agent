'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import {
  defaultProviderSettings,
  loadProviderSettings,
  PROVIDER_SETTINGS_STORAGE_KEY,
} from './lib/provider-settings';

const defaultForm = {
  issueUrl: '',
};

const SESSION_STORAGE_KEY = 'issue-agent.sessions.v1';
const MAX_SESSIONS = 40;
const SIDEBAR_COLLAPSED_STORAGE_KEY = 'issue-agent.sidebar-collapsed.v1';

function formatDuration(seconds) {
  if (seconds < 60) {
    return `${seconds}s`;
  }

  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return `${mins}m ${secs}s`;
}

function formatTimeLabel(value) {
  if (!value) {
    return '-';
  }

  const timestamp = new Date(value);
  if (Number.isNaN(timestamp.getTime())) {
    return value;
  }

  return timestamp.toLocaleTimeString();
}

function parseSseMessage(raw) {
  const lines = raw.split('\n');
  let event = 'message';
  const dataLines = [];

  for (const line of lines) {
    if (!line) {
      continue;
    }

    if (line.startsWith('event:')) {
      event = line.slice(6).trim();
      continue;
    }

    if (line.startsWith('data:')) {
      dataLines.push(line.slice(5).trimStart());
    }
  }

  if (dataLines.length === 0) {
    return null;
  }

  const dataText = dataLines.join('\n');
  try {
    return {
      event,
      data: JSON.parse(dataText),
    };
  } catch {
    return {
      event,
      data: dataText,
    };
  }
}

function parseIssueDescriptor(issueUrl) {
  const match = issueUrl.match(/https?:\/\/github\.com\/([^/]+)\/([^/]+)\/issues\/(\d+)/i);
  if (!match) {
    return {
      repository: '',
      issueNumber: '',
      label: issueUrl.replace(/^https?:\/\//i, ''),
      key: issueUrl,
    };
  }

  const [, owner, repo, issueNumber] = match;
  const repository = `${owner}/${repo}`;
  return {
    repository,
    issueNumber,
    label: `${repository} #${issueNumber}`,
    key: `${repository}#${issueNumber}`,
  };
}

function createSession(issueUrl) {
  const descriptor = parseIssueDescriptor(issueUrl);
  const now = new Date().toISOString();
  const id = typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}`;

  return {
    id,
    issueUrl,
    repository: descriptor.repository,
    issueNumber: descriptor.issueNumber,
    key: descriptor.key,
    label: descriptor.label,
    status: 'running',
    runId: '',
    createdAt: now,
    updatedAt: now,
    trace: [],
    markdown: '',
    result: null,
    error: '',
    errorDetail: null,
  };
}

function normalizeSession(raw) {
  if (!raw || typeof raw !== 'object') {
    return null;
  }

  const issueUrl = typeof raw.issueUrl === 'string' ? raw.issueUrl : '';
  const descriptor = parseIssueDescriptor(issueUrl);
  const status =
    raw.status === 'running' || raw.status === 'completed' || raw.status === 'failed'
      ? raw.status
      : 'completed';

  return {
    id: typeof raw.id === 'string' ? raw.id : `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    issueUrl,
    repository: typeof raw.repository === 'string' ? raw.repository : descriptor.repository,
    issueNumber: typeof raw.issueNumber === 'string' ? raw.issueNumber : descriptor.issueNumber,
    key: typeof raw.key === 'string' ? raw.key : descriptor.key,
    label: typeof raw.label === 'string' && raw.label ? raw.label : descriptor.label,
    status,
    runId: typeof raw.runId === 'string' ? raw.runId : '',
    createdAt: typeof raw.createdAt === 'string' ? raw.createdAt : new Date().toISOString(),
    updatedAt: typeof raw.updatedAt === 'string' ? raw.updatedAt : new Date().toISOString(),
    trace: Array.isArray(raw.trace) ? raw.trace : [],
    markdown: typeof raw.markdown === 'string' ? raw.markdown : '',
    result: raw.result ?? null,
    error: typeof raw.error === 'string' ? raw.error : '',
    errorDetail: raw.errorDetail ?? null,
  };
}

function loadSessions() {
  if (typeof window === 'undefined') {
    return [];
  }

  const raw = window.localStorage.getItem(SESSION_STORAGE_KEY);
  if (!raw) {
    return [];
  }

  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      return [];
    }

    return parsed
      .map(normalizeSession)
      .filter(Boolean)
      .slice(0, MAX_SESSIONS);
  } catch {
    return [];
  }
}

function SendArrowIcon() {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true" className="chat-send-icon">
      <path d="M8 12.5V3.7" />
      <path d="M4.7 7.1L8 3.7L11.3 7.1" />
    </svg>
  );
}

export default function Home() {
  const [form, setForm] = useState(defaultForm);
  const [providerSettings, setProviderSettings] = useState(defaultProviderSettings);
  const [sessions, setSessions] = useState([]);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [activeSessionId, setActiveSessionId] = useState('');
  const [runningSessionId, setRunningSessionId] = useState('');
  const [startedAt, setStartedAt] = useState(null);
  const [elapsed, setElapsed] = useState(0);

  useEffect(() => {
    const loaded = loadProviderSettings();
    setProviderSettings(loaded);
    setSessions(loadSessions());
    setSidebarCollapsed(window.localStorage.getItem(SIDEBAR_COLLAPSED_STORAGE_KEY) === '1');

    const handleStorage = (event) => {
      if (event.key === PROVIDER_SETTINGS_STORAGE_KEY) {
        setProviderSettings(loadProviderSettings());
      }
      if (event.key === SESSION_STORAGE_KEY) {
        setSessions(loadSessions());
      }
    };

    window.addEventListener('storage', handleStorage);
    return () => window.removeEventListener('storage', handleStorage);
  }, []);

  useEffect(() => {
    if (sessions.length > 0 && !activeSessionId) {
      setActiveSessionId(sessions[0].id);
    }
  }, [sessions, activeSessionId]);

  useEffect(() => {
    if (typeof window === 'undefined') {
      return;
    }

    window.localStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify(sessions.slice(0, MAX_SESSIONS)));
  }, [sessions]);

  useEffect(() => {
    if (typeof window === 'undefined') {
      return;
    }

    window.localStorage.setItem(SIDEBAR_COLLAPSED_STORAGE_KEY, sidebarCollapsed ? '1' : '0');
  }, [sidebarCollapsed]);

  useEffect(() => {
    if (!runningSessionId || !startedAt) {
      setElapsed(0);
      return;
    }

    const timer = window.setInterval(() => {
      const delta = Math.floor((Date.now() - startedAt) / 1000);
      setElapsed(delta);
    }, 1000);

    return () => window.clearInterval(timer);
  }, [runningSessionId, startedAt]);

  const activeSession = useMemo(() => {
    if (sessions.length === 0) {
      return null;
    }

    return sessions.find((session) => session.id === activeSessionId) || sessions[0];
  }, [sessions, activeSessionId]);

  const statusText = useMemo(() => {
    if (runningSessionId) {
      return `分析进行中 · ${formatDuration(elapsed)}`;
    }

    if (!activeSession) {
      return '等待开始';
    }

    if (activeSession.status === 'failed') {
      return '上次分析失败';
    }

    if (activeSession.status === 'completed') {
      return '分析完成';
    }

    return '等待开始';
  }, [runningSessionId, elapsed, activeSession]);

  const traceSummary = useMemo(() => {
    const trace = activeSession?.trace || [];
    const stageMap = new Map();

    for (const event of trace) {
      if (!event || typeof event.stage !== 'string' || !event.stage) {
        continue;
      }

      stageMap.set(event.stage, {
        stage: event.stage,
        status: event.status === 'success' || event.status === 'error' ? event.status : 'start',
      });
    }

    return {
      stageItems: Array.from(stageMap.values()),
    };
  }, [activeSession]);

  const showWelcome = !activeSession;
  const showReport = Boolean(activeSession?.markdown);
  const showFailureOnly = Boolean(activeSession?.error && !activeSession?.markdown);
  const showProgressOnly = Boolean(
    activeSession?.status === 'running' && !activeSession.markdown && !activeSession.error,
  );
  const showEmptyResult = Boolean(
    activeSession?.status === 'completed' && !activeSession.markdown && !activeSession.error,
  );

  const updateSession = (sessionId, updater) => {
    setSessions((prev) =>
      prev.map((session) => {
        if (session.id !== sessionId) {
          return session;
        }
        const next = updater(session);
        return {
          ...next,
          updatedAt: new Date().toISOString(),
        };
      }),
    );
  };

  const handleSubmit = async (event) => {
    event.preventDefault();
    if (runningSessionId) {
      return;
    }

    const issueUrl = form.issueUrl.trim();
    if (!issueUrl) {
      return;
    }

    const session = createSession(issueUrl);
    setSessions((prev) => [session, ...prev].slice(0, MAX_SESSIONS));
    setActiveSessionId(session.id);
    setRunningSessionId(session.id);
    setStartedAt(Date.now());
    setForm(defaultForm);

    try {
      const payload = {
        issueUrl,
        lang: providerSettings.language?.trim() || 'zh-CN',
        model: providerSettings.defaultModel?.trim() || 'gpt-4.1',
        apiType: providerSettings.apiType === 'chat' ? 'chat' : 'responses',
      };

      const provider = {};
      if (providerSettings.baseURL.trim()) {
        provider.baseURL = providerSettings.baseURL.trim();
      }
      if (providerSettings.apiKey.trim()) {
        provider.apiKey = providerSettings.apiKey.trim();
      }
      if (providerSettings.organization.trim()) {
        provider.organization = providerSettings.organization.trim();
      }
      if (providerSettings.project.trim()) {
        provider.project = providerSettings.project.trim();
      }
      if (providerSettings.providerName.trim()) {
        provider.name = providerSettings.providerName.trim();
      }

      if (Object.keys(provider).length > 0) {
        payload.provider = {
          type: 'openai',
          ...provider,
        };
      }

      if (providerSettings.githubToken.trim()) {
        payload.githubToken = providerSettings.githubToken.trim();
      }

      const streamResponse = await fetch('/api/analyze/stream', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      if (!streamResponse.ok || !streamResponse.body) {
        const failedData = await streamResponse.json().catch(() => null);
        updateSession(session.id, (current) => ({
          ...current,
          status: 'failed',
          error: failedData?.error || `Request failed (${streamResponse.status})`,
          errorDetail: failedData?.detail || null,
        }));
        return;
      }

      const reader = streamResponse.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let doneSignalReceived = false;

      while (true) {
        const { value, done } = await reader.read();
        if (done) {
          break;
        }

        buffer += decoder.decode(value, { stream: true });

        while (true) {
          const boundaryIndex = buffer.indexOf('\n\n');
          if (boundaryIndex < 0) {
            break;
          }

          const rawMessage = buffer.slice(0, boundaryIndex);
          buffer = buffer.slice(boundaryIndex + 2);

          const parsed = parseSseMessage(rawMessage);
          if (!parsed) {
            continue;
          }

          const { event: eventType, data } = parsed;

          if (eventType === 'ready') {
            const runId =
              data && typeof data === 'object' && typeof data.runId === 'string' ? data.runId : '';
            if (runId) {
              updateSession(session.id, (current) => ({
                ...current,
                runId,
              }));
            }
            continue;
          }

          if (eventType === 'trace') {
            updateSession(session.id, (current) => ({
              ...current,
              trace: [...current.trace, data],
            }));
            continue;
          }

          if (eventType === 'report-delta') {
            const deltaText =
              data && typeof data === 'object' && typeof data.delta === 'string' ? data.delta : '';
            if (deltaText) {
              updateSession(session.id, (current) => ({
                ...current,
                markdown: `${current.markdown}${deltaText}`,
              }));
            }
            continue;
          }

          if (eventType === 'result') {
            updateSession(session.id, (current) => ({
              ...current,
              status: 'completed',
              result: data,
              markdown:
                data && typeof data === 'object' && typeof data.markdown === 'string'
                  ? data.markdown
                  : current.markdown,
              trace:
                data && typeof data === 'object' && Array.isArray(data.trace) ? data.trace : current.trace,
            }));
            continue;
          }

          if (eventType === 'error') {
            updateSession(session.id, (current) => ({
              ...current,
              status: 'failed',
              error: data?.error || 'Analysis failed.',
              errorDetail: data?.detail || null,
              trace: Array.isArray(data?.trace) ? data.trace : current.trace,
            }));
            continue;
          }

          if (eventType === 'done') {
            doneSignalReceived = true;
            updateSession(session.id, (current) => ({
              ...current,
              status: current.status === 'running' ? 'completed' : current.status,
            }));
            break;
          }
        }

        if (doneSignalReceived) {
          break;
        }
      }
    } catch (submitError) {
      updateSession(session.id, (current) => ({
        ...current,
        status: 'failed',
        error: submitError instanceof Error ? submitError.message : String(submitError),
        errorDetail: null,
      }));
    } finally {
      setRunningSessionId('');
    }
  };

  return (
    <main className={sidebarCollapsed ? 'chat-shell chat-shell-collapsed' : 'chat-shell'}>
      <div className="chat-backdrop" aria-hidden />

      <aside className="chat-sidebar">
        <div className="chat-sidebar-top">
          <p className={sidebarCollapsed ? 'chat-brand chat-brand-mini' : 'chat-brand'}>
            {sidebarCollapsed ? 'IA' : 'Issue Agent'}
          </p>

          <div className="chat-sidebar-actions">
            {!sidebarCollapsed ? (
              <Link href="/settings" className="chat-sidebar-link">
                设置
              </Link>
            ) : null}
            <button
              type="button"
              className="chat-collapse-btn"
              onClick={() => setSidebarCollapsed((prev) => !prev)}
              aria-label={sidebarCollapsed ? '展开侧栏' : '收起侧栏'}
            >
              {sidebarCollapsed ? '>>' : '<<'}
            </button>
          </div>
        </div>

        <p className="chat-sidebar-section-title">会话</p>
        {sessions.length > 0 ? (
          <ol className="chat-session-list">
            {sessions.map((session) => (
              <li key={session.id}>
                <button
                  type="button"
                  className={session.id === activeSession?.id ? 'chat-session-item active' : 'chat-session-item'}
                  onClick={() => setActiveSessionId(session.id)}
                >
                  <span className="chat-session-heading">
                    <span className="chat-session-repo">{session.repository || 'GitHub Issue'}</span>
                    <span className="chat-session-number">
                      {session.issueNumber ? `#${session.issueNumber}` : sidebarCollapsed ? '#' : ''}
                    </span>
                  </span>
                  <span className="chat-session-url">{session.issueUrl}</span>
                  <span className="chat-session-meta">
                    <span className={`session-status-dot status-${session.status}`} />
                    <span>{formatTimeLabel(session.updatedAt)}</span>
                  </span>
                </button>
              </li>
            ))}
          </ol>
        ) : (
          <p className="chat-session-empty">还没有会话，输入一个 Issue URL 开始分析。</p>
        )}

        {showReport ? (
          <div className="chat-sidebar-composer">
            <form className="chat-sidebar-form" onSubmit={handleSubmit}>
              <input
                className="chat-sidebar-input"
                value={form.issueUrl}
                onChange={(e) => setForm({ issueUrl: e.target.value })}
                placeholder="继续分析新的 GitHub Issue URL..."
                required
              />
              <button
                className="chat-send-btn chat-send-btn-sidebar"
                type="submit"
                disabled={Boolean(runningSessionId)}
                aria-label={runningSessionId ? '分析中' : '提交分析'}
                title={runningSessionId ? '分析中' : '提交分析'}
              >
                {runningSessionId ? '…' : <SendArrowIcon />}
              </button>
            </form>
          </div>
        ) : null}
      </aside>

      <section className="chat-main">
        <header className="chat-main-topbar">
          <p className="chat-main-title">
            {activeSession?.label || 'GitHub Issue 分析'}
          </p>
          <div className="chat-main-meta">
            <span className="chat-main-status">{statusText}</span>
            {traceSummary.stageItems.length > 0 ? (
              <details className="trace-stage-details">
                <summary className="trace-stage-summary">阶段状态 · {traceSummary.stageItems.length} 项</summary>
                <ol className="trace-stage-list">
                  {traceSummary.stageItems.map((item) => (
                    <li key={item.stage} className={`trace-stage-item trace-stage-item-${item.status}`}>
                      <code>{item.stage}</code>
                      <span>
                        {item.status === 'start' ? '进行中' : item.status === 'success' ? '完成' : '失败'}
                      </span>
                    </li>
                  ))}
                </ol>
              </details>
            ) : null}
          </div>
        </header>

        <div className="chat-main-canvas">
          {showReport ? (
            <article className="chat-report">
              <div className="markdown-body">
                <ReactMarkdown
                  remarkPlugins={[remarkGfm]}
                  components={{
                    a: ({ node: _node, ...props }) => <a {...props} target="_blank" rel="noreferrer noopener" />,
                  }}
                >
                  {activeSession.markdown}
                </ReactMarkdown>
              </div>

              {activeSession.result ? (
                <details className="artifact-details artifact-details-report">
                  <summary>查看报告产物路径</summary>
                  <div className="artifacts">
                    <h3>Artifacts</h3>
                    <p>
                      Markdown: <code>{activeSession.result.reportMarkdownPath}</code>
                    </p>
                    <p>
                      JSON(meta): <code>{activeSession.result.reportJsonPath}</code>
                    </p>
                    <p>
                      Issue Understanding: <code>{activeSession.result.issueUnderstandingPath}</code>
                    </p>
                    <p>
                      Code Investigation: <code>{activeSession.result.codeInvestigationPath}</code>
                    </p>
                    <p>
                      Execution Plan: <code>{activeSession.result.executionPlanPath}</code>
                    </p>
                    {activeSession.result.tracePath ? (
                      <p>
                        Trace: <code>{activeSession.result.tracePath}</code>
                      </p>
                    ) : null}
                    <p>
                      Output Dir: <code>{activeSession.result.outputDir}</code>
                    </p>
                  </div>
                </details>
              ) : null}
            </article>
          ) : null}

          {showFailureOnly ? (
            <section className="chat-state-card">
              <p className="error-box">{activeSession.error}</p>
              {activeSession.errorDetail ? (
                <details className="error-detail" open>
                  <summary>错误详情（Provider 返回）</summary>
                  <pre>{JSON.stringify(activeSession.errorDetail, null, 2)}</pre>
                </details>
              ) : null}
            </section>
          ) : null}

          {showProgressOnly ? (
            <section className="chat-state-card chat-state-running">
              <p className="chat-state-title">正在分析 Issue</p>
              <p className="chat-state-copy">
                当前已启动代码分析流程，右侧报告会在生成过程中持续更新。
              </p>
              <div className="chat-state-pulse" aria-hidden />
            </section>
          ) : null}

          {showEmptyResult ? (
            <section className="chat-state-card">
              <p className="chat-state-title">分析已完成</p>
              <p className="chat-state-copy">未接收到 Markdown 报告正文，请重新发起一次分析。</p>
            </section>
          ) : null}

          {showWelcome ? (
            <section className="chat-empty-state">
              <p className="chat-empty-subtitle">粘贴一个 GitHub Issue URL，我会生成结构化分析报告。</p>
              <form className="chat-empty-form" onSubmit={handleSubmit}>
                <div className="chat-prompt-shell">
                  <input
                    className="chat-url-input"
                    value={form.issueUrl}
                    onChange={(e) => setForm({ issueUrl: e.target.value })}
                    placeholder="输入 GitHub Issue URL，例如 https://github.com/vercel/ai/issues/123"
                    required
                  />
                  <button
                    className="chat-send-btn"
                    type="submit"
                    disabled={Boolean(runningSessionId)}
                    aria-label={runningSessionId ? '分析中' : '提交分析'}
                    title={runningSessionId ? '分析中' : '提交分析'}
                  >
                    {runningSessionId ? '…' : <SendArrowIcon />}
                  </button>
                </div>
              </form>
            </section>
          ) : null}
        </div>

      </section>
    </main>
  );
}

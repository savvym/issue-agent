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
  repo: '',
  issueNumber: '',
  lang: 'zh-CN',
  model: 'gpt-4.1',
  apiType: 'responses',
};

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

export default function Home() {
  const [mode, setMode] = useState('url');
  const [form, setForm] = useState(defaultForm);
  const [providerSettings, setProviderSettings] = useState(defaultProviderSettings);
  const [isRunning, setIsRunning] = useState(false);
  const [activeRunId, setActiveRunId] = useState('');
  const [startedAt, setStartedAt] = useState(null);
  const [elapsed, setElapsed] = useState(0);
  const [error, setError] = useState('');
  const [errorDetail, setErrorDetail] = useState(null);
  const [trace, setTrace] = useState([]);
  const [result, setResult] = useState(null);

  useEffect(() => {
    const loaded = loadProviderSettings();
    setProviderSettings(loaded);
    setForm((prev) => ({
      ...prev,
      model: loaded.defaultModel || prev.model,
      apiType: loaded.apiType || prev.apiType,
    }));

    const handleStorage = (event) => {
      if (event.key === PROVIDER_SETTINGS_STORAGE_KEY) {
        setProviderSettings(loadProviderSettings());
      }
    };

    window.addEventListener('storage', handleStorage);
    return () => window.removeEventListener('storage', handleStorage);
  }, []);

  useEffect(() => {
    if (!isRunning || !startedAt) {
      setElapsed(0);
      return;
    }

    const timer = window.setInterval(() => {
      const delta = Math.floor((Date.now() - startedAt) / 1000);
      setElapsed(delta);
    }, 1000);

    return () => window.clearInterval(timer);
  }, [isRunning, startedAt]);

  const statusText = useMemo(() => {
    if (isRunning) {
      const suffix = activeRunId ? ` · run ${activeRunId.slice(0, 8)}` : '';
      return `分析进行中 · ${formatDuration(elapsed)}${suffix}`;
    }

    if (error) {
      return '分析失败';
    }

    if (result) {
      return '分析完成';
    }

    return '等待开始';
  }, [activeRunId, elapsed, error, isRunning, result]);

  const providerSummary = useMemo(() => {
    const base = providerSettings.baseURL || 'default';
    const keySource = providerSettings.apiKey ? 'settings key' : 'server env key';
    const githubSource = providerSettings.githubToken ? 'settings token' : 'server env token';
    return `Provider: openai-compatible · baseURL: ${base} · key: ${keySource} · github: ${githubSource}`;
  }, [providerSettings]);

  const traceSummary = useMemo(() => {
    if (trace.length === 0) {
      return null;
    }

    const startedCount = trace.filter((event) => event.status === 'start').length;
    const finishedCount = trace.filter((event) => event.status === 'success').length;
    const errorCount = trace.filter((event) => event.status === 'error').length;
    const latest = trace[trace.length - 1];
    const latestStatusText =
      latest?.status === 'start' ? '进行中' : latest?.status === 'success' ? '已完成' : '失败';

    return {
      startedCount,
      finishedCount,
      errorCount,
      latest,
      latestStatusText,
    };
  }, [trace]);

  const handleChange = (field, value) => {
    setForm((prev) => ({ ...prev, [field]: value }));
  };

  const handleSubmit = async (event) => {
    event.preventDefault();
    setError('');
    setErrorDetail(null);
    setTrace([]);
    setResult(null);
    setActiveRunId('');
    setIsRunning(true);
    setStartedAt(Date.now());

    try {
      const payload = {
        lang: form.lang.trim() || 'zh-CN',
        model: form.model.trim() || providerSettings.defaultModel || 'gpt-4.1',
        apiType: form.apiType === 'chat' ? 'chat' : 'responses',
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

      if (mode === 'url') {
        payload.issueUrl = form.issueUrl.trim();
      } else {
        payload.repo = form.repo.trim();
        payload.issueNumber = Number(form.issueNumber);
      }

      const startResponse = await fetch('/api/analyze/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      const startData = await startResponse.json().catch(() => null);
      if (!startResponse.ok) {
        setError(startData?.error || `Request failed (${startResponse.status})`);
        setErrorDetail(startData?.detail || null);
        return;
      }

      const runId = startData?.runId;
      if (!runId || typeof runId !== 'string') {
        setError('Run started but runId is missing.');
        return;
      }

      setActiveRunId(runId);

      let nextTraceIndex = 0;

      while (true) {
        const statusResponse = await fetch(
          `/api/analyze/status?runId=${encodeURIComponent(runId)}&after=${nextTraceIndex}`,
          {
            method: 'GET',
            cache: 'no-store',
          },
        );

        const statusData = await statusResponse.json().catch(() => null);
        if (!statusResponse.ok) {
          setError(statusData?.error || `Status request failed (${statusResponse.status})`);
          setErrorDetail(statusData?.detail || null);
          break;
        }

        const deltaTrace = Array.isArray(statusData?.trace) ? statusData.trace : [];
        if (deltaTrace.length > 0) {
          setTrace((prev) => [...prev, ...deltaTrace]);
        }

        nextTraceIndex =
          typeof statusData?.traceIndex === 'number' ? statusData.traceIndex : nextTraceIndex + deltaTrace.length;

        if (statusData?.status === 'completed') {
          setResult(statusData?.result || null);
          break;
        }

        if (statusData?.status === 'failed') {
          setError(statusData?.error || 'Analysis failed.');
          setErrorDetail(statusData?.detail || null);
          break;
        }

        await new Promise((resolve) => {
          window.setTimeout(resolve, 900);
        });
      }
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : String(submitError));
      setErrorDetail(null);
    } finally {
      setIsRunning(false);
    }
  };

  return (
    <main className="page-shell">
      <div className="mesh" aria-hidden />
      <section className="hero">
        <p className="kicker">Issue Intelligence Desk</p>
        <h1>GitHub Issue 分析 Agent</h1>
        <p className="subtitle">
          输入一个 Issue，自动完成问题归类、代码证据检索、根因假设和实施计划，输出可交付报告。
        </p>
      </section>

      <section className="panel">
        <div className="panel-head">
          <div className="mode-tabs" role="tablist" aria-label="Input mode">
            <button
              type="button"
              className={mode === 'url' ? 'tab active' : 'tab'}
              onClick={() => setMode('url')}
            >
              Issue URL
            </button>
            <button
              type="button"
              className={mode === 'repo' ? 'tab active' : 'tab'}
              onClick={() => setMode('repo')}
            >
              Repo + Number
            </button>
          </div>
          <span className="status-badge">{statusText}</span>
        </div>

        <p className="provider-caption">
          {providerSummary} ·{' '}
          <Link href="/settings" className="text-link">
            打开设置页
          </Link>
        </p>

        <form className="form-grid" onSubmit={handleSubmit}>
          {mode === 'url' ? (
            <label>
              <span>Issue URL</span>
              <input
                value={form.issueUrl}
                onChange={(e) => handleChange('issueUrl', e.target.value)}
                placeholder="https://github.com/vercel/ai/issues/123"
                required
              />
            </label>
          ) : (
            <>
              <label>
                <span>Repository</span>
                <input
                  value={form.repo}
                  onChange={(e) => handleChange('repo', e.target.value)}
                  placeholder="vercel/ai"
                  required
                />
              </label>
              <label>
                <span>Issue Number</span>
                <input
                  value={form.issueNumber}
                  onChange={(e) => handleChange('issueNumber', e.target.value)}
                  placeholder="123"
                  type="number"
                  min="1"
                  required
                />
              </label>
            </>
          )}

          <label>
            <span>Language</span>
            <input value={form.lang} onChange={(e) => handleChange('lang', e.target.value)} />
          </label>

          <label>
            <span>Model</span>
            <input value={form.model} onChange={(e) => handleChange('model', e.target.value)} />
          </label>

          <label>
            <span>OpenAI API Type</span>
            <select value={form.apiType} onChange={(e) => handleChange('apiType', e.target.value)}>
              <option value="responses">responses</option>
              <option value="chat">chat</option>
            </select>
          </label>

          <button className="run-btn" type="submit" disabled={isRunning}>
            {isRunning ? 'Analyzing…' : 'Run Analysis'}
          </button>
        </form>

        {error ? (
          <div className="error-stack">
            <p className="error-box">{error}</p>
            {errorDetail ? (
              <details className="error-detail" open>
                <summary>错误详情（Provider 返回）</summary>
                <pre>{JSON.stringify(errorDetail, null, 2)}</pre>
              </details>
            ) : null}
          </div>
        ) : null}
      </section>

      {trace.length > 0 ? (
        <section className="trace-shell">
          <details className="trace-disclosure">
            <summary>
              <span className="trace-title">思考过程（可展开）</span>
              <span className="trace-summary-meta">
                {traceSummary?.latest ? (
                  <span className={`trace-latest trace-latest-${traceSummary.latest.status}`}>
                    最新：{traceSummary.latest.stage} · {traceSummary.latestStatusText}
                  </span>
                ) : null}
                <span>阶段 {traceSummary?.startedCount ?? 0}</span>
                <span>完成 {traceSummary?.finishedCount ?? 0}</span>
                <span>错误 {traceSummary?.errorCount ?? 0}</span>
              </span>
            </summary>

            <article className="trace-card">
              <header className="trace-head">
                <h3>请求过程追踪</h3>
                <p>仅在你展开时展示完整阶段细节，默认保持界面简洁。</p>
              </header>

              <ol className="trace-list">
                {trace.map((event, index) => (
                  <li
                    key={`${event.stage}-${event.timestamp}-${index}`}
                    className={`trace-item trace-item-${event.status}`}
                  >
                    <div className="trace-item-main">
                      <span className={`trace-status trace-status-${event.status}`}>{event.status}</span>
                      <code>{event.stage}</code>
                    </div>
                    <div className="trace-item-meta">
                      <span>{formatTimeLabel(event.timestamp)}</span>
                      {typeof event.durationMs === 'number' ? (
                        <span>{event.durationMs}ms</span>
                      ) : (
                        <span>-</span>
                      )}
                    </div>
                    {event.detail ? <pre>{JSON.stringify(event.detail, null, 2)}</pre> : null}
                  </li>
                ))}
              </ol>
            </article>
          </details>
        </section>
      ) : null}

      {result ? (
        <section className="report-shell report-shell-single">
          <article className="report-document">
            <div className="markdown-body">
              <ReactMarkdown
                remarkPlugins={[remarkGfm]}
                components={{
                  a: ({ node: _node, ...props }) => (
                    <a {...props} target="_blank" rel="noreferrer noopener" />
                  ),
                }}
              >
                {result.markdown || ''}
              </ReactMarkdown>
            </div>

            <details className="artifact-details artifact-details-report">
              <summary>查看报告产物路径</summary>
              <div className="artifacts">
                <h3>Artifacts</h3>
                <p>
                  Markdown: <code>{result.reportMarkdownPath}</code>
                </p>
                <p>
                  JSON(meta): <code>{result.reportJsonPath}</code>
                </p>
                <p>
                  Issue Understanding: <code>{result.issueUnderstandingPath}</code>
                </p>
                <p>
                  Code Investigation: <code>{result.codeInvestigationPath}</code>
                </p>
                <p>
                  Execution Plan: <code>{result.executionPlanPath}</code>
                </p>
                {result.tracePath ? (
                  <p>
                    Trace: <code>{result.tracePath}</code>
                  </p>
                ) : null}
                <p>
                  Output Dir: <code>{result.outputDir}</code>
                </p>
              </div>
            </details>
          </article>
        </section>
      ) : null}
    </main>
  );
}

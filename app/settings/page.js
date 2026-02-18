'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import {
  defaultProviderSettings,
  loadProviderSettings,
  resetProviderSettings,
  saveProviderSettings,
} from '../lib/provider-settings';

export default function SettingsPage() {
  const [form, setForm] = useState(defaultProviderSettings);
  const [notice, setNotice] = useState('');

  useEffect(() => {
    setForm(loadProviderSettings());
  }, []);

  const keyStatus = useMemo(() => {
    if (form.apiKey.trim()) {
      return '将优先使用这里的 API Key（覆盖服务器环境变量 OPENAI_API_KEY）';
    }

    return '未填写 API Key，将使用服务器环境变量 OPENAI_API_KEY';
  }, [form.apiKey]);

  const githubTokenStatus = useMemo(() => {
    if (form.githubToken.trim()) {
      return '将优先使用这里的 GitHub Token（覆盖服务器环境变量 GITHUB_TOKEN / GH_TOKEN）';
    }

    return '未填写 GitHub Token，将使用服务器环境变量 GITHUB_TOKEN / GH_TOKEN';
  }, [form.githubToken]);

  const handleChange = (field, value) => {
    setForm((prev) => ({ ...prev, [field]: value }));
    setNotice('');
  };

  const handleSave = (event) => {
    event.preventDefault();
    const saved = saveProviderSettings(form);
    setForm(saved);
    setNotice('已保存 Provider 配置。');
  };

  const handleReset = () => {
    setForm(resetProviderSettings());
    setNotice('已恢复默认配置。');
  };

  return (
    <main className="page-shell">
      <div className="mesh" aria-hidden />

      <section className="hero settings-hero">
        <p className="kicker">Provider Control</p>
        <h1>模型 Provider 设置</h1>
        <p className="subtitle">
          你可以在这里配置 OpenAI 兼容 Provider 与 GitHub Token（Base URL、API Key、API 类型、默认模型等）。这些设置保存在当前浏览器。
        </p>
      </section>

      <section className="panel settings-panel">
        <form className="form-grid settings-grid" onSubmit={handleSave}>
          <label>
            <span>Provider</span>
            <select value={form.providerType} onChange={(e) => handleChange('providerType', e.target.value)}>
              <option value="openai">openai-compatible</option>
            </select>
          </label>

          <label>
            <span>API Type</span>
            <select value={form.apiType} onChange={(e) => handleChange('apiType', e.target.value)}>
              <option value="responses">responses (recommended)</option>
              <option value="chat">chat</option>
            </select>
          </label>

          <label>
            <span>Base URL</span>
            <input
              value={form.baseURL}
              onChange={(e) => handleChange('baseURL', e.target.value)}
              placeholder="https://api.openai.com/v1"
            />
          </label>

          <label>
            <span>Default Model</span>
            <input
              value={form.defaultModel}
              onChange={(e) => handleChange('defaultModel', e.target.value)}
              placeholder="gpt-4.1"
            />
          </label>

          <label>
            <span>API Key (optional)</span>
            <input
              type="password"
              value={form.apiKey}
              onChange={(e) => handleChange('apiKey', e.target.value)}
              placeholder="sk-..."
            />
          </label>

          <label>
            <span>Organization (optional)</span>
            <input
              value={form.organization}
              onChange={(e) => handleChange('organization', e.target.value)}
              placeholder="org_..."
            />
          </label>

          <label>
            <span>Project (optional)</span>
            <input
              value={form.project}
              onChange={(e) => handleChange('project', e.target.value)}
              placeholder="proj_..."
            />
          </label>

          <label>
            <span>Provider Name (optional)</span>
            <input
              value={form.providerName}
              onChange={(e) => handleChange('providerName', e.target.value)}
              placeholder="my-openai-proxy"
            />
          </label>

          <label>
            <span>GitHub Token (optional)</span>
            <input
              type="password"
              value={form.githubToken}
              onChange={(e) => handleChange('githubToken', e.target.value)}
              placeholder="ghp_..."
            />
          </label>

          <div className="settings-note">
            <p>{keyStatus}</p>
            <p>{githubTokenStatus}</p>
            <p>提示：Base URL 留空时将使用默认官方地址或服务器环境变量。</p>
          </div>

          <div className="settings-actions">
            <button className="run-btn" type="submit">
              保存配置
            </button>
            <button className="ghost-btn" type="button" onClick={handleReset}>
              恢复默认
            </button>
            <Link className="text-link" href="/">
              返回分析页
            </Link>
          </div>
        </form>

        {notice ? <p className="notice-box">{notice}</p> : null}
      </section>
    </main>
  );
}

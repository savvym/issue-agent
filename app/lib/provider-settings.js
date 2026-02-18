export const PROVIDER_SETTINGS_STORAGE_KEY = 'issue-agent.provider-settings.v1';

export const defaultProviderSettings = {
  providerType: 'openai',
  baseURL: '',
  apiKey: '',
  organization: '',
  project: '',
  providerName: '',
  githubToken: '',
  apiType: 'responses',
  defaultModel: 'gpt-4.1',
  language: 'zh-CN',
};

function normalizeApiType(value) {
  return value === 'chat' ? 'chat' : 'responses';
}

export function normalizeProviderSettings(raw = {}) {
  const normalizedLanguage =
    typeof raw.language === 'string' && raw.language.trim() ? raw.language.trim() : 'zh-CN';

  return {
    providerType: 'openai',
    baseURL: typeof raw.baseURL === 'string' ? raw.baseURL.trim() : '',
    apiKey: typeof raw.apiKey === 'string' ? raw.apiKey.trim() : '',
    organization: typeof raw.organization === 'string' ? raw.organization.trim() : '',
    project: typeof raw.project === 'string' ? raw.project.trim() : '',
    providerName: typeof raw.providerName === 'string' ? raw.providerName.trim() : '',
    githubToken: typeof raw.githubToken === 'string' ? raw.githubToken.trim() : '',
    apiType: normalizeApiType(raw.apiType),
    defaultModel:
      typeof raw.defaultModel === 'string' && raw.defaultModel.trim() ? raw.defaultModel.trim() : 'gpt-4.1',
    language: normalizedLanguage,
  };
}

export function loadProviderSettings() {
  if (typeof window === 'undefined') {
    return defaultProviderSettings;
  }

  const raw = window.localStorage.getItem(PROVIDER_SETTINGS_STORAGE_KEY);
  if (!raw) {
    return defaultProviderSettings;
  }

  try {
    const parsed = JSON.parse(raw);
    return normalizeProviderSettings(parsed);
  } catch {
    return defaultProviderSettings;
  }
}

export function saveProviderSettings(value) {
  const normalized = normalizeProviderSettings(value);
  if (typeof window !== 'undefined') {
    window.localStorage.setItem(PROVIDER_SETTINGS_STORAGE_KEY, JSON.stringify(normalized));
  }
  return normalized;
}

export function resetProviderSettings() {
  if (typeof window !== 'undefined') {
    window.localStorage.removeItem(PROVIDER_SETTINGS_STORAGE_KEY);
  }

  return defaultProviderSettings;
}

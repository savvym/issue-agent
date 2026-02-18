import { NoObjectGeneratedError, RetryError } from 'ai';
import { APICallError } from '@ai-sdk/provider';
import { z } from 'zod';

const defaultApiType = process.env.OPENAI_API_TYPE === 'chat' ? 'chat' : 'responses';

const providerSchema = z.object({
  type: z.enum(['openai']).default('openai'),
  baseURL: z.string().trim().optional(),
  apiKey: z.string().trim().optional(),
  organization: z.string().trim().optional(),
  project: z.string().trim().optional(),
  name: z.string().trim().optional(),
});

export const requestSchema = z
  .object({
    issueUrl: z.string().url().optional(),
    repo: z.string().regex(/^[^/]+\/[^/]+$/).optional(),
    issueNumber: z.coerce.number().int().positive().optional(),
    githubToken: z.string().trim().optional(),
    lang: z.string().trim().min(2).max(40).default('zh-CN'),
    model: z.string().trim().min(2).max(80).default('gpt-4.1'),
    apiType: z.enum(['responses', 'chat']).default(defaultApiType),
    provider: providerSchema.optional(),
  })
  .refine((value) => Boolean(value.issueUrl || (value.repo && value.issueNumber)), {
    message: 'Provide issueUrl OR repo + issueNumber',
    path: ['issueUrl'],
  });

function parseResponseBody(raw) {
  if (!raw) {
    return undefined;
  }

  try {
    const parsed = JSON.parse(raw);
    if (typeof parsed?.error?.message === 'string' && parsed.error.message.trim()) {
      return parsed.error.message.trim();
    }
    return raw.slice(0, 800);
  } catch {
    return raw.slice(0, 800);
  }
}

export function toApiErrorPayload(error) {
  if (APICallError.isInstance(error)) {
    const providerMessage = parseResponseBody(error.responseBody);
    return {
      status: error.statusCode ?? 500,
      userMessage:
        providerMessage ||
        error.message ||
        'Provider request failed. Please check model/baseURL/apiType configuration.',
      detail: {
        url: error.url,
        statusCode: error.statusCode,
        isRetryable: error.isRetryable,
        providerMessage,
      },
    };
  }

  if (NoObjectGeneratedError.isInstance(error)) {
    return {
      status: 422,
      userMessage:
        error.message ||
        'No object generated: could not parse the response. Try switching apiType/model or prompt settings.',
      detail: {
        finishReason: error.finishReason,
        generatedTextPreview: typeof error.text === 'string' ? error.text.slice(0, 1200) : undefined,
        cause: error.cause instanceof Error ? error.cause.message : undefined,
      },
    };
  }

  if (RetryError.isInstance(error)) {
    const nested = [...error.errors]
      .reverse()
      .find((item) => APICallError.isInstance(item) || NoObjectGeneratedError.isInstance(item));
    if (nested) {
      const nestedPayload = toApiErrorPayload(nested);
      return {
        ...nestedPayload,
        userMessage: `${nestedPayload.userMessage} (after ${error.errors.length} attempts)`,
        detail: {
          ...nestedPayload.detail,
          retryReason: error.reason,
          attempts: error.errors.length,
        },
      };
    }

    return {
      status: 500,
      userMessage: error.message,
      detail: {
        retryReason: error.reason,
        attempts: error.errors.length,
      },
    };
  }

  return null;
}

export function resolveEffectiveSettings(input) {
  const provider = input.provider;

  return {
    apiKey: provider?.apiKey?.trim() || process.env.OPENAI_API_KEY,
    baseURL: provider?.baseURL?.trim() || process.env.OPENAI_BASE_URL,
    organization: provider?.organization?.trim() || process.env.OPENAI_ORGANIZATION,
    project: provider?.project?.trim() || process.env.OPENAI_PROJECT,
    providerName: provider?.name?.trim() || process.env.OPENAI_PROVIDER_NAME,
    githubToken: input.githubToken?.trim() || process.env.GITHUB_TOKEN || process.env.GH_TOKEN,
  };
}

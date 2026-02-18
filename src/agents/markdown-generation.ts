import { generateText, streamText, RetryError } from 'ai';
import { APICallError } from '@ai-sdk/provider';
import type { ModelLike } from './model.js';

function includesStreamRequiredMessage(message: string | undefined): boolean {
  return Boolean(message && /stream\s+must\s+be\s+set\s+to\s+true/i.test(message));
}

function extractProviderMessage(raw: string | undefined): string | undefined {
  if (!raw) {
    return undefined;
  }

  try {
    const parsed = JSON.parse(raw);
    const value = parsed?.error?.message;
    return typeof value === 'string' ? value : raw;
  } catch {
    return raw;
  }
}

function shouldFallbackToStreaming(error: unknown): boolean {
  if (APICallError.isInstance(error)) {
    return (
      includesStreamRequiredMessage(error.message) ||
      includesStreamRequiredMessage(extractProviderMessage(error.responseBody))
    );
  }

  if (RetryError.isInstance(error)) {
    return error.errors.some((item) => shouldFallbackToStreaming(item));
  }

  if (error instanceof Error) {
    return includesStreamRequiredMessage(error.message);
  }

  return false;
}

interface GenerateMarkdownParams {
  model: ModelLike;
  system: string;
  prompt: string;
  onTextDelta?: (delta: string) => void;
}

export async function generateMarkdownText(params: GenerateMarkdownParams): Promise<string> {
  if (params.onTextDelta) {
    try {
      const streamed = streamText({
        model: params.model,
        system: params.system,
        prompt: params.prompt,
      });

      let combined = '';
      for await (const delta of streamed.textStream) {
        combined += delta;
        params.onTextDelta(delta);
      }

      return combined.trim();
    } catch (error) {
      if (!shouldFallbackToStreaming(error)) {
        // If streaming itself fails for other reasons, fallback once to non-stream.
        const fallback = await generateText({
          model: params.model,
          system: params.system,
          prompt: params.prompt,
        });
        const text = (fallback.text || '').trim();
        if (text) {
          params.onTextDelta(text);
        }
        return text;
      }
    }
  }

  try {
    const result = await generateText({
      model: params.model,
      system: params.system,
      prompt: params.prompt,
    });

    return (result.text || '').trim();
  } catch (error) {
    if (!shouldFallbackToStreaming(error)) {
      throw error;
    }

    const streamed = streamText({
      model: params.model,
      system: params.system,
      prompt: params.prompt,
    });

    const text = await streamed.text;
    return (text || '').trim();
  }
}

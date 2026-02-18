import { generateText, streamText, Output, NoObjectGeneratedError, RetryError } from 'ai';
import { APICallError } from '@ai-sdk/provider';
import type { ZodType } from 'zod';
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

interface GenerateStructuredObjectParams<T> {
  model: ModelLike;
  system: string;
  prompt: string;
  schema: ZodType<T>;
}

async function runStructured<T>({
  model,
  schema,
  system,
  prompt,
}: {
  model: ModelLike;
  schema: ZodType<T>;
  system: string;
  prompt: string;
}): Promise<T> {
  const output = Output.object({ schema });

  try {
    const result = await generateText({
      model,
      output,
      system,
      prompt,
    });

    return result.output;
  } catch (error) {
    if (!shouldFallbackToStreaming(error)) {
      throw error;
    }

    const streamed = streamText({
      model,
      output,
      system,
      prompt,
    });

    return await streamed.output;
  }
}

function extractBalancedJsonSlice(text: string, open: '{' | '[', close: '}' | ']'): string | undefined {
  const start = text.indexOf(open);
  if (start < 0) {
    return undefined;
  }

  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let idx = start; idx < text.length; idx += 1) {
    const char = text[idx];

    if (inString) {
      if (escaped) {
        escaped = false;
        continue;
      }

      if (char === '\\') {
        escaped = true;
        continue;
      }

      if (char === '"') {
        inString = false;
      }
      continue;
    }

    if (char === '"') {
      inString = true;
      continue;
    }

    if (char === open) {
      depth += 1;
      continue;
    }

    if (char === close) {
      depth -= 1;
      if (depth === 0) {
        return text.slice(start, idx + 1);
      }
    }
  }

  return undefined;
}

function buildJsonCandidates(text: string): string[] {
  const trimmed = text.trim();
  const candidates: string[] = [];

  if (trimmed) {
    candidates.push(trimmed);
  }

  const fencePattern = /```(?:json)?\s*([\s\S]*?)```/gi;
  let match: RegExpExecArray | null = fencePattern.exec(text);
  while (match) {
    const block = match[1]?.trim();
    if (block) {
      candidates.push(block);
    }
    match = fencePattern.exec(text);
  }

  const objectSlice = extractBalancedJsonSlice(text, '{', '}');
  if (objectSlice) {
    candidates.push(objectSlice.trim());
  }

  const arraySlice = extractBalancedJsonSlice(text, '[', ']');
  if (arraySlice) {
    candidates.push(arraySlice.trim());
  }

  return [...new Set(candidates)];
}

function tryRecoverFromGeneratedText<T>(schema: ZodType<T>, text: string | undefined): T | undefined {
  if (!text) {
    return undefined;
  }

  const candidates = buildJsonCandidates(text);

  for (const candidate of candidates) {
    try {
      const parsed = JSON.parse(candidate);
      const validated = schema.safeParse(parsed);
      if (validated.success) {
        return validated.data;
      }
    } catch {
      // Ignore and continue trying the next candidate.
    }
  }

  return undefined;
}

export async function generateStructuredObject<T>(
  params: GenerateStructuredObjectParams<T>,
): Promise<T> {
  try {
    return await runStructured({
      model: params.model,
      schema: params.schema,
      system: params.system,
      prompt: params.prompt,
    });
  } catch (error) {
    if (!NoObjectGeneratedError.isInstance(error)) {
      throw error;
    }

    const recovered = tryRecoverFromGeneratedText(params.schema, error.text);
    if (recovered) {
      return recovered;
    }

    const strictSystem = [
      params.system,
      'CRITICAL OUTPUT RULES:',
      '- Return ONLY raw JSON.',
      '- Do not include markdown fences.',
      '- Do not include any explanation text.',
      '- Ensure JSON is strictly valid and matches the schema.',
    ].join('\n');

    const strictPrompt = [
      params.prompt,
      '',
      'Return only a strict JSON object that matches the schema.',
    ].join('\n');

    try {
      return await runStructured({
        model: params.model,
        schema: params.schema,
        system: strictSystem,
        prompt: strictPrompt,
      });
    } catch (retryError) {
      if (NoObjectGeneratedError.isInstance(retryError)) {
        const retryRecovered = tryRecoverFromGeneratedText(params.schema, retryError.text);
        if (retryRecovered) {
          return retryRecovered;
        }
      }

      throw retryError;
    }
  }
}

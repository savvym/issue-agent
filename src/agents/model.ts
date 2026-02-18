import { generateText } from 'ai';

export type ModelLike = Parameters<typeof generateText>[0]['model'];

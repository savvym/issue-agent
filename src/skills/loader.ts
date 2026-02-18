import { readFileSync } from 'node:fs';
import path from 'node:path';

const skillCache = new Map<string, string>();

export function loadSkill(skillName: string, rootDir: string): string {
  const cacheKey = `${rootDir}:${skillName}`;
  const cached = skillCache.get(cacheKey);
  if (cached) {
    return cached;
  }

  const filePath = path.join(rootDir, 'skills', `${skillName}.md`);
  const content = readFileSync(filePath, 'utf-8').trim();
  skillCache.set(cacheKey, content);
  return content;
}

export function mergeInstructions(base: string, skillText: string): string {
  return `${base.trim()}\n\n---\nSkill Guidance:\n${skillText}`.trim();
}

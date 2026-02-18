import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

export function ensureDir(targetDir: string): void {
  mkdirSync(targetDir, { recursive: true });
}

export function timestampForFolder(now = new Date()): string {
  const yyyy = now.getFullYear();
  const mm = String(now.getMonth() + 1).padStart(2, '0');
  const dd = String(now.getDate()).padStart(2, '0');
  const hh = String(now.getHours()).padStart(2, '0');
  const min = String(now.getMinutes()).padStart(2, '0');
  const ss = String(now.getSeconds()).padStart(2, '0');
  return `${yyyy}${mm}${dd}-${hh}${min}${ss}`;
}

export function createRunOutputDir(baseDir: string, repository: string, issueNumber: number): string {
  const safeRepo = repository.replace('/', '__');
  const dir = path.join(baseDir, safeRepo, `issue-${issueNumber}`, timestampForFolder());
  ensureDir(dir);
  return dir;
}

export function writeJsonFile(targetPath: string, data: unknown): void {
  writeFileSync(targetPath, `${JSON.stringify(data, null, 2)}\n`, 'utf-8');
}

export function writeTextFile(targetPath: string, content: string): void {
  writeFileSync(targetPath, content, 'utf-8');
}

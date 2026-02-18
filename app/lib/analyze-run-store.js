import { randomUUID } from 'node:crypto';

const STORE_KEY = '__issue_agent_run_store_v1__';
const RUN_TTL_MS = 60 * 60 * 1000;
const MAX_RUN_COUNT = 60;

function getStore() {
  const globalState = globalThis;
  if (!globalState[STORE_KEY]) {
    globalState[STORE_KEY] = new Map();
  }

  return globalState[STORE_KEY];
}

function pruneStore() {
  const store = getStore();
  const now = Date.now();

  for (const [id, run] of store.entries()) {
    if (now - run.updatedAtMs > RUN_TTL_MS) {
      store.delete(id);
    }
  }

  if (store.size <= MAX_RUN_COUNT) {
    return;
  }

  const byUpdatedAt = [...store.entries()].sort((a, b) => a[1].updatedAtMs - b[1].updatedAtMs);
  const removeCount = store.size - MAX_RUN_COUNT;
  for (let index = 0; index < removeCount; index += 1) {
    const item = byUpdatedAt[index];
    if (item) {
      store.delete(item[0]);
    }
  }
}

function touchRun(run) {
  run.updatedAt = new Date().toISOString();
  run.updatedAtMs = Date.now();
}

export function createRunRecord(meta = {}) {
  pruneStore();
  const nowIso = new Date().toISOString();
  const nowMs = Date.now();

  const run = {
    id: randomUUID(),
    status: 'running',
    createdAt: nowIso,
    startedAt: nowIso,
    finishedAt: null,
    updatedAt: nowIso,
    updatedAtMs: nowMs,
    trace: [],
    result: null,
    error: '',
    detail: null,
    meta,
  };

  getStore().set(run.id, run);
  return run;
}

export function appendRunTrace(runId, event) {
  const run = getStore().get(runId);
  if (!run || run.status !== 'running') {
    return;
  }

  run.trace.push(event);
  touchRun(run);
}

export function markRunCompleted(runId, result) {
  const run = getStore().get(runId);
  if (!run) {
    return;
  }

  run.status = 'completed';
  run.result = result;
  run.error = '';
  run.detail = null;
  run.finishedAt = new Date().toISOString();
  touchRun(run);
}

export function markRunFailed(runId, error, detail = null) {
  const run = getStore().get(runId);
  if (!run) {
    return;
  }

  run.status = 'failed';
  run.result = null;
  run.error = error;
  run.detail = detail;
  run.finishedAt = new Date().toISOString();
  touchRun(run);
}

export function getRunStatus(runId, afterTraceIndex = 0) {
  pruneStore();
  const run = getStore().get(runId);
  if (!run) {
    return null;
  }

  const startIndex =
    Number.isFinite(afterTraceIndex) && afterTraceIndex > 0 ? Math.floor(afterTraceIndex) : 0;
  const traceSlice = run.trace.slice(startIndex);

  return {
    runId: run.id,
    status: run.status,
    createdAt: run.createdAt,
    startedAt: run.startedAt,
    finishedAt: run.finishedAt,
    updatedAt: run.updatedAt,
    trace: traceSlice,
    traceIndex: run.trace.length,
    result: run.status === 'completed' ? run.result : null,
    error: run.status === 'failed' ? run.error : '',
    detail: run.status === 'failed' ? run.detail : null,
    meta: run.meta,
  };
}

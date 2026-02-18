import { NextResponse } from 'next/server';
import { getRunStatus } from '../../../lib/analyze-run-store.js';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request) {
  const url = new URL(request.url);
  const runId = url.searchParams.get('runId');
  const afterRaw = url.searchParams.get('after');
  const after = afterRaw ? Number(afterRaw) : 0;

  if (!runId) {
    return NextResponse.json({ error: 'runId is required.' }, { status: 400 });
  }

  const snapshot = getRunStatus(runId, Number.isFinite(after) ? after : 0);
  if (!snapshot) {
    return NextResponse.json({ error: 'Run not found or expired.' }, { status: 404 });
  }

  return NextResponse.json(snapshot);
}

import { NextResponse } from 'next/server';
import { coreFetch } from '../_lib';
import { loadState } from '../../../../lib/pandora-kv-state.mjs';
import * as L from '../../../../core/logic.mjs';

export async function GET() {
  if (process.env.PANDORA_CORE_URL) {
    try {
      const r = await coreFetch('/graph');
      return NextResponse.json(await r.json(), { status: r.status });
    } catch {
      return NextResponse.json({ ok: false, error: 'Pandora Core non raggiungibile' }, { status: 503 });
    }
  }
  try {
    const state = await loadState();
    return NextResponse.json({ ok: true, ...L.graphSnapshot(state) });
  } catch (err: any) {
    return NextResponse.json({ ok: false, error: err?.message || 'internal_error' }, { status: 500 });
  }
}

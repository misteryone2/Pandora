import { NextResponse } from 'next/server';
import { coreFetch } from '../_lib';
import { loadState } from '../../../../lib/pandora-kv-state.mjs';

export async function GET() {
  if (process.env.PANDORA_CORE_URL) {
    try {
      const r = await coreFetch('/health');
      return NextResponse.json(await r.json(), { status: r.status });
    } catch {
      return NextResponse.json({ ok: false, mode: 'offline', error: 'Pandora Core non raggiungibile' }, { status: 503 });
    }
  }
  try {
    const state = await loadState();
    return NextResponse.json({
      ok: true, name: 'Pandora Core', version: '1.4.0', mode: 'serverless-reactive',
      autonomy: false, cycleRunning: false, queue: state.queue.length,
      note: 'In standby tra un utilizzo e l\'altro: nessun ciclo autonomo in background in questa modalità.',
      now: new Date().toISOString()
    });
  } catch (err: any) {
    return NextResponse.json({ ok: false, error: err?.message || 'internal_error' }, { status: 500 });
  }
}

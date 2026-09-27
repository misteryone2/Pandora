import { NextResponse } from 'next/server';
import { coreFetch } from '../_lib';

export async function GET() {
  if (process.env.PANDORA_CORE_URL) {
    try { const r = await coreFetch('/autonomy'); return NextResponse.json(await r.json(), { status: r.status }); }
    catch { return NextResponse.json({ ok: false, error: 'Pandora Core non raggiungibile' }, { status: 503 }); }
  }
  return NextResponse.json({ ok: true, autonomy: false, mode: 'serverless-reactive', note: 'Autonomia in background non disponibile in modalità serverless.' });
}

export async function POST(req: Request) {
  if (process.env.PANDORA_CORE_URL) {
    try {
      const body = await req.json();
      const r = await coreFetch('/autonomy', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
      return NextResponse.json(await r.json(), { status: r.status });
    } catch {
      return NextResponse.json({ ok: false, error: 'Pandora Core non raggiungibile' }, { status: 503 });
    }
  }
  return NextResponse.json({ ok: false, error: 'not_supported_in_stage1', note: 'Attiva PANDORA_CORE_URL (Fase 2/3) per l\'autonomia in background.' }, { status: 501 });
}

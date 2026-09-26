import { NextResponse } from 'next/server';
export async function GET() {
  const base = process.env.PANDORA_CORE_URL || 'http://127.0.0.1:8787';
  try { const r=await fetch(`${base}/graph`,{cache:'no-store'}); return NextResponse.json(await r.json(),{status:r.status}); }
  catch { return NextResponse.json({ok:false,error:'Pandora Core non raggiungibile'},{status:503}); }
}

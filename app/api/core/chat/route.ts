import { NextResponse } from 'next/server';
import { coreFetch } from '../_lib';
import { loadState, saveState } from '../../../../lib/pandora-kv-state.mjs';
import * as L from '../../../../core/logic.mjs';

export async function POST(req: Request) {
  const raw = await req.json().catch(() => ({}));
  const text = String(raw?.text || '').trim();
  if (!text) return NextResponse.json({ ok: false, error: 'text required' }, { status: 400 });

  // Fase 2/3 (VM sempre accesa): se PANDORA_CORE_URL è configurato, si passa
  // da lì — stesso comportamento di prima, autonomia in background inclusa.
  if (process.env.PANDORA_CORE_URL) {
    try {
      const r = await coreFetch('/chat', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ text }) });
      return NextResponse.json(await r.json(), { status: r.status });
    } catch {
      return NextResponse.json({ ok: false, error: 'Pandora Core non raggiungibile' }, { status: 503 });
    }
  }

  // Fase 1 (serverless, "standby" quando l'app è chiusa): stessa logica
  // deterministica (core/logic.mjs), stato su Vercel KV invece che su file.
  // Nessun ciclo autonomo in background: qui Pandora ragiona solo quando la
  // interpelli, non "nel sonno".
  try {
    const state = await loadState();
    state.messages.push({ id: L.id(), role: 'user', text, createdAt: L.iso() });
    L.learnAssociation(state, text);
    const result = L.localCognition(state, text);
    state.messages.push({ id: L.id(), role: 'pandora', text: result.text, createdAt: L.iso() });
    L.maybeRunMaintenance(state);
    await saveState(state);
    return NextResponse.json({
      ok: true,
      text: result.text,
      actions: result.actions,
      mode: 'deterministic-serverless',
      plan: null,
      toolResults: [],
      state: { memoryCount: state.memories.length, openTasks: L.openTasks(state).length, queue: state.queue.length }
    });
  } catch (err: any) {
    return NextResponse.json({ ok: false, error: err?.message || 'internal_error' }, { status: 500 });
  }
}

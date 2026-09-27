import Redis from 'ioredis';
import { defaultState } from '../core/logic.mjs';

// Il provider Redis collegato da Marketplace espone una singola stringa di
// connessione (REDIS_URL, es. redis://... o rediss://...), non la coppia
// URL+token in stile REST di Upstash — quindi qui usiamo un client Redis
// "classico" (ioredis) invece di @upstash/redis.
//
// Riuso il client tra invocazioni "calde" della stessa funzione serverless
// (Vercel le riutilizza quando possibile): evita di aprire una nuova
// connessione TCP a ogni richiesta.
let _client = null;
function client() {
  const url = process.env.REDIS_URL;
  if (!url) {
    throw new Error('Nessun database Redis collegato: manca la variabile REDIS_URL su Vercel.');
  }
  if (!_client) {
    _client = new Redis(url, {
      maxRetriesPerRequest: 2,
      connectTimeout: 5000,
      // Molti provider Redis su Marketplace richiedono TLS (rediss://);
      // ioredis lo attiva da solo leggendo lo schema dell'URL.
    });
    _client.on('error', () => { /* evita crash del processo su errori di rete transitori */ });
  }
  return _client;
}

const KEY = 'pandora:state';

export async function loadState() {
  const redis = client();
  const raw = await redis.get(KEY);
  const base = defaultState();
  if (!raw) return base;
  const parsed = JSON.parse(raw);
  return {
    ...base,
    ...parsed,
    autonomyStats: { ...base.autonomyStats, ...(parsed.autonomyStats || {}) },
    queue: parsed.queue || [],
    graph: { nodes: parsed.graph?.nodes || [], edges: parsed.graph?.edges || [] }
  };
}

export async function saveState(state) {
  state.updatedAt = new Date().toISOString();
  await client().set(KEY, JSON.stringify(state));
}

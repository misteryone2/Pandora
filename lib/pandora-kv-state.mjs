import { Redis } from '@upstash/redis';
import { defaultState } from '../core/logic.mjs';

// @vercel/kv is deprecated (Vercel migrated everyone to Upstash Redis via
// the Marketplace in Dec 2024). We talk to Upstash directly instead.
// Depending on how the integration was installed, Vercel injects either the
// newer UPSTASH_REDIS_REST_* names or the legacy KV_REST_API_* names kept
// for backward compatibility — support both so this doesn't break based on
// which flow was used to add the integration.
function client() {
  const url = process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN;
  if (!url || !token) {
    throw new Error('Nessun database Redis collegato: installa l\'integrazione "Upstash Redis" dal Marketplace di Vercel.');
  }
  return new Redis({ url, token });
}

const KEY = 'pandora:state';

export async function loadState() {
  const redis = client();
  const parsed = await redis.get(KEY);
  const base = defaultState();
  if (!parsed) return base;
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
  await client().set(KEY, state);
}

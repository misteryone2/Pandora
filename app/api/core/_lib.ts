// Server-only helper: forwards requests to Pandora Core, attaching the API
// key from the environment. The key never reaches the browser/phone — it
// lives only in Vercel's (or the host's) environment variables.
export function coreBase() {
  return process.env.PANDORA_CORE_URL || 'http://127.0.0.1:8787';
}

export function coreFetch(path: string, init: RequestInit = {}) {
  const key = process.env.PANDORA_API_KEY || '';
  const headers: Record<string, string> = { ...(init.headers as Record<string, string> | undefined) };
  if (key) headers['x-pandora-key'] = key;
  return fetch(`${coreBase()}${path}`, { ...init, headers, cache: 'no-store' });
}

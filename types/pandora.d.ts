// core/logic.mjs and lib/pandora-kv-state.mjs are plain JS (shared verbatim
// with the standalone Node core on the VM), so we declare them loosely here
// instead of converting them to TypeScript and forking the two runtimes.
declare module '*/core/logic.mjs' {
  const mod: any;
  export = mod;
}
declare module '*/lib/pandora-kv-state.mjs' {
  export function loadState(): Promise<any>;
  export function saveState(state: any): Promise<void>;
}

import crypto from 'node:crypto';

export const id = () => crypto.randomUUID();
export const iso = () => new Date().toISOString();
export const now = () => Date.now();

export const defaultState = () => ({
  version: 3,
  createdAt: iso(),
  updatedAt: iso(),
  autonomy: true,
  memories: [],
  tasks: [],
  goals: [],
  messages: [],
  audit: [],
  observations: [],
  learning: [],
  queue: [],
  autonomyStats: { cycles: 0, actions: 0, skipped: 0, lastCycleAt: null, lastActionAt: null },
  permissions: { safeLocal: 'auto', external: 'confirm', destructive: 'confirm' },
  graph: { nodes: [], edges: [] },
  lastMaintenanceAt: null
});

export function audit(state, type, text, meta = {}) {
  state.audit.unshift({ id: id(), type, text, createdAt: iso(), meta });
  state.audit = state.audit.slice(0, 500);
}

export function memory(state, text, category='general', confidence=.75, source='user') {
  const clean = text.trim();
  if (!clean) return null;
  const found = state.memories.find(m => m.text.toLowerCase() === clean.toLowerCase());
  if (found) { found.confidence = Math.min(1, found.confidence + .05); found.updatedAt = iso(); learnAssociation(state, clean, `m:${found.id}`, clean); return found; }
  const m = { id:id(), text:clean, category, confidence:Math.max(0, Math.min(1, confidence)), source, createdAt:iso(), updatedAt:iso() };
  state.memories.unshift(m); learnAssociation(state, clean, `m:${m.id}`, clean); return m;
}

export function task(state, title, source='user', extra={}) {
  const t = { id:id(), title:title.trim(), done:false, source, priority:Number(extra.priority || 50), dueAt:extra.dueAt || null, attempts:0, lastRunAt:null, createdAt:iso(), updatedAt:iso() };
  state.tasks.unshift(t); return t;
}

export function openTasks(state) {
  return state.tasks.filter(t => !t.done).sort((a,b) => (b.priority-a.priority) || ((a.dueAt ? Date.parse(a.dueAt) : Infinity) - (b.dueAt ? Date.parse(b.dueAt) : Infinity)));
}

export function tokenize(s) { return s.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'').split(/[^a-z0-9àèéìòù]+/i).filter(x=>x.length>2); }

export function relevantMemories(state, text, limit=8) {
  const q = new Set(tokenize(text));
  return state.memories.map(m => ({m, score: tokenize(m.text).filter(x=>q.has(x)).length + (m.category==='preferenza' ? .25 : 0)})).sort((a,b)=>b.score-a.score).slice(0,limit).filter(x=>x.score>0).map(x=>x.m);
}

// ---- Associative network (neurons/synapses) -------------------------------
// Nodes: concepts extracted from text, plus one node per consolidated memory.
// Edges: undirected, weighted connections that strengthen on co-activation
// (Hebbian-style "fire together, wire together") and decay over time.
export function slug(s) { return String(s).toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/[^a-z0-9]+/g,'-').replace(/(^-|-$)/g,''); }
export function concepts(text, limit=6) { return Array.from(new Set(tokenize(text))).filter(w=>w.length>3).slice(0,limit); }

export function getNode(state, nid, label, kind) {
  let n = state.graph.nodes.find(x => x.id === nid);
  if (!n) { n = { id:nid, label:String(label||nid).slice(0,80), kind, activation:0, createdAt:iso(), lastActiveAt:iso() }; state.graph.nodes.push(n); }
  n.activation = Math.min(1, n.activation + 0.3);
  n.lastActiveAt = iso();
  return n;
}
export function getEdge(state, a, b) {
  if (a === b) return null;
  const [x,y] = [a,b].sort();
  const eid = `${x}~${y}`;
  let e = state.graph.edges.find(x => x.id === eid);
  if (!e) { e = { id:eid, a:x, b:y, weight:0, createdAt:iso(), lastActiveAt:iso() }; state.graph.edges.push(e); }
  return e;
}
export function bond(state, a, b, amount=0.18) {
  const e = getEdge(state, a, b); if (!e) return;
  e.weight = Math.min(1, e.weight + amount);
  e.lastActiveAt = iso();
}
export function learnAssociation(state, text, anchorId=null, anchorLabel=null) {
  const cs = concepts(text);
  const ids = cs.map(c => { const cid = `c:${slug(c)}`; getNode(state, cid, c, 'concept'); return cid; });
  if (anchorId) { getNode(state, anchorId, anchorLabel || text.slice(0,60), 'memory'); ids.forEach(cid => bond(state, anchorId, cid, 0.22)); }
  for (let i=0;i<ids.length;i++) for (let j=i+1;j<ids.length;j++) bond(state, ids[i], ids[j], 0.12);
  if (state.graph.nodes.length > 400) state.graph.nodes = state.graph.nodes.sort((a,b)=>b.activation-a.activation).slice(0,400);
  if (state.graph.edges.length > 900) state.graph.edges = state.graph.edges.sort((a,b)=>b.weight-a.weight).slice(0,900);
}
export function decayGraph(state) {
  const DECAY = 0.985;
  for (const n of state.graph.nodes) n.activation = Math.max(0, n.activation * DECAY);
  for (const e of state.graph.edges) e.weight = Math.max(0, e.weight * DECAY);
  state.graph.edges = state.graph.edges.filter(e => e.weight > 0.02);
  const connected = new Set(state.graph.edges.flatMap(e => [e.a, e.b]));
  state.graph.nodes = state.graph.nodes.filter(n => n.activation > 0.01 || connected.has(n.id));
}

// ---- Queue bookkeeping (pure) ----------------------------------------------
// Actual background processing of this queue only happens where a
// long-running worker exists (the VM's autonomyCycle). In the serverless
// Stage-1 runtime these calls just keep a record; nothing drains them, which
// is fine — they're bounded by MAX_QUEUE and harmless if never processed.
const MAX_QUEUE = 1000;
export function enqueue(state, type, payload={}, priority=50, runAt=now(), source='system') {
  if (state.queue.length >= MAX_QUEUE) state.queue.pop();
  const item = { id:id(), type, payload, priority, runAt, source, attempts:0, createdAt:iso() };
  state.queue.push(item);
  state.queue.sort((a,b) => a.runAt-b.runAt || b.priority-a.priority);
  return item;
}
export function enqueueUnique(state, type, key, payload={}, priority=50, runAt=now()) {
  const exists = state.queue.some(q => q.type === type && (q.payload?.key === key || q.payload?.memoryId === payload?.memoryId || q.payload?.taskId === payload?.taskId) && q.runAt >= now()-60000);
  return exists ? null : enqueue(state, type, {...payload, key}, priority, runAt);
}
export function nextWork(state) {
  const t = now();
  return state.queue.filter(q => q.runAt <= t).sort((a,b) => b.priority-a.priority || a.runAt-b.runAt)[0] || null;
}
export function deriveTasks(state) {
  for (const t of openTasks(state).slice(0, 20)) {
    const key = `task:${t.id}`;
    const cooldown = t.lastRunAt ? now() - Date.parse(t.lastRunAt) : Infinity;
    if (cooldown >= 60000) enqueueUnique(state, 'task_review', key, { taskId:t.id }, t.priority, now());
  }
}

// ---- Deterministic reasoning (no LLM required) -----------------------------
export function localCognition(state, text) {
  const raw=text.trim(), l=raw.toLowerCase();
  const prefix = [/^ricorda(?:ti)? che\s+/i,/^preferisco\s+/i,/^mi piace\s+/i,/^non mi piace\s+/i];
  const match = prefix.find(r=>r.test(raw));
  if (match) {
    const fact=raw.replace(match,'').trim();
    if (fact) { const cat=/preferisco|piace/i.test(match.source)?'preferenza':'memoria'; const m=memory(state, fact,cat,.8); audit(state, 'memory',`Memorizzato: ${fact}`,{memoryId:m.id}); enqueueUnique(state, 'memory_review', `memory:${m.id}`, {memoryId:m.id}, 20, now()+3600000); return {text:`Memorizzato. Lo terrò presente: ${fact}`,actions:['memory']}; }
  }
  const add=/^(?:aggiungi|crea|metti)\s+(?:un[ae]?\s+)?attivit[aà]\s*:?[ ]*(.+)$/i.exec(raw);
  if(add){ const t=task(state, add[1]); audit(state, 'task',`Creata attività: ${t.title}`,{taskId:t.id}); enqueue(state, 'task_review',{taskId:t.id},t.priority,now()); return {text:`Attività aggiunta: ${t.title}`,actions:['task']}; }
  const nameMatch=/^(?:mi chiamo|il mio nome è|mi presento[,]?\s+(?:io\s+)?sono)\s+(.+?)[.!]?$/i.exec(raw);
  if(nameMatch){
    const name=nameMatch[1].trim();
    const existing=state.memories.find(m=>m.category==='identità');
    let m;
    if(existing){ existing.text=`Il nome dell'utente è ${name}`; existing.updatedAt=iso(); existing.confidence=Math.min(1,existing.confidence+.1); learnAssociation(state, existing.text, `m:${existing.id}`, existing.text); m=existing; }
    else { m=memory(state, `Il nome dell'utente è ${name}`, 'identità', .9); }
    audit(state, 'memory', `Nome registrato: ${name}`, {memoryId:m.id});
    return {text:`Piacere, ${name}! Lo ricorderò.`, actions:['memory']};
  }
  if(/cosa ricordi|cosa sai di me|memorie/i.test(l)){ const ms=state.memories.slice(0,15); return {text:ms.length?`Queste sono le memorie consolidate:\n${ms.map(m=>`• ${m.text}`).join('\n')}`:'Non ho ancora memorie consolidate.',actions:[]}; }
  if(/quante attivit[aà]|attivit[aà] aperte/i.test(l)){return {text:`Hai ${openTasks(state).length} attività aperte.`,actions:[]};}
  if(/come mi chiamo|chi sono( io)?\??$|qual[eè] il mio nome/i.test(l)){ const idm=state.memories.find(m=>m.category==='identità'); return {text: idm ? idm.text.replace(/^Il nome dell'utente è /,'Ti chiami ') + '.' : 'Non me l\'hai ancora detto — dimmi "mi chiamo..." e lo ricorderò.', actions:[]}; }
  if(/stato|come stai|cosa puoi fare/i.test(l)){return {text:`Sono Pandora Core. Ho ${state.memories.length} memorie, ${openTasks(state).length} attività aperte e autonomia ${state.autonomy?'attiva':'in pausa'}.`,actions:[]};}
  const rel=relevantMemories(state, raw);
  if (rel.length) for (const m of rel) learnAssociation(state, raw, `m:${m.id}`, m.text);
  if (/^(ciao|salve|hey|buongiorno|buonasera)\b/i.test(raw)) return {text:'Ciao! Sono qui. Dimmi cosa vuoi fare e proverò a gestirlo localmente.',actions:[]};
  if (/\b(aiut|puoi|cosa sai fare|funzion)\b/i.test(l)) return {text:'Posso conversare, ricordare informazioni, creare e completare attività, pianificare lavori locali e mantenere una memoria persistente. Se il modello locale è disponibile posso anche interpretare richieste più complesse.',actions:[]};
  if (/\b(perch[eé]|come mai|spieg)\b/i.test(l)) return {text:`Posso analizzare la richiesta localmente. ${rel.length ? `Ho trovato nella memoria elementi collegati: ${rel.map(m=>m.text).join('; ')}.` : 'Non ho trovato memorie direttamente pertinenti.'}`,actions:[]};
  if (/\b(grazie|perfetto|ok|va bene)\b/i.test(l)) return {text:'Di nulla. Possiamo continuare da qui.',actions:[]};
  if (/\b(oggi|domani|ieri|settimana|mese)\b/i.test(l)) return {text:`La richiesta riguarda un riferimento temporale. ${rel.length ? `Terrò conto anche di: ${rel.map(m=>m.text).join('; ')}.` : 'Per ora non ho abbastanza contesto locale per pianificarla in modo preciso.'}`,actions:[]};
  let reply=rel.length ? `Ho capito la richiesta. Le informazioni che posso collegare sono: ${rel.map(m=>m.text).join('; ')}.` : `Ho ricevuto: “${raw.slice(0,240)}”.`;
  reply += ' Sto rispondendo con il motore essenziale, senza un modello linguistico a interpretarlo liberamente: posso comunque ricordare fatti ("ricorda che..."), gestire attività e rispondere a domande dirette su ciò che so.';
  return {text:reply,actions:[]};
}

// ---- Graph read model -------------------------------------------------------
// Shared by the VM's /graph route and the serverless Stage-1 route, so the
// "what does the UI actually see" logic exists in exactly one place.
export function graphSnapshot(state) {
  const nodes = state.graph.nodes.slice().sort((a,b)=>b.activation-a.activation).slice(0,220).map(n=>({id:n.id,label:n.label,kind:n.kind,activation:Math.round(n.activation*100)/100}));
  const nodeIds = new Set(nodes.map(n=>n.id));
  const edges = state.graph.edges.filter(e=>nodeIds.has(e.a)&&nodeIds.has(e.b)).sort((a,b)=>b.weight-a.weight).slice(0,500).map(e=>({id:e.id,a:e.a,b:e.b,weight:Math.round(e.weight*100)/100}));
  return { nodes, edges, stats: { totalNodes: state.graph.nodes.length, totalEdges: state.graph.edges.length } };
}

// ---- Periodic maintenance, persisted (for runtimes with no live timer) ----
// The VM tracks "when was the last maintenance tick" in a module-level
// variable, fine for a process that never stops. Serverless has no such
// process, so Stage-1 persists the timestamp in state itself instead.
export function maybeRunMaintenance(state, intervalMs=300000) {
  const last = state.lastMaintenanceAt ? Date.parse(state.lastMaintenanceAt) : 0;
  if (now() - last < intervalMs) return false;
  deriveTasks(state);
  decayGraph(state);
  state.lastMaintenanceAt = iso();
  return true;
}

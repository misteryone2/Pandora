import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';

const ROOT = path.resolve(process.cwd());
const DATA = path.join(ROOT, 'data');
const DB = path.join(DATA, 'pandora.json');
const PORT = Number(process.env.PANDORA_PORT || 8787);
const HOST = process.env.PANDORA_HOST || '0.0.0.0';
const MAINTENANCE_MS = Math.max(60000, Number(process.env.PANDORA_MAINTENANCE_MS || 300000));
const MAX_STEPS = Math.max(1, Number(process.env.PANDORA_MAX_STEPS || 3));
const MAX_QUEUE = 1000;

// ---- Local LLM -----------------------------------------------------------
// Default provider is Ollama on localhost. No cloud endpoint is used.
const LLM_ENABLED = !/^(0|false|off)$/i.test(process.env.PANDORA_LLM_ENABLED || 'true');
const LLM_BASE_URL = (process.env.PANDORA_LLM_URL || 'http://127.0.0.1:11434').replace(/\/$/, '');
let LLM_MODEL = process.env.PANDORA_LLM_MODEL || 'gemma3';
const LLM_TIMEOUT_MS = Math.max(1000, Number(process.env.PANDORA_LLM_TIMEOUT_MS || 45000));
const LLM_KEEP_ALIVE = process.env.PANDORA_LLM_KEEP_ALIVE || '10m';
const LLM_TEMPERATURE = Math.max(0, Math.min(1, Number(process.env.PANDORA_LLM_TEMPERATURE || 0.1)));
const CONTEXT_MESSAGES = Math.max(4, Number(process.env.PANDORA_CONTEXT_MESSAGES || 12));
const CONTEXT_MEMORY_LIMIT = Math.max(2, Number(process.env.PANDORA_CONTEXT_MEMORIES || 8));
const CONTEXT_CHARS = Math.max(4000, Number(process.env.PANDORA_CONTEXT_CHARS || 16000));
const LLM_MAX_OUTPUT = Math.max(128, Number(process.env.PANDORA_LLM_MAX_OUTPUT || 900));
const LLM_FAILURE_COOLDOWN_MS = 30000;
let llmFailureUntil = 0;
let llmLast = { ok:false, model:LLM_MODEL, latencyMs:null, error:null, at:null, calls:0, failures:0 };
const PLANNER_SCHEMA = {
  type:'object',
  additionalProperties:false,
  properties:{
    intent:{type:'string'},
    reply:{type:'string'},
    confidence:{type:'number'},
    remember:{type:'array',items:{type:'object',additionalProperties:false,properties:{text:{type:'string'},category:{type:'string'},confidence:{type:'number'}},required:['text','category','confidence']}},
    actions:{type:'array',items:{type:'object',additionalProperties:false,properties:{tool:{type:'string',enum:['respond','remember','create_task','complete_task','enqueue']},args:{type:'object'},reason:{type:'string'}},required:['tool','args','reason']}}
  },
  required:['intent','reply','confidence','remember','actions']
};
const id = () => crypto.randomUUID();
const iso = () => new Date().toISOString();
const now = () => Date.now();

const defaultState = () => ({
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
  graph: { nodes: [], edges: [] }
});

async function load() {
  await fs.mkdir(DATA, { recursive: true });
  try {
    const parsed = JSON.parse(await fs.readFile(DB, 'utf8'));
    return { ...defaultState(), ...parsed, autonomyStats: { ...defaultState().autonomyStats, ...(parsed.autonomyStats || {}) }, queue: parsed.queue || [], graph: { nodes: parsed.graph?.nodes || [], edges: parsed.graph?.edges || [] } };
  } catch {
    const s = defaultState(); await save(s); return s;
  }
}
let saving = Promise.resolve();
let state = await load();
function save(s = state) {
  s.updatedAt = iso();
  const snapshot = JSON.stringify(s, null, 2);
  saving = saving.then(async () => {
    const tmp = `${DB}.tmp`;
    await fs.writeFile(tmp, snapshot);
    await fs.rename(tmp, DB);
  });
  return saving;
}
function audit(type, text, meta = {}) {
  state.audit.unshift({ id: id(), type, text, createdAt: iso(), meta });
  state.audit = state.audit.slice(0, 500);
}
function memory(text, category='general', confidence=.75, source='user') {
  const clean = text.trim();
  if (!clean) return null;
  const found = state.memories.find(m => m.text.toLowerCase() === clean.toLowerCase());
  if (found) { found.confidence = Math.min(1, found.confidence + .05); found.updatedAt = iso(); learnAssociation(clean, `m:${found.id}`, clean); return found; }
  const m = { id:id(), text:clean, category, confidence:Math.max(0, Math.min(1, confidence)), source, createdAt:iso(), updatedAt:iso() };
  state.memories.unshift(m); learnAssociation(clean, `m:${m.id}`, clean); return m;
}
function task(title, source='user', extra={}) {
  const t = { id:id(), title:title.trim(), done:false, source, priority:Number(extra.priority || 50), dueAt:extra.dueAt || null, attempts:0, lastRunAt:null, createdAt:iso(), updatedAt:iso() };
  state.tasks.unshift(t); return t;
}
function tokenize(s) { return s.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'').split(/[^a-z0-9àèéìòù]+/i).filter(x=>x.length>2); }
function relevantMemories(text, limit=8) {
  const q = new Set(tokenize(text));
  return state.memories.map(m => ({m, score: tokenize(m.text).filter(x=>q.has(x)).length + (m.category==='preferenza' ? .25 : 0)})).sort((a,b)=>b.score-a.score).slice(0,limit).filter(x=>x.score>0).map(x=>x.m);
}

// ---- Associative network (neurons/synapses) -------------------------------
// Nodes: concepts extracted from text, plus one node per consolidated memory.
// Edges: undirected, weighted connections that strengthen on co-activation
// (Hebbian-style "fire together, wire together") and decay over time.
function slug(s) { return String(s).toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/[^a-z0-9]+/g,'-').replace(/(^-|-$)/g,''); }
function concepts(text, limit=6) { return Array.from(new Set(tokenize(text))).filter(w=>w.length>3).slice(0,limit); }
function getNode(nid, label, kind) {
  let n = state.graph.nodes.find(x => x.id === nid);
  if (!n) { n = { id:nid, label:String(label||nid).slice(0,80), kind, activation:0, createdAt:iso(), lastActiveAt:iso() }; state.graph.nodes.push(n); }
  n.activation = Math.min(1, n.activation + 0.3);
  n.lastActiveAt = iso();
  return n;
}
function getEdge(a, b) {
  if (a === b) return null;
  const [x,y] = [a,b].sort();
  const eid = `${x}~${y}`;
  let e = state.graph.edges.find(x => x.id === eid);
  if (!e) { e = { id:eid, a:x, b:y, weight:0, createdAt:iso(), lastActiveAt:iso() }; state.graph.edges.push(e); }
  return e;
}
function bond(a, b, amount=0.18) {
  const e = getEdge(a, b); if (!e) return;
  e.weight = Math.min(1, e.weight + amount);
  e.lastActiveAt = iso();
}
function learnAssociation(text, anchorId=null, anchorLabel=null) {
  const cs = concepts(text);
  const ids = cs.map(c => { const cid = `c:${slug(c)}`; getNode(cid, c, 'concept'); return cid; });
  if (anchorId) { getNode(anchorId, anchorLabel || text.slice(0,60), 'memory'); ids.forEach(cid => bond(anchorId, cid, 0.22)); }
  for (let i=0;i<ids.length;i++) for (let j=i+1;j<ids.length;j++) bond(ids[i], ids[j], 0.12);
  if (state.graph.nodes.length > 400) state.graph.nodes = state.graph.nodes.sort((a,b)=>b.activation-a.activation).slice(0,400);
  if (state.graph.edges.length > 900) state.graph.edges = state.graph.edges.sort((a,b)=>b.weight-a.weight).slice(0,900);
}
function decayGraph() {
  const DECAY = 0.985;
  for (const n of state.graph.nodes) n.activation = Math.max(0, n.activation * DECAY);
  for (const e of state.graph.edges) e.weight = Math.max(0, e.weight * DECAY);
  state.graph.edges = state.graph.edges.filter(e => e.weight > 0.02);
  const connected = new Set(state.graph.edges.flatMap(e => [e.a, e.b]));
  state.graph.nodes = state.graph.nodes.filter(n => n.activation > 0.01 || connected.has(n.id));
}

// ---- Local LLM adapter ----------------------------------------------------
function clampText(s, n) { return String(s || '').slice(0, n); }
function contextFor(text) {
  const memories = relevantMemories(text, CONTEXT_MEMORY_LIMIT).map(m => ({id:m.id,text:m.text,category:m.category,confidence:m.confidence}));
  const recent = state.messages.slice(0, CONTEXT_MESSAGES).reverse().map(m => ({role:m.role,content:clampText(m.text,900)}));
  const goals = state.goals.slice(0,8).map(g => ({id:g.id,title:g.title,status:g.status || 'active'}));
  const tasks = openTasks().slice(0,8).map(t => ({id:t.id,title:t.title,priority:t.priority,dueAt:t.dueAt}));
  const ctx = {memories,recent,goals,tasks,autonomy:state.autonomy};
  let raw=JSON.stringify(ctx);
  if(raw.length>CONTEXT_CHARS) raw=raw.slice(0,CONTEXT_CHARS);
  return raw;
}

function plannerSystem() {
  return `Sei il cervello locale di Pandora. Devi produrre SOLO JSON conforme allo schema fornito.\n`+
    `Non inventare fatti. Usa la memoria fornita come contesto, non come verità assoluta.\n`+
    `Puoi proporre solo questi strumenti: respond, remember, create_task, complete_task, enqueue.\n`+
    `Non eseguire direttamente azioni esterne, acquisti, cancellazioni o accessi a credenziali.\n`+
    `Per richieste conversazionali usa reply e tool respond. Per informazioni stabili utili nel futuro usa remember. `+
    `Per attività usa create_task. Usa complete_task solo se l'utente indica chiaramente che un'attività è completata.\n`+
    `Se non sei sicuro, actions deve essere vuoto e confidence bassa.`;
}

async function fetchWithTimeout(url, options={}) {
  const controller = new AbortController();
  const timer=setTimeout(()=>controller.abort(), LLM_TIMEOUT_MS);
  try { return await fetch(url,{...options,signal:controller.signal}); }
  finally { clearTimeout(timer); }
}

async function listLocalModels() {
  try {
    const r=await fetchWithTimeout(`${LLM_BASE_URL}/api/tags`,{headers:{accept:'application/json'}});
    if(!r.ok) throw new Error(`LLM models HTTP ${r.status}`);
    const j=await r.json();
    return (j.models||[]).map(m=>({name:m.name,size:m.size,parameterSize:m.details?.parameter_size,quantization:m.details?.quantization_level,family:m.details?.family}));
  } catch { return []; }
}

async function localLLM(messages, schema=PLANNER_SCHEMA, model=LLM_MODEL) {
  if(!LLM_ENABLED || now()<llmFailureUntil) throw new Error('local_llm_unavailable');
  const started=now(); llmLast.calls++;
  const r=await fetchWithTimeout(`${LLM_BASE_URL}/api/chat`,{
    method:'POST', headers:{'content-type':'application/json','accept':'application/json'},
    body:JSON.stringify({model,messages,stream:false,format:schema,options:{temperature:LLM_TEMPERATURE,num_predict:LLM_MAX_OUTPUT},keep_alive:LLM_KEEP_ALIVE})
  });
  if(!r.ok) { const t=await r.text(); throw new Error(`LLM HTTP ${r.status}: ${t.slice(0,200)}`); }
  const j=await r.json();
  const content=j?.message?.content;
  if(typeof content!=='string') throw new Error('LLM missing structured content');
  let parsed; try { parsed=JSON.parse(content); } catch { throw new Error('LLM invalid JSON'); }
  llmLast={...llmLast,ok:true,model:j.model||model,latencyMs:now()-started,error:null,at:iso()};
  return parsed;
}

function validatePlan(plan) {
  if(!plan || typeof plan!=='object') throw new Error('invalid_plan');
  const safe={intent:clampText(plan.intent,120),reply:clampText(plan.reply,4000),confidence:Math.max(0,Math.min(1,Number(plan.confidence)||0)),remember:[],actions:[]};
  if(Array.isArray(plan.remember)) for(const x of plan.remember.slice(0,4)) if(typeof x?.text==='string'&&x.text.trim()) safe.remember.push({text:x.text.trim().slice(0,500),category:clampText(x.category||'general',60),confidence:Math.max(0,Math.min(1,Number(x.confidence)||0.7))});
  const allowed=new Set(['respond','remember','create_task','complete_task','enqueue']);
  if(Array.isArray(plan.actions)) for(const a of plan.actions.slice(0,6)) if(allowed.has(a?.tool)) safe.actions.push({tool:a.tool,args:(a.args&&typeof a.args==='object')?a.args:{},reason:clampText(a.reason,300)});
  return safe;
}

async function llmPlan(text, mode='chat') {
  const messages=[
    {role:'system',content:plannerSystem()},
    {role:'system',content:`CONTESTO LOCALE:\n${contextFor(text)}`},
    {role:'user',content:`MODALITA: ${mode}\nRICHIESTA:\n${clampText(text,4000)}`}
  ];
  const plan=validatePlan(await localLLM(messages));
  if(!plan.actions.some(a=>a.tool==='respond')) plan.actions.unshift({tool:'respond',args:{},reason:'Risposta conversazionale'});
  return plan;
}

function applyPlan(plan, source='llm') {
  const results=[];
  for(const m of plan.remember) { const mem=memory(m.text,m.category,m.confidence,source); if(mem) { results.push({tool:'remember',id:mem.id}); enqueueUnique('memory_review',`memory:${mem.id}`,{memoryId:mem.id},20,now()+3600000); } }
  for(const a of plan.actions) {
    try {
      if(a.tool==='respond') results.push({tool:'respond'});
      else if(a.tool==='remember' && a.args?.text) { const m=memory(String(a.args.text),String(a.args.category||'general'),Number(a.args.confidence||.7),source); results.push({tool:'remember',id:m?.id}); }
      else if(a.tool==='create_task' && a.args?.title) { const t=task(String(a.args.title),source,{priority:a.args.priority,dueAt:a.args.dueAt}); enqueue('task_review',{taskId:t.id},t.priority,now()); results.push({tool:'create_task',id:t.id}); }
      else if(a.tool==='complete_task' && a.args?.taskId) { const t=state.tasks.find(x=>x.id===String(a.args.taskId)); if(t){t.done=true;t.updatedAt=iso();results.push({tool:'complete_task',id:t.id});} }
      else if(a.tool==='enqueue' && a.args?.type) { const safeType=String(a.args.type); if(['task_review','memory_review','system_wake'].includes(safeType)) { enqueue(safeType,a.args.payload||{},Number(a.args.priority||30),Number(a.args.runAt||now()),source); results.push({tool:'enqueue',type:safeType}); } }
    } catch(err) { audit('error',`Planner tool ${a.tool}: ${err.message}`); }
  }
  return results;
}

async function think(text, mode='chat') {
  try {
    const plan=await llmPlan(text,mode);
    const toolResults=applyPlan(plan,'local-llm');
    return {ok:true,plan,toolResults,mode:'local-llm',model:LLM_MODEL};
  } catch(err) {
    llmLast={...llmLast,ok:false,error:err.message,at:iso(),failures:llmLast.failures+1};
    llmFailureUntil=now()+LLM_FAILURE_COOLDOWN_MS;
    audit('llm_fallback',`LLM locale non disponibile: ${err.message}`);
    return {ok:false,error:err.message,plan:null,toolResults:[],mode:'deterministic'};
  }
}

// ---- Autonomous engine ---------------------------------------------------
function enqueue(type, payload={}, priority=50, runAt=now(), source='system') {
  if (state.queue.length >= MAX_QUEUE) state.queue.pop();
  const item = { id:id(), type, payload, priority, runAt, source, attempts:0, createdAt:iso() };
  state.queue.push(item);
  state.queue.sort((a,b) => a.runAt-b.runAt || b.priority-a.priority);
  wakeScheduler();
  return item;
}
function enqueueUnique(type, key, payload={}, priority=50, runAt=now()) {
  const exists = state.queue.some(q => q.type === type && (q.payload?.key === key || q.payload?.memoryId === payload?.memoryId || q.payload?.taskId === payload?.taskId) && q.runAt >= now()-60000);
  return exists ? null : enqueue(type, {...payload, key}, priority, runAt);
}
function nextWork() {
  const t = now();
  return state.queue.filter(q => q.runAt <= t).sort((a,b) => b.priority-a.priority || a.runAt-b.runAt)[0] || null;
}
function openTasks() {
  return state.tasks.filter(t => !t.done).sort((a,b) => (b.priority-a.priority) || ((a.dueAt ? Date.parse(a.dueAt) : Infinity) - (b.dueAt ? Date.parse(b.dueAt) : Infinity)));
}
function deriveTasks() {
  // Requeue only meaningful work; no busy-looping.
  for (const t of openTasks().slice(0, 20)) {
    const key = `task:${t.id}`;
    const cooldown = t.lastRunAt ? now() - Date.parse(t.lastRunAt) : Infinity;
    if (cooldown >= 60000) enqueueUnique('task_review', key, { taskId:t.id }, t.priority, now());
  }
}
function localCognition(text) {
  const raw=text.trim(), l=raw.toLowerCase();
  const prefix = [/^ricorda(?:ti)? che\s+/i,/^preferisco\s+/i,/^mi piace\s+/i,/^non mi piace\s+/i];
  const match = prefix.find(r=>r.test(raw));
  if (match) {
    const fact=raw.replace(match,'').trim();
    if (fact) { const cat=/preferisco|piace/i.test(match.source)?'preferenza':'memoria'; const m=memory(fact,cat,.8); audit('memory',`Memorizzato: ${fact}`,{memoryId:m.id}); enqueueUnique('memory_review', `memory:${m.id}`, {memoryId:m.id}, 20, now()+3600000); return {text:`Memorizzato. Lo terrò presente: ${fact}`,actions:['memory']}; }
  }
  const add=/^(?:aggiungi|crea|metti)\s+(?:un[ae]?\s+)?attivit[aà]\s*:?[ ]*(.+)$/i.exec(raw);
  if(add){ const t=task(add[1]); audit('task',`Creata attività: ${t.title}`,{taskId:t.id}); enqueue('task_review',{taskId:t.id},t.priority,now()); return {text:`Attività aggiunta: ${t.title}`,actions:['task']}; }
  if(/cosa ricordi|cosa sai di me|memorie/i.test(l)){ const ms=state.memories.slice(0,15); return {text:ms.length?`Queste sono le memorie consolidate:\n${ms.map(m=>`• ${m.text}`).join('\n')}`:'Non ho ancora memorie consolidate.',actions:[]}; }
  if(/quante attivit[aà]|attivit[aà] aperte/i.test(l)){return {text:`Hai ${openTasks().length} attività aperte.`,actions:[]};}
  if(/stato|come stai|cosa puoi fare/i.test(l)){return {text:`Sono Pandora Core, locale. Ho ${state.memories.length} memorie, ${openTasks().length} attività aperte e autonomia ${state.autonomy?'attiva':'in pausa'}. Il ciclo autonomo è ${state.autonomy?'operativo':'sospeso'}.`,actions:[]};}
  const rel=relevantMemories(raw);
  if (rel.length) for (const m of rel) learnAssociation(raw, `m:${m.id}`, m.text);
  if (/^(ciao|salve|hey|buongiorno|buonasera)\b/i.test(raw)) return {text:'Ciao! Sono qui. Dimmi cosa vuoi fare e proverò a gestirlo localmente.',actions:[]};
  if (/\b(aiut|puoi|cosa sai fare|funzion)\b/i.test(l)) return {text:'Posso conversare, ricordare informazioni, creare e completare attività, pianificare lavori locali e mantenere una memoria persistente. Se il modello locale è disponibile posso anche interpretare richieste più complesse.',actions:[]};
  if (/\b(perch[eé]|come mai|spieg)\b/i.test(l)) return {text:`Posso analizzare la richiesta localmente. ${rel.length ? `Ho trovato nella memoria elementi collegati: ${rel.map(m=>m.text).join('; ')}.` : 'Non ho trovato memorie direttamente pertinenti.'}`,actions:[]};
  if (/\b(grazie|perfetto|ok|va bene)\b/i.test(l)) return {text:'Di nulla. Possiamo continuare da qui.',actions:[]};
  if (/\b(oggi|domani|ieri|settimana|mese)\b/i.test(l)) return {text:`La richiesta riguarda un riferimento temporale. ${rel.length ? `Terrò conto anche di: ${rel.map(m=>m.text).join('; ')}.` : 'Per ora non ho abbastanza contesto locale per pianificarla in modo preciso.'}`,actions:[]};
  let reply=rel.length ? `Ho capito la richiesta. Le informazioni che posso collegare sono: ${rel.map(m=>m.text).join('; ')}.` : `Ho ricevuto: “${raw.slice(0,240)}”.`;
  reply += ' Il cervello locale non è disponibile in questo momento, quindi non invento una risposta: posso comunque registrare memoria, attività e lavori sicuri.';
  return {text:reply,actions:[]};
}

async function executeWork(item) {
  if (item.type === 'llm_plan') {
    const prompt=String(item.payload?.text||'').trim();
    if(!prompt) return {status:'noop'};
    const thought=await think(prompt,'autonomous');
    if(thought.ok) {
      state.observations.unshift({id:id(),type:'llm_plan',text:`Piano locale generato per: ${prompt.slice(0,160)}`,createdAt:iso(),meta:{model:thought.model,confidence:thought.plan.confidence}});
      state.observations=state.observations.slice(0,300);
      state.autonomyStats.actions++; state.autonomyStats.lastActionAt=iso();
      return {status:'acted',action:'llm_plan',plan:thought.plan};
    }
    return {status:'fallback'};
  }
  if (item.type === 'task_review') {
    const t = state.tasks.find(x => x.id === item.payload.taskId);
    if (!t || t.done) return {status:'noop'};
    t.attempts = (t.attempts || 0) + 1; t.lastRunAt = iso(); t.updatedAt = iso();
    const due = t.dueAt ? Date.parse(t.dueAt) <= now() : false;
    state.observations.unshift({id:id(),type:'task_review',text:`Attività analizzata: ${t.title}`,createdAt:iso(),meta:{taskId:t.id,due}});
    state.observations = state.observations.slice(0,300);
    // Safe autonomous action: surface due work and schedule the next review.
    if (due) audit('autonomy',`Attività in scadenza: ${t.title}`,{taskId:t.id});
    enqueueUnique('task_review',`task:${t.id}`,{taskId:t.id},Math.max(1,t.priority-10),now()+300000);
    state.autonomyStats.actions++;
    state.autonomyStats.lastActionAt=iso();
    return {status:'acted',action:'review_task',taskId:t.id};
  }
  if (item.type === 'memory_review') {
    const m = state.memories.find(x=>x.id===item.payload.memoryId);
    if (!m) return {status:'noop'};
    // Consolidation is local and deterministic: reinforce repeatedly useful memories.
    const uses = state.messages.reduce((n,msg)=> n + (relevantMemories(msg.text,20).some(x=>x.id===m.id)?1:0), 0);
    if (uses > 2) m.confidence=Math.min(1,m.confidence+0.02);
    m.updatedAt=iso();
    audit('learning',`Riesaminata memoria: ${m.text}`,{memoryId:m.id,uses});
    state.autonomyStats.actions++; state.autonomyStats.lastActionAt=iso();
    return {status:'acted',action:'review_memory',memoryId:m.id};
  }
  return {status:'noop'};
}

let cycleRunning = false;
let schedulerTimer = null;
let maintenanceAt = now() + MAINTENANCE_MS;

function wakeScheduler() {
  if (schedulerTimer) clearTimeout(schedulerTimer);
  schedulerTimer = setTimeout(() => { schedulerTimer = null; autonomyCycle().catch(err => audit('error', `Ciclo autonomo: ${err.message}`)); }, 0);
  schedulerTimer.unref();
}

function scheduleNextWake() {
  if (schedulerTimer) clearTimeout(schedulerTimer);
  if (!state.autonomy) return;
  const current = now();
  const ready = state.queue.some(q => q.runAt <= current);
  const due = state.queue.filter(q => q.runAt > current).sort((a,b) => a.runAt-b.runAt)[0]?.runAt;
  const target = ready ? current : Math.min(due ?? Infinity, maintenanceAt);
  const delay = Number.isFinite(target) ? Math.max(50, target-now()) : MAINTENANCE_MS;
  schedulerTimer = setTimeout(() => { schedulerTimer=null; autonomyCycle().catch(err=>audit('error',`Ciclo autonomo: ${err.message}`)); }, delay);
  schedulerTimer.unref();
}

async function autonomyCycle() {
  if (cycleRunning || !state.autonomy) return;
  cycleRunning = true;
  try {
    state.autonomyStats.cycles++;
    state.autonomyStats.lastCycleAt=iso();
    if (now() >= maintenanceAt) { deriveTasks(); decayGraph(); maintenanceAt = now() + MAINTENANCE_MS; }
    let steps=0, changed=false;
    while (steps < MAX_STEPS) {
      const item=nextWork();
      if(!item) break;
      state.queue = state.queue.filter(q=>q.id!==item.id);
      item.attempts++;
      try {
        const result=await executeWork(item);
        if(result.status==='acted') changed=true;
      } catch (err) {
        audit('error',`Azione autonoma fallita: ${err.message}`,{jobId:item.id,type:item.type});
        if(item.attempts < 3) enqueue(item.type,item.payload,Math.max(1,item.priority-10),now()+Math.min(900000,30000*2**item.attempts),'retry');
        else state.autonomyStats.skipped++;
      }
      steps++;
    }
    if(changed || steps>0) await save();
    scheduleNextWake();
  } finally { cycleRunning=false; }
}

function respond(res,body,status=200) {
  const b=JSON.stringify(body);
  res.writeHead(status,{
    'Content-Type':'application/json; charset=utf-8',
    'Content-Length':Buffer.byteLength(b),
    'Access-Control-Allow-Origin':'*',
    'Access-Control-Allow-Headers':'Content-Type',
    'Access-Control-Allow-Methods':'GET,POST,OPTIONS'
  });
  res.end(b);
}
async function body(req){let d=''; for await(const c of req)d+=c; return d?JSON.parse(d):{};}
async function handle(req,res){
  if(req.method==='OPTIONS'){res.writeHead(204,{'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'Content-Type','Access-Control-Allow-Methods':'GET,POST,OPTIONS'});return res.end();}
  try{
    const u=new URL(req.url,`http://${req.headers.host||'localhost'}`); const p=u.pathname;
    if(req.method==='GET'&&p==='/health') return respond(res,{ok:true,name:'Pandora Core',version:'1.4.0',mode:'local-autonomous',autonomy:state.autonomy,cycleRunning,queue:state.queue.length,stats:state.autonomyStats,now:iso()});
    if(req.method==='GET'&&p==='/state') return respond(res,{ok:true,state});
    if(req.method==='GET'&&p==='/graph'){
      const nodes=state.graph.nodes.slice().sort((a,b)=>b.activation-a.activation).slice(0,220).map(n=>({id:n.id,label:n.label,kind:n.kind,activation:Math.round(n.activation*100)/100}));
      const nodeIds=new Set(nodes.map(n=>n.id));
      const edges=state.graph.edges.filter(e=>nodeIds.has(e.a)&&nodeIds.has(e.b)).sort((a,b)=>b.weight-a.weight).slice(0,500).map(e=>({id:e.id,a:e.a,b:e.b,weight:Math.round(e.weight*100)/100}));
      return respond(res,{ok:true,nodes,edges,stats:{totalNodes:state.graph.nodes.length,totalEdges:state.graph.edges.length}});
    }
    if(req.method==='GET'&&p==='/llm/status') return respond(res,{ok:true,enabled:LLM_ENABLED,provider:'ollama-local',baseUrl:LLM_BASE_URL,selectedModel:LLM_MODEL,available:llmLast.ok,stats:llmLast});
    if(req.method==='GET'&&p==='/llm/models') return respond(res,{ok:true,provider:'ollama-local',selectedModel:LLM_MODEL,models:await listLocalModels()});
    if(req.method==='POST'&&p==='/llm/select'){const b=await body(req);const model=String(b.model||'').trim();if(!model)throw new Error('model required');const models=await listLocalModels();if(!models.some(m=>m.name===model))throw new Error('model_not_installed');LLM_MODEL=model;llmLast={...llmLast,model,ok:false,error:null};audit('system',`Modello locale selezionato: ${model}`);await save();return respond(res,{ok:true,selectedModel:model,note:'Selezione valida per il processo corrente; per renderla predefinita imposta PANDORA_LLM_MODEL.'});}
    if(req.method==='GET'&&p==='/autonomy') return respond(res,{ok:true,autonomy:state.autonomy,queue:state.queue.length,stats:state.autonomyStats,openTasks:openTasks().length});
    if(req.method==='POST'&&p==='/chat'){
      const b=await body(req), text=String(b.text||'').trim(); if(!text) throw new Error('text required');
      state.messages.push({id:id(),role:'user',text,createdAt:iso()});
      learnAssociation(text);
      let result=localCognition(text);
      let mode='deterministic'; let plan=null; let toolResults=[];
      // Fast path for explicit deterministic commands; use the LLM only for semantic work.
      const explicit=/^(?:ricorda(?:ti)? che|preferisco|mi piace|non mi piace|aggiungi|crea|metti)\b/i.test(text) || /^(?:cosa ricordi|cosa sai di me|quante attivit|attivit aperte|stato|come stai|cosa puoi fare)/i.test(text);
      if(!explicit) {
        const thought=await think(text,'chat');
        if(thought.ok) {
          mode=thought.mode; plan=thought.plan; toolResults=thought.toolResults;
          result={text:thought.plan.reply||result.text,actions:toolResults.map(x=>x.tool)};
        }
      }
      state.messages.push({id:id(),role:'pandora',text:result.text,createdAt:iso(),mode,model:mode==='local-llm'?LLM_MODEL:null});
      audit('conversation',`Richiesta: ${text.slice(0,160)}`,{mode}); await save(); await autonomyCycle();
      return respond(res,{ok:true,...result,mode,plan,toolResults,state:{memoryCount:state.memories.length,openTasks:openTasks().length,queue:state.queue.length}});
    }
    if(req.method==='POST'&&p==='/memory'){const b=await body(req);const m=memory(String(b.text||''),String(b.category||'general'),Number(b.confidence||.75),'api');if(!m)throw new Error('text required');audit('memory',`Memoria aggiunta: ${m.text}`);enqueue('memory_review',{memoryId:m.id},20,now()+3600000);await save();return respond(res,{ok:true,memory:m});}
    if(req.method==='POST'&&p==='/tasks'){const b=await body(req);const t=task(String(b.title||''),'api',b);if(!t.title)throw new Error('title required');audit('task',`Attività creata: ${t.title}`,{taskId:t.id});enqueue('task_review',{taskId:t.id},t.priority,now());await save();return respond(res,{ok:true,task:t});}
    if(req.method==='POST'&&p==='/autonomy'){const b=await body(req);state.autonomy=Boolean(b.enabled);audit('system',`Autonomia ${state.autonomy?'attivata':'messa in pausa'}`);if(state.autonomy) enqueueUnique('system_wake','wake',{reason:'autonomy_enabled'},100,now());await save();if(state.autonomy) await autonomyCycle();return respond(res,{ok:true,autonomy:state.autonomy,queue:state.queue.length});}
    if(req.method==='POST'&&p==='/autonomy/wake'){if(!state.autonomy) return respond(res,{ok:false,error:'autonomy_paused'},409);enqueueUnique('system_wake','manual',{reason:'manual'},100,now());await save();await autonomyCycle();return respond(res,{ok:true,stats:state.autonomyStats,queue:state.queue.length});}
    respond(res,{ok:false,error:'not_found'},404);
  }catch(e){respond(res,{ok:false,error:e.message},400);}
}
const server=http.createServer(handle);
server.listen(PORT,HOST,()=>{ console.log(`Pandora Core autonomous: http://${HOST}:${PORT}`); deriveTasks(); scheduleNextWake(); });

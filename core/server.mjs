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
const id = () => crypto.randomUUID();
const iso = () => new Date().toISOString();
const now = () => Date.now();

const defaultState = () => ({
  version: 2,
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
  permissions: { safeLocal: 'auto', external: 'confirm', destructive: 'confirm' }
});

async function load() {
  await fs.mkdir(DATA, { recursive: true });
  try {
    const parsed = JSON.parse(await fs.readFile(DB, 'utf8'));
    return { ...defaultState(), ...parsed, autonomyStats: { ...defaultState().autonomyStats, ...(parsed.autonomyStats || {}) }, queue: parsed.queue || [] };
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
  if (found) { found.confidence = Math.min(1, found.confidence + .05); found.updatedAt = iso(); return found; }
  const m = { id:id(), text:clean, category, confidence:Math.max(0, Math.min(1, confidence)), source, createdAt:iso(), updatedAt:iso() };
  state.memories.unshift(m); return m;
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
  const exists = state.queue.some(q => q.type === type && q.payload?.key === key && q.runAt >= now()-60000);
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
  let reply='Ho elaborato la richiesta localmente. '; if(rel.length) reply+=`Terrò conto di: ${rel.map(m=>m.text).join('; ')}. `;
  reply+='Posso osservare, pianificare e svolgere automaticamente solo azioni locali sicure autorizzate.';
  return {text:reply,actions:[]};
}

async function executeWork(item) {
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
    if (now() >= maintenanceAt) { deriveTasks(); maintenanceAt = now() + MAINTENANCE_MS; }
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

function respond(body,status=200) { const b=JSON.stringify(body); return ['HTTP/1.1 '+status+' OK','Content-Type: application/json; charset=utf-8',`Content-Length: ${Buffer.byteLength(b)}`,'Access-Control-Allow-Origin: *','Access-Control-Allow-Headers: Content-Type','Access-Control-Allow-Methods: GET,POST,OPTIONS','Connection: close','',b].join('\r\n'); }
async function body(req){let d=''; for await(const c of req)d+=c; return d?JSON.parse(d):{};}
async function handle(req,res){
  if(req.method==='OPTIONS'){res.writeHead(204,{'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'Content-Type','Access-Control-Allow-Methods':'GET,POST,OPTIONS'});return res.end();}
  try{
    const u=new URL(req.url,`http://${req.headers.host||'localhost'}`); const p=u.pathname;
    if(req.method==='GET'&&p==='/health') return res.end(respond({ok:true,name:'Pandora Core',version:'1.2.0',mode:'local-autonomous',autonomy:state.autonomy,cycleRunning,queue:state.queue.length,stats:state.autonomyStats,now:iso()}));
    if(req.method==='GET'&&p==='/state') return res.end(respond({ok:true,state}));
    if(req.method==='GET'&&p==='/autonomy') return res.end(respond({ok:true,autonomy:state.autonomy,queue:state.queue.length,stats:state.autonomyStats,openTasks:openTasks().length}));
    if(req.method==='POST'&&p==='/chat'){
      const b=await body(req), text=String(b.text||'').trim(); if(!text) throw new Error('text required');
      state.messages.push({id:id(),role:'user',text,createdAt:iso()});
      const result=localCognition(text);
      state.messages.push({id:id(),role:'pandora',text:result.text,createdAt:iso(),mode:'local-core'});
      audit('conversation',`Richiesta: ${text.slice(0,160)}`); await save(); await autonomyCycle();
      return res.end(respond({ok:true,...result,mode:'local-core',state:{memoryCount:state.memories.length,openTasks:openTasks().length,queue:state.queue.length}}));
    }
    if(req.method==='POST'&&p==='/memory'){const b=await body(req);const m=memory(String(b.text||''),String(b.category||'general'),Number(b.confidence||.75),'api');if(!m)throw new Error('text required');audit('memory',`Memoria aggiunta: ${m.text}`);enqueue('memory_review',{memoryId:m.id},20,now()+3600000);await save();return res.end(respond({ok:true,memory:m}));}
    if(req.method==='POST'&&p==='/tasks'){const b=await body(req);const t=task(String(b.title||''),'api',b);if(!t.title)throw new Error('title required');audit('task',`Attività creata: ${t.title}`,{taskId:t.id});enqueue('task_review',{taskId:t.id},t.priority,now());await save();return res.end(respond({ok:true,task:t}));}
    if(req.method==='POST'&&p==='/autonomy'){const b=await body(req);state.autonomy=Boolean(b.enabled);audit('system',`Autonomia ${state.autonomy?'attivata':'messa in pausa'}`);if(state.autonomy) enqueueUnique('system_wake','wake',{reason:'autonomy_enabled'},100,now());await save();if(state.autonomy) await autonomyCycle();return res.end(respond({ok:true,autonomy:state.autonomy,queue:state.queue.length}));}
    if(req.method==='POST'&&p==='/autonomy/wake'){if(!state.autonomy) return res.end(respond({ok:false,error:'autonomy_paused'},409));enqueueUnique('system_wake','manual',{reason:'manual'},100,now());await save();await autonomyCycle();return res.end(respond({ok:true,stats:state.autonomyStats,queue:state.queue.length}));}
    res.end(respond({ok:false,error:'not_found'},404));
  }catch(e){res.end(respond({ok:false,error:e.message},400));}
}
const server=http.createServer(handle);
server.listen(PORT,HOST,()=>{ console.log(`Pandora Core autonomous: http://${HOST}:${PORT}`); deriveTasks(); scheduleNextWake(); });

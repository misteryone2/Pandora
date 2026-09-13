import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';

const ROOT = path.resolve(process.cwd());
const DATA = path.join(ROOT, 'data');
const DB = path.join(DATA, 'pandora.json');
const PORT = Number(process.env.PANDORA_PORT || 8787);
const HOST = process.env.PANDORA_HOST || '0.0.0.0';

const id = () => crypto.randomUUID();
const iso = () => new Date().toISOString();

const defaultState = () => ({
  version: 1,
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
  permissions: { safeLocal: 'auto', external: 'confirm', destructive: 'confirm' }
});

async function load() {
  await fs.mkdir(DATA, { recursive: true });
  try { return JSON.parse(await fs.readFile(DB, 'utf8')); } catch { const s = defaultState(); await save(s); return s; }
}
let saving = Promise.resolve();
let state = await load();
function save(s = state) { s.updatedAt = iso(); saving = saving.then(() => fs.writeFile(DB, JSON.stringify(s, null, 2))); return saving; }
function audit(type, text, meta = {}) { state.audit.unshift({ id: id(), type, text, createdAt: iso(), meta }); state.audit = state.audit.slice(0, 500); }
function memory(text, category='general', confidence=.75, source='user') {
  const found = state.memories.find(m => m.text.toLowerCase() === text.toLowerCase());
  if (found) { found.confidence = Math.min(1, found.confidence + .05); found.updatedAt = iso(); return found; }
  const m = { id:id(), text, category, confidence, source, createdAt:iso(), updatedAt:iso() }; state.memories.unshift(m); return m;
}
function task(title, source='user') { const t={id:id(), title, done:false, source, createdAt:iso()}; state.tasks.unshift(t); return t; }
function tokenize(s) { return s.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'').split(/[^a-z0-9àèéìòù]+/i).filter(x=>x.length>2); }
function relevantMemories(text, limit=8) {
  const q = new Set(tokenize(text));
  return state.memories.map(m => ({m, score: tokenize(m.text).filter(x=>q.has(x)).length + (m.category==='preferenza' ? .25 : 0)})).sort((a,b)=>b.score-a.score).slice(0,limit).filter(x=>x.score>0).map(x=>x.m);
}
function localCognition(text) {
  const raw=text.trim(), l=raw.toLowerCase();
  const prefix = [/^ricorda(?:ti)? che\s+/i,/^preferisco\s+/i,/^mi piace\s+/i,/^non mi piace\s+/i];
  const match = prefix.find(r=>r.test(raw));
  if (match) {
    const fact=raw.replace(match,'').trim(); if (fact) { const cat=/preferisco|piace/i.test(match.source)?'preferenza':'memoria'; memory(fact,cat,.8); audit('memory',`Memorizzato: ${fact}`); return {text:`Memorizzato. Lo terrò presente: ${fact}`, actions:['memory']}; }
  }
  const add=/^(?:aggiungi|crea|metti)\s+(?:un[ae]?\s+)?attivit[aà]\s*:?[ ]*(.+)$/i.exec(raw);
  if(add){ const t=task(add[1]); audit('task',`Creata attività: ${t.title}`); return {text:`Attività aggiunta: ${t.title}`,actions:['task']}; }
  if(/cosa ricordi|cosa sai di me|memorie/i.test(l)){ const ms=state.memories.slice(0,15); return {text:ms.length?`Queste sono le memorie consolidate:\n${ms.map(m=>`• ${m.text}`).join('\n')}`:'Non ho ancora memorie consolidate.',actions:[]}; }
  if(/quante attivit[aà]|attivit[aà] aperte/i.test(l)){return {text:`Hai ${state.tasks.filter(t=>!t.done).length} attività aperte.`,actions:[]};}
  if(/stato|come stai|cosa puoi fare/i.test(l)){return {text:`Sono Pandora Core, in esecuzione locale. Ho ${state.memories.length} memorie, ${state.tasks.filter(t=>!t.done).length} attività aperte e autonomia ${state.autonomy?'attiva':'in pausa'}. Posso osservare, ricordare, pianificare ed eseguire azioni locali sicure.`,actions:[]};}
  const rel=relevantMemories(raw);
  let reply='Ho elaborato la richiesta localmente. '; if(rel.length) reply+=`Terrò conto di: ${rel.map(m=>m.text).join('; ')}. `;
  reply+='Posso trasformare una richiesta in memoria, attività o piano quando riconosco un’azione sicura.';
  return {text:reply,actions:[]};
}
function respond(body) { const b=JSON.stringify(body); return ['HTTP/1.1 200 OK','Content-Type: application/json; charset=utf-8',`Content-Length: ${Buffer.byteLength(b)}`,'Access-Control-Allow-Origin: *','Access-Control-Allow-Headers: Content-Type','Access-Control-Allow-Methods: GET,POST,OPTIONS','Connection: close','',b].join('\r\n'); }
async function body(req){let d=''; for await(const c of req)d+=c; return d?JSON.parse(d):{};}
async function handle(req,res){
  if(req.method==='OPTIONS'){res.writeHead(204,{'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'Content-Type','Access-Control-Allow-Methods':'GET,POST,OPTIONS'});return res.end();}
  try{
    const u=new URL(req.url,`http://${req.headers.host||'localhost'}`); const p=u.pathname;
    if(req.method==='GET'&&p==='/health') return res.end(respond({ok:true,name:'Pandora Core',version:'1.1.0',mode:'local',autonomy:state.autonomy,now:iso()}));
    if(req.method==='GET'&&p==='/state') return res.end(respond({ok:true,state}));
    if(req.method==='POST'&&p==='/chat'){
      const b=await body(req), text=String(b.text||'').trim(); if(!text) throw new Error('text required');
      state.messages.push({id:id(),role:'user',text,createdAt:iso()});
      const result=localCognition(text);
      state.messages.push({id:id(),role:'pandora',text:result.text,createdAt:iso(),mode:'local-core'});
      audit('conversation',`Richiesta: ${text.slice(0,160)}`); await save();
      return res.end(respond({ok:true,...result,mode:'local-core',state:{memoryCount:state.memories.length,openTasks:state.tasks.filter(t=>!t.done).length}}));
    }
    if(req.method==='POST'&&p==='/memory'){const b=await body(req);const m=memory(String(b.text||''),String(b.category||'general'),Number(b.confidence||.75),'api');audit('memory',`Memoria aggiunta: ${m.text}`);await save();return res.end(respond({ok:true,memory:m}));}
    if(req.method==='POST'&&p==='/tasks'){const b=await body(req);const t=task(String(b.title||''),'api');audit('task',`Attività creata: ${t.title}`);await save();return res.end(respond({ok:true,task:t}));}
    if(req.method==='POST'&&p==='/autonomy'){const b=await body(req);state.autonomy=Boolean(b.enabled);audit('system',`Autonomia ${state.autonomy?'attivata':'messa in pausa'}`);await save();return res.end(respond({ok:true,autonomy:state.autonomy}));}
    res.writeHead(404,{'Content-Type':'application/json','Access-Control-Allow-Origin':'*'});res.end(JSON.stringify({ok:false,error:'not_found'}));
  }catch(e){res.writeHead(400,{'Content-Type':'application/json','Access-Control-Allow-Origin':'*'});res.end(JSON.stringify({ok:false,error:e.message}));}
}
const server=http.createServer(handle); server.listen(PORT,HOST,()=>console.log(`Pandora Core local: http://${HOST}:${PORT}`));
setInterval(async()=>{ if(!state.autonomy)return; const open=state.tasks.find(t=>!t.done); if(open){ audit('heartbeat',`Controllo autonomia: ${state.tasks.filter(t=>!t.done).length} attività aperte`); await save(); } },60000).unref();

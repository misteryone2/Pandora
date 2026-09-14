'use client';

import { useEffect, useMemo, useState } from 'react';

type Tab = 'chat' | 'memory' | 'tasks' | 'activity' | 'settings';
type Memory = { id:string; text:string; category:string; confidence:number; createdAt:string; updatedAt?:string };
type Task = { id:string; title:string; done:boolean; createdAt:string; priority:number };
type Message = { id:string; role:'user'|'pandora'; text:string; createdAt:string; mode?:string };
type Activity = { id:string; type:string; text:string; createdAt:string };
type Learning = { id:string; text:string; kind:string; confidence:number; createdAt:string };
type Store = { memories:Memory[]; tasks:Task[]; messages:Message[]; activity:Activity[]; learning:Learning[]; autonomy:boolean; cycles:number; actions:number };

const KEY='pandora.phone.v1.6';
const LEGACY_KEY='pandora.phone.v1';
const id=()=>crypto.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`;
const iso=()=>new Date().toISOString();
const empty:Store={memories:[],tasks:[],messages:[],activity:[],learning:[],autonomy:true,cycles:0,actions:0};

function readStore():Store {
  try {
    const x=localStorage.getItem(KEY) || localStorage.getItem(LEGACY_KEY); if(!x)return empty;
    const p=JSON.parse(x);
    return {...empty,...p,memories:p.memories||[],tasks:p.tasks||[],messages:p.messages||[],activity:p.activity||[],learning:p.learning||[]};
  } catch { return empty; }
}
function writeStore(s:Store){try{localStorage.setItem(KEY,JSON.stringify(s));}catch{}}

export default function Home(){
  const [tab,setTab]=useState<Tab>('chat');
  const [input,setInput]=useState('');
  const [store,setStore]=useState<Store>(empty);
  const [hydrated,setHydrated]=useState(false);
  const [loading,setLoading]=useState(false);

  useEffect(()=>{
    const s=readStore();
    if(!s.messages.length){
      const welcome:Message={id:id(),role:'pandora',text:'Ciao. Sono Pandora. Da ora non mi limito a rispondere: posso collegare ciò che dici a quello che ho già imparato, riconoscere preferenze e vincoli, proporre il passo successivo e consolidare gli apprendimenti direttamente sul telefono.',createdAt:iso(),mode:'phone-local'};
      s.messages=[welcome];
    }
    setStore(s);setHydrated(true);
    if('serviceWorker' in navigator)navigator.serviceWorker.register('/sw.js').catch(()=>{});
  },[]);
  useEffect(()=>{if(hydrated)writeStore(store)},[store,hydrated]);

  useEffect(()=>{
    if(!hydrated||!store.autonomy)return;
    const run=()=>setStore(s=>{
      const open=s.tasks.filter(t=>!t.done).sort((a,b)=>b.priority-a.priority);
      const activity:Activity={id:id(),type:'autonomia',text:open.length?`Controllata attività: ${open[0].title}`:'Controllo autonomo completato: nessuna attività urgente.',createdAt:iso()};
      return {...s,cycles:s.cycles+1,actions:open.length?s.actions+1:s.actions,activity:[activity,...s.activity].slice(0,150)};
    });
    const timer=window.setInterval(run,30000);return()=>clearInterval(timer);
  },[hydrated,store.autonomy]);

  const log=(type:string,text:string)=>setStore(s=>({...s,activity:[{id:id(),type,text,createdAt:iso()},...s.activity].slice(0,150)}));

  const addLearning=(text:string,kind:string,confidence:number)=>setStore(s=>({...s,learning:[{id:id(),text,kind,confidence,createdAt:iso()},...s.learning].slice(0,250)}));

  const rememberFact=(fact:string,category='Memoria',confidence=.8)=>{
    const clean=fact.trim();if(!clean)return;
    let created=false;
    setStore(s=>{
      const old=s.memories.find(m=>m.text.toLowerCase()===clean.toLowerCase());
      if(old)return {...s,memories:s.memories.map(m=>m.id===old.id?{...m,confidence:Math.min(1,m.confidence+.05),updatedAt:iso()}:m)};
      created=true;
      return {...s,memories:[{id:id(),text:clean,category,confidence,createdAt:iso()},...s.memories].slice(0,300)};
    });
    addLearning(`${created?'Nuova memoria':'Memoria rinforzata'}: ${clean}`,'memoria',confidence);
    log('apprendimento',`${created?'Imparato':'Rinforzato'}: ${clean}`);
  };

  const explicitMemory=(text:string)=>{
    const patterns:[RegExp,string,number][]=[
      [/^ricorda(?:ti)? che\s+/i,'Memoria',.98],
      [/^preferisco\s+/i,'Preferenza',.95],
      [/^mi piace\s+/i,'Preferenza',.95],
      [/^non mi piace\s+/i,'Preferenza negativa',.95],
      [/^odio\s+/i,'Preferenza negativa',.95],
      [/^amo\s+/i,'Preferenza',.95]
    ];
    const hit=patterns.find(([r])=>r.test(text));if(!hit)return null;
    const fact=text.replace(hit[0],'').trim();if(!fact)return null;
    rememberFact(fact,hit[1],hit[2]);
    return `Memorizzato. Lo terrò presente: ${fact}`;
  };

  const inferLearning=(text:string)=>{
    const patterns:[RegExp,string,string,number][]=[
      [/\bmi chiamo\s+([a-zà-ÿ][a-zà-ÿ' -]{1,40})/i,'profilo','Hai indicato il nome: $1',.98],
      [/\bpreferisco\s+(.{2,120})$/i,'preferenza','Preferisci: $1',.84],
      [/\bmi piace\s+(.{2,120})$/i,'preferenza','Ti piace: $1',.84],
      [/\bnon mi piace\s+(.{2,120})$/i,'preferenza','Non ti piace: $1',.84],
      [/\bnon voglio\s+(.{2,120})$/i,'vincolo','Vincolo: $1',.82],
      [/\bvorrei\s+(.{2,120})$/i,'obiettivo','Possibile obiettivo: $1',.72],
      [/\bdevo\s+(.{2,120})$/i,'obiettivo','Possibile attività: $1',.7]
    ];
    for(const [r,kind,template,confidence] of patterns){
      const m=r.exec(text);if(!m)continue;
      const value=m[1].trim().replace(/[.!?]+$/,'');if(value.length<2)continue;
      const fact=template.replace('$1',value);
      if(kind==='preferenza'||kind==='vincolo'||kind==='profilo')rememberFact(fact,kind==='profilo'?'Profilo':'Preferenza',confidence);
      addLearning(fact,kind,confidence);
      log('apprendimento',`Segnale ${kind}: ${value}`);
      return {kind,value};
    }
    return null;
  };

  const relevant=(text:string)=>{
    const words=text.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'').split(/[^a-z0-9]+/).filter(w=>w.length>3);
    return store.memories.map(m=>({m,score:words.filter(w=>m.text.toLowerCase().includes(w)).length})).filter(x=>x.score>0).sort((a,b)=>b.score-a.score).slice(0,4).map(x=>x.m);
  };

  const addTask=(title:string)=>{
    const clean=title.trim();if(!clean)return;
    setStore(s=>({...s,tasks:[{id:id(),title:clean,done:false,createdAt:iso(),priority:1},...s.tasks]}));
    log('attività',`Creata attività: ${clean}`);
  };

  const answer=(text:string):string=>{
    const explicit=explicitMemory(text);if(explicit)return explicit;
    const inferred=inferLearning(text);
    const l=text.toLowerCase().trim();
    const rel=relevant(text);
    const recent=store.messages.filter(m=>m.role==='user').slice(-3).map(m=>m.text);

    if(/^(ciao|salve|hey|buongiorno|buonasera)\b/i.test(l)){
      return rel.length?`Ciao! Ricordo ${rel[0].text}. Possiamo ripartire da lì. Cosa vuoi fare adesso?`:'Ciao! Sono qui. Dimmi cosa vuoi fare e, se emerge qualcosa di utile, lo imparerò.';
    }
    if(l.includes('cosa puoi fare')||l.includes('cosa sai fare')){
      return 'Posso conversare, mantenere memoria, riconoscere preferenze e vincoli, creare attività, collegare messaggi tra loro, proporre il prossimo passo e registrare ciò che imparo. Il tutto resta locale sul telefono.';
    }
    if(l.includes('cosa ricordi')||l.includes('cosa sai di me')){
      return store.memories.length?`Queste sono le memorie consolidate:\n${store.memories.slice(0,15).map(m=>`• ${m.text}`).join('\n')}`:'Non ho ancora memorie consolidate.';
    }
    if(/^(?:aggiungi|crea|metti)\s+(?:un[ae]?\s+)?attivit[aà]/i.test(text)){
      const title=text.replace(/^(?:aggiungi|crea|metti)\s+(?:un[ae]?\s+)?attivit[aà]\s*:?[ ]*/i,'').trim();
      if(title){addTask(title);return`Attività aggiunta: ${title}. La controllerò nei cicli autonomi.`;}
    }
    if(l.includes('quante attività')||l.includes('quante attivita'))return`Hai ${store.tasks.filter(t=>!t.done).length} attività aperte.`;
    if(l.includes('elenca')&&l.includes('attivit'))return store.tasks.filter(t=>!t.done).length?store.tasks.filter(t=>!t.done).map((t,i)=>`${i+1}. ${t.title}`).join('\n'):'Non hai attività aperte.';
    if(l.includes('stato')&&l.includes('autonomia'))return`Autonomia ${store.autonomy?'attiva':'in pausa'}. ${store.memories.length} memorie, ${store.learning.length} apprendimenti, ${store.tasks.filter(t=>!t.done).length} attività aperte e ${store.cycles} cicli locali.`;
    if(l.includes('grazie'))return'Di nulla. Continuo a usare ciò che mi insegni per rendere le risposte successive più pertinenti.';
    if(inferred?.kind==='obiettivo')return`Ho capito. Hai espresso un possibile obiettivo: “${inferred.value}”. Se vuoi, posso trasformarlo in un’attività e seguirne l’avanzamento.`;
    if(inferred?.kind==='vincolo')return`Capito. Terrò conto di questo vincolo: “${inferred.value}”.`;
    if(rel.length)return`Ti seguo. Questa richiesta si collega a ciò che ho già imparato: ${rel.map(m=>m.text).join('; ')}. Posso usare questo contesto per la prossima azione.`;
    if(/\?$/.test(text.trim()))return recent.length>1?`Sì, posso ragionarci. Vedo anche il filo della conversazione recente: “${recent[recent.length-2].slice(0,120)}”. Dimmi il dettaglio che vuoi approfondire e lo collegherò al contesto locale.`:'Posso ragionarci, ma non inventerò informazioni che non possiedo. Se mi dai un dettaglio in più, posso collegarlo alla memoria e imparare da quello che mi dici.';
    return`Capito: “${text}”. Lo tratto come parte della conversazione, non come un messaggio isolato. Se contiene una preferenza, un vincolo o un obiettivo utile, posso consolidarlo nella memoria locale.`;
  };

  const send=async()=>{
    const text=input.trim();if(!text||loading)return;
    setLoading(true);const u:Message={id:id(),role:'user',text,createdAt:iso()};
    setStore(s=>({...s,messages:[...s.messages,u].slice(-120)}));setInput('');log('conversazione',`Messaggio ricevuto: ${text.slice(0,100)}`);
    await new Promise(r=>setTimeout(r,120));
    const reply=answer(text);const p:Message={id:id(),role:'pandora',text:reply,createdAt:iso(),mode:'phone-local'};
    setStore(s=>({...s,messages:[...s.messages,p].slice(-120)}));setLoading(false);
  };

  const pending=useMemo(()=>store.tasks.filter(t=>!t.done).length,[store.tasks]);
  const completed=store.tasks.length-pending;
  const clearAll=()=>{if(confirm('Eliminare memoria, attività, conversazioni e registro locali?'))setStore({...empty,messages:[]});};

  return <main>
    <header><div className="brand"><span className="orb">✦</span><div><h1>Pandora</h1><p>Personal Autonomous Assistant</p></div></div><div className="header-right"><span className="status ai">● Telefono</span><span className="version">v1.6</span></div></header>
    <section className="hero"><div><small>STATO DEL SISTEMA</small><h2>{store.autonomy?'Nucleo operativo.':'Autonomia in pausa.'}</h2><p>Conversazione, memoria e apprendimento avvengono localmente sul telefono.</p></div><div className="stats"><div><b>{store.memories.length}</b><span>memorie</span></div><div><b>{pending}</b><span>aperte</span></div><div><b>{store.learning.length}</b><span>appresi</span></div></div></section>
    <nav className="tabs">{(['chat','memory','tasks','activity','settings'] as Tab[]).map(x=><button className={tab===x?'active':''} onClick={()=>setTab(x)} key={x}>{x==='chat'?'Pandora':x==='memory'?'Memoria':x==='tasks'?'Attività':x==='activity'?'Registro':'Impostazioni'}</button>)}</nav>

    {tab==='chat'&&<section className="panel chat-panel"><div className="chat-toolbar"><span>Conversazione</span><small>{loading?'Pandora sta elaborando…':store.autonomy?'apprendimento attivo':'pausa'}</small></div><div className="messages">{store.messages.map(m=><div key={m.id} className={`message ${m.role}`}><span className="avatar">{m.role==='pandora'?'✦':'Tu'}</span><div><p>{m.text}</p><small>{new Date(m.createdAt).toLocaleTimeString('it-IT',{hour:'2-digit',minute:'2-digit'})} · {m.mode||'locale'}</small></div></div>)}{loading&&<div className="message pandora"><span className="avatar">✦</span><div><p className="typing">•••</p></div></div>}</div><div className="composer"><textarea value={input} onChange={e=>setInput(e.target.value)} onKeyDown={e=>{if(e.key==='Enter'&&!e.shiftKey){e.preventDefault();send()}}} placeholder="Parla con Pandora…" rows={1}/><button onClick={send} disabled={loading||!input.trim()}>↑</button></div><div className="quick"><button onClick={()=>setInput('Ricorda che ')}>+ Memoria</button><button onClick={()=>setInput('Aggiungi attività ')}>+ Attività</button><button onClick={()=>setInput('Cosa ricordi di me?')}>Cosa ricordi?</button></div></section>}

    {tab==='memory'&&<section className="panel"><div className="panelhead"><div><small>LONG-TERM MEMORY</small><h2>Memoria</h2></div><span>{store.memories.length}</span></div>{!store.memories.length?<p className="empty">Nessuna memoria. Pandora impara automaticamente da segnali forti; puoi anche scrivere “ricorda che…”</p>:store.memories.map(m=><article className="memory" key={m.id}><div><b>{m.text}</b><small>{m.category} · {Math.round(m.confidence*100)}% · {new Date(m.createdAt).toLocaleDateString('it-IT')}</small></div><button onClick={()=>{setStore(s=>({...s,memories:s.memories.filter(x=>x.id!==m.id)}));log('memoria',`Eliminata: ${m.text}`)}}>×</button></article>)}</section>}

    {tab==='tasks'&&<section className="panel"><div className="panelhead"><div><small>PERSONAL WORK QUEUE</small><h2>Attività</h2></div><span>{pending} aperte</span></div><TaskInput onAdd={addTask}/><div className="task-list">{!store.tasks.length?<p className="empty">Nessuna attività.</p>:store.tasks.map(t=><label className="task" key={t.id}><input type="checkbox" checked={t.done} onChange={()=>{setStore(s=>({...s,tasks:s.tasks.map(x=>x.id===t.id?{...x,done:!x.done}:x)}));log('attività',`${t.done?'Riaperta':'Completata'}: ${t.title}`)}}/><span className={t.done?'done':''}>{t.title}</span><button type="button" onClick={e=>{e.preventDefault();setStore(s=>({...s,tasks:s.tasks.filter(x=>x.id!==t.id)}));log('attività',`Eliminata: ${t.title}`)}}>×</button></label>)}</div></section>}

    {tab==='activity'&&<section className="panel"><div className="panelhead"><div><small>LEARNING & AUDIT</small><h2>Registro</h2></div><span>{store.activity.length}</span></div>{store.learning.slice(0,12).map(x=><div className="log" key={x.id}><i>impara</i><span>{x.text}</span><time>{Math.round(x.confidence*100)}% · {new Date(x.createdAt).toLocaleString('it-IT',{day:'2-digit',month:'2-digit',hour:'2-digit',minute:'2-digit'})}</time></div>)}{store.activity.slice(0,80).map(a=><div className="log" key={a.id}><i>{a.type}</i><span>{a.text}</span><time>{new Date(a.createdAt).toLocaleString('it-IT',{day:'2-digit',month:'2-digit',hour:'2-digit',minute:'2-digit'})}</time></div>)}{!store.activity.length&&!store.learning.length&&<p className="empty">Nessuna attività registrata.</p>}</section>}

    {tab==='settings'&&<section className="panel settings"><div className="panelhead"><div><small>PHONE CONTROL PLANE</small><h2>Impostazioni</h2></div></div><div className="setting"><div><b>Apprendimento attivo</b><span>Pandora riconosce segnali espliciti e forti nelle conversazioni, assegna una confidenza e li consolida localmente. Non invia questi dati a servizi esterni.</span></div><strong>{store.learning.length}</strong></div><div className="setting"><div><b>Autonomia locale</b><span>Il ciclo lavora direttamente nel browser. Quando iOS sospende la PWA, JavaScript può fermarsi: è un limite del sistema operativo.</span></div><button className={`switch ${store.autonomy?'on':''}`} onClick={()=>{const n=!store.autonomy;setStore(s=>({...s,autonomy:n}));log('sistema',`Autonomia ${n?'attivata':'messa in pausa'}`)}}><span/></button></div><div className="setting"><div><b>Memoria</b><span>Persistente sul dispositivo tramite localStorage.</span></div><strong>{store.memories.length}</strong></div><div className="architecture"><b>Architettura v1.6 — Active Learning</b><p>iPhone → conversazione → riconoscimento → memoria → contesto → risposta → apprendimento → consolidamento.</p><small>Il cervello generativo può essere aggiunto in seguito come modulo locale opzionale. Il nucleo non dipende da un computer o da un'API AI esterna.</small></div><div className="danger"><div><b>Azzeramento locale</b><span>Cancella tutti i dati salvati su questo telefono.</span></div><button onClick={clearAll}>Cancella dati</button></div></section>}
    <footer><span>Pandora v1.6</span><span>·</span><span>phone-first</span><span>·</span><span>active-learning</span></footer>
  </main>;
}

function TaskInput({onAdd}:{onAdd:(title:string)=>void}){const[v,setV]=useState('');const submit=()=>{if(v.trim()){onAdd(v);setV('')}};return <div className="addtask"><input value={v} onChange={e=>setV(e.target.value)} onKeyDown={e=>{if(e.key==='Enter')submit()}} placeholder="Nuova attività…"/><button onClick={submit}>Aggiungi</button></div>}

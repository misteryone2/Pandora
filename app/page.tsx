'use client';

import { useEffect, useMemo, useState } from 'react';

type Tab = 'chat' | 'memory' | 'tasks' | 'activity' | 'settings';
type Memory = { id:string; text:string; category:string; confidence:number; createdAt:string };
type Task = { id:string; title:string; done:boolean; createdAt:string; priority:number };
type Message = { id:string; role:'user'|'pandora'; text:string; createdAt:string; mode?:string };
type Activity = { id:string; type:string; text:string; createdAt:string };

type Store = { memories:Memory[]; tasks:Task[]; messages:Message[]; activity:Activity[]; autonomy:boolean; cycles:number; actions:number };
const KEY='pandora.phone.v1';
const id=()=>crypto.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`;
const iso=()=>new Date().toISOString();
const empty:Store={memories:[],tasks:[],messages:[],activity:[],autonomy:true,cycles:0,actions:0};

function readStore():Store { try { const x=localStorage.getItem(KEY); return x?{...empty,...JSON.parse(x)}:empty; } catch { return empty; } }
function writeStore(s:Store){ try{localStorage.setItem(KEY,JSON.stringify(s));}catch{} }

export default function Home(){
  const [tab,setTab]=useState<Tab>('chat');
  const [input,setInput]=useState('');
  const [store,setStore]=useState<Store>(empty);
  const [hydrated,setHydrated]=useState(false);
  const [loading,setLoading]=useState(false);

  useEffect(()=>{
    const s=readStore();
    if(!s.messages.length) s.messages=[{id:id(),role:'pandora',text:'Ciao Mattia. Sono Pandora. Ora il mio nucleo funziona direttamente nel telefono: memoria, attività, registro e autonomia locale non dipendono da un computer.',createdAt:iso(),mode:'phone-local'}];
    setStore(s); setHydrated(true);
    if('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(()=>{});
  },[]);
  useEffect(()=>{if(hydrated)writeStore(store)},[store,hydrated]);

  // Autonomia phone-first: lavora quando l'app è attiva. iOS può sospendere JS quando la PWA è chiusa.
  useEffect(()=>{
    if(!hydrated || !store.autonomy) return;
    const run=()=>setStore(s=>{
      const open=s.tasks.filter(t=>!t.done).sort((a,b)=>b.priority-a.priority);
      if(!open.length) return {...s,cycles:s.cycles+1};
      const t=open[0];
      const next={...s,cycles:s.cycles+1,actions:s.actions+1,activity:[{id:id(),type:'autonomia',text:`Controllata attività: ${t.title}`,createdAt:iso()},...s.activity].slice(0,100)};
      return next;
    });
    const timer=window.setInterval(run,30000); return()=>clearInterval(timer);
  },[hydrated,store.autonomy]);

  const log=(type:string,text:string)=>setStore(s=>({...s,activity:[{id:id(),type,text,createdAt:iso()},...s.activity].slice(0,100)}));
  const remember=(text:string)=>{
    const low=text.toLowerCase();
    const prefixes=['ricorda che ','ricordati che ','preferisco ','mi piace ','non mi piace '];
    const p=prefixes.find(x=>low.startsWith(x)); if(!p)return null;
    const fact=text.slice(p.length).trim(); if(!fact)return null;
    const category=(p.includes('prefer')||p.includes('piace'))?'Preferenza':'Memoria';
    setStore(s=>{const old=s.memories.find(m=>m.text.toLowerCase()===fact.toLowerCase()); return old?{...s,memories:s.memories.map(m=>m.id===old.id?{...m,confidence:Math.min(1,m.confidence+.05)}:m)}:{...s,memories:[{id:id(),text:fact,category,confidence:.8,createdAt:iso()},...s.memories]}});
    log('memoria',`Memorizzato: ${fact}`); return `Memorizzato. Terrò presente: ${fact}`;
  };
  const addTask=(title:string)=>{const clean=title.trim();if(!clean)return;setStore(s=>({...s,tasks:[{id:id(),title:clean,done:false,createdAt:iso(),priority:1},...s.tasks]}));log('attività',`Creata attività: ${clean}`)};

  const answer=(text:string)=>{
    const learned=remember(text); if(learned)return learned;
    const l=text.toLowerCase().trim();
    if(l==='ciao'||l.startsWith('ciao ' )||l==='hey'||l==='buongiorno'||l==='buonasera') return 'Ciao! Sono qui. Dimmi cosa vuoi fare.';
    if(l.includes('cosa puoi fare')||l.includes('cosa sai fare')) return 'Posso gestire memoria, attività, registro, priorità e un ciclo autonomo direttamente nel telefono. Non devo collegarmi a un computer per queste funzioni.';
    if(l.includes('cosa ricordi')||l.includes('cosa sai di me')) return store.memories.length?`Queste sono le memorie che ho consolidato:\n${store.memories.slice(0,15).map(m=>`• ${m.text}`).join('\n')}`:'Non ho ancora memorie consolidate.';
    if(l.startsWith('aggiungi attività')||l.startsWith('aggiungi attività:')){const title=text.replace(/^aggiungi attività\s*: ?/i,'').replace(/^aggiungi attività\s*/i,'').trim();if(title){addTask(title);return`Attività aggiunta: ${title}`}}
    if(l.includes('quante attività')) return `Hai ${store.tasks.filter(t=>!t.done).length} attività aperte.`;
    if(l.includes('stato')&&l.includes('autonomia')) return `Autonomia ${store.autonomy?'attiva':'in pausa'}. ${store.tasks.filter(t=>!t.done).length} attività aperte, ${store.memories.length} memorie, ${store.cycles} cicli locali.`;
    if(l.includes('grazie')) return 'Di nulla. Sono qui.';
    if(l.includes('elenca')&&l.includes('attività')) return store.tasks.filter(t=>!t.done).length?store.tasks.filter(t=>!t.done).map((t,i)=>`${i+1}. ${t.title}`).join('\n'):'Non hai attività aperte.';
    return `Ho ricevuto: “${text}”. Posso agire localmente su memoria e attività. Per ora il cervello semantico generativo non è necessario per le funzioni di base: questa versione evita completamente dipendenze da un computer o da un'API AI esterna.`;
  };

  const send=async()=>{const text=input.trim();if(!text||loading)return;setLoading(true);const u:Message={id:id(),role:'user',text,createdAt:iso()};setStore(s=>({...s,messages:[...s.messages,u].slice(-100)}));setInput('');log('conversazione',`Messaggio ricevuto: ${text.slice(0,80)}`);await new Promise(r=>setTimeout(r,120));const reply=answer(text);const p:Message={id:id(),role:'pandora',text:reply,createdAt:iso(),mode:'phone-local'}; setStore(s=>({...s,messages:[...s.messages,p].slice(-100)}));setLoading(false)};
  const pending=useMemo(()=>store.tasks.filter(t=>!t.done).length,[store.tasks]);
  const completed=store.tasks.length-pending;
  const clearAll=()=>{if(confirm('Eliminare memoria, attività, conversazioni e registro locali?')){const s={...empty,messages:[]};setStore(s)}};

  return <main>
    <header><div className="brand"><span className="orb">✦</span><div><h1>Pandora</h1><p>Personal Autonomous Assistant</p></div></div><div className="header-right"><span className="status ai">● Telefono</span><span className="version">v1.5</span></div></header>
    <section className="hero"><div><small>STATO DEL SISTEMA</small><h2>{store.autonomy?'Nucleo operativo.':'Autonomia in pausa.'}</h2><p>Il nucleo di Pandora è nel browser del telefono. I dati restano sul dispositivo.</p></div><div className="stats"><div><b>{store.memories.length}</b><span>memorie</span></div><div><b>{pending}</b><span>aperte</span></div><div><b>{completed}</b><span>completate</span></div></div></section>
    <nav className="tabs">{(['chat','memory','tasks','activity','settings'] as Tab[]).map(x=><button className={tab===x?'active':''} onClick={()=>setTab(x)} key={x}>{x==='chat'?'Pandora':x==='memory'?'Memoria':x==='tasks'?'Attività':x==='activity'?'Registro':'Impostazioni'}</button>)}</nav>

    {tab==='chat'&&<section className="panel chat-panel"><div className="chat-toolbar"><span>Conversazione</span><small>{loading?'Pandora sta pensando…':store.autonomy?'autonomia attiva':'pausa'}</small></div><div className="messages">{store.messages.map(m=><div key={m.id} className={`message ${m.role}`}><span className="avatar">{m.role==='pandora'?'✦':'Tu'}</span><div><p>{m.text}</p><small>{new Date(m.createdAt).toLocaleTimeString('it-IT',{hour:'2-digit',minute:'2-digit'})} · {m.mode||'locale'}</small></div></div>)}{loading&&<div className="message pandora"><span className="avatar">✦</span><div><p className="typing">•••</p></div></div>}</div><div className="composer"><textarea value={input} onChange={e=>setInput(e.target.value)} onKeyDown={e=>{if(e.key==='Enter'&&!e.shiftKey){e.preventDefault();send()}}} placeholder="Parla con Pandora…" rows={1}/><button onClick={send} disabled={loading||!input.trim()}>↑</button></div><div className="quick"><button onClick={()=>setInput('Ricorda che ')}>+ Memoria</button><button onClick={()=>setInput('Aggiungi attività ')}>+ Attività</button><button onClick={()=>setInput('Cosa ricordi di me?')}>Cosa ricordi?</button></div></section>}

    {tab==='memory'&&<section className="panel"><div className="panelhead"><div><small>LONG-TERM MEMORY</small><h2>Memoria</h2></div><span>{store.memories.length}</span></div>{!store.memories.length?<p className="empty">Nessuna memoria. Scrivi in chat “ricorda che…”</p>:store.memories.map(m=><article className="memory" key={m.id}><div><b>{m.text}</b><small>{m.category} · {Math.round(m.confidence*100)}% · {new Date(m.createdAt).toLocaleDateString('it-IT')}</small></div><button onClick={()=>{setStore(s=>({...s,memories:s.memories.filter(x=>x.id!==m.id)}));log('memoria',`Eliminata: ${m.text}`)}}>×</button></article>)}</section>}

    {tab==='tasks'&&<section className="panel"><div className="panelhead"><div><small>PERSONAL WORK QUEUE</small><h2>Attività</h2></div><span>{pending} aperte</span></div><TaskInput onAdd={addTask}/><div className="task-list">{!store.tasks.length?<p className="empty">Nessuna attività.</p>:store.tasks.map(t=><label className="task" key={t.id}><input type="checkbox" checked={t.done} onChange={()=>{setStore(s=>({...s,tasks:s.tasks.map(x=>x.id===t.id?{...x,done:!x.done}:x)}));log('attività',`${t.done?'Riaperta':'Completata'}: ${t.title}`)}}/><span className={t.done?'done':''}>{t.title}</span><button type="button" onClick={e=>{e.preventDefault();setStore(s=>({...s,tasks:s.tasks.filter(x=>x.id!==t.id)}));log('attività',`Eliminata: ${t.title}`)}}>×</button></label>)}</div></section>}

    {tab==='activity'&&<section className="panel"><div className="panelhead"><div><small>AUDIT LOG</small><h2>Registro</h2></div><span>{store.activity.length}</span></div>{!store.activity.length?<p className="empty">Nessuna attività registrata.</p>:store.activity.map(a=><div className="log" key={a.id}><i>{a.type}</i><span>{a.text}</span><time>{new Date(a.createdAt).toLocaleString('it-IT',{day:'2-digit',month:'2-digit',hour:'2-digit',minute:'2-digit'})}</time></div>)}</section>}

    {tab==='settings'&&<section className="panel settings"><div className="panelhead"><div><small>PHONE CONTROL PLANE</small><h2>Impostazioni</h2></div></div><div className="setting"><div><b>Autonomia locale</b><span>Il ciclo lavora direttamente nel browser. Quando iOS sospende la PWA, JavaScript può fermarsi: è un limite del sistema operativo, non di Pandora.</span></div><button className={`switch ${store.autonomy?'on':''}`} onClick={()=>{const n=!store.autonomy;setStore(s=>({...s,autonomy:n}));log('sistema',`Autonomia ${n?'attivata':'messa in pausa'}`)}}><span/></button></div><div className="setting"><div><b>Memoria</b><span>Salvata localmente con localStorage. Nessun server necessario per memoria, chat, attività e registro.</span></div><strong>{store.memories.length} elementi</strong></div><div className="setting"><div><b>Connessione</b><span>Questa versione non richiede Pandora Core, Ollama, un PC o un'API AI per funzionare.</span></div><strong>100% locale</strong></div><div className="architecture"><b>Architettura v1.5 — Phone First</b><p>iPhone → PWA → nucleo locale JavaScript → memoria → attività → autonomia → registro.</p><small>Il progetto può essere usato e modificato dal solo telefono. Un eventuale modello generativo locale potrà essere aggiunto in futuro come modulo opzionale, senza trasformarlo in una dipendenza cloud.</small></div><div className="danger"><div><b>Azzeramento locale</b><span>Cancella tutti i dati salvati su questo telefono.</span></div><button onClick={clearAll}>Cancella dati</button></div></section>}
    <footer><span>Pandora v1.5</span><span>·</span><span>phone-first</span><span>·</span><span>local-first</span></footer>
  </main>;
}

function TaskInput({onAdd}:{onAdd:(title:string)=>void}){const[v,setV]=useState('');const submit=()=>{if(v.trim()){onAdd(v);setV('')}};return <div className="addtask"><input value={v} onChange={e=>setV(e.target.value)} onKeyDown={e=>{if(e.key==='Enter')submit()}} placeholder="Nuova attività…"/><button onClick={submit}>Aggiungi</button></div>}

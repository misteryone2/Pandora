'use client';

import { useEffect, useMemo, useState } from "react";

type Memory = {id:string;text:string;category:string;confidence:number;createdAt:string};
type Task = {id:string;title:string;done:boolean;createdAt:string};
type Message = {role:"user"|"pandora";text:string};

const memoryKey="pandora.memory.v2", taskKey="pandora.tasks.v2", chatKey="pandora.chat.v2";
const makeId = () => typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
  ? crypto.randomUUID()
  : `${Date.now()}-${Math.random().toString(36).slice(2)}`;

export default function Home(){
  const [tab,setTab]=useState<"chat"|"memory"|"tasks">("chat");
  const [input,setInput]=useState("");
  const [memories,setMemories]=useState<Memory[]>([]);
  const [tasks,setTasks]=useState<Task[]>([]);
  const [messages,setMessages]=useState<Message[]>([{role:"pandora",text:"Buongiorno. Sono Pandora. Posso ricordare, organizzare e aiutarti a costruire il tuo assistente personale."}]);

  useEffect(()=>{
    try{
      setMemories(JSON.parse(localStorage.getItem(memoryKey)||"[]"));
      setTasks(JSON.parse(localStorage.getItem(taskKey)||"[]"));
      const c=JSON.parse(localStorage.getItem(chatKey)||"null"); if(c) setMessages(c);
    }catch{}
  },[]);
  useEffect(()=>{localStorage.setItem(memoryKey,JSON.stringify(memories))},[memories]);
  useEffect(()=>{localStorage.setItem(taskKey,JSON.stringify(tasks))},[tasks]);
  useEffect(()=>{localStorage.setItem(chatKey,JSON.stringify(messages))},[messages]);

  const learn=(text:string)=>{
    const prefixes=["ricorda che ","ricordati che ","preferisco ","mi piace "];
    const p=prefixes.find(x=>text.toLowerCase().startsWith(x));
    if(!p) return null;
    const fact=text.slice(p.length).trim();
    if(!fact) return null;
    setMemories(old=>{
      const existing=old.find(m=>m.text.toLowerCase()===fact.toLowerCase());
      if(existing) return old.map(m=>m.id===existing.id?{...m,confidence:Math.min(1,m.confidence+.05)}:m);
      return [{id:makeId(),text:fact,category:p.includes("prefer")||p.includes("piace")?"Preferenza":"Memoria",confidence:.75,createdAt:new Date().toISOString()},...old];
    });
    return `Memorizzato: ${fact}`;
  };

  const answer=(text:string)=>{
    const learned=learn(text); if(learned) return learned;
    const l=text.toLowerCase();
    if(l.includes("cosa ricordi")||l.includes("cosa sai di me")){
      return memories.length ? memories.slice(0,8).map(m=>`• ${m.text}`).join("\n") : "Non ho ancora memorie consolidate.";
    }
    if(l.startsWith("aggiungi attività ")||l.startsWith("aggiungi attività:")){
      const title=text.replace(/^aggiungi attività\s*: ?/i,"").replace(/^aggiungi attività\s*/i,"").trim();
      if(title){setTasks(t=>[{id:makeId(),title,done:false,createdAt:new Date().toISOString()},...t]);return `Attività aggiunta: ${title}`;}
    }
    return "Posso già gestire memoria e attività localmente. Il prossimo modulo collegherà il motore AI e gli strumenti, mantenendo questa memoria come base.";
  };

  const send=()=>{
    const text=input.trim(); if(!text)return;
    const reply=answer(text);
    setMessages(m=>[...m,{role:"user",text},{role:"pandora",text:reply}]);
    setInput("");
  };

  const pending=useMemo(()=>tasks.filter(t=>!t.done).length,[tasks]);

  return <main>
    <header><div><span className="orb">✦</span><div><h1>Pandora</h1><p>Personal Agent · v0.2</p></div></div><span className="status">● locale</span></header>

    <section className="hero">
      <div><small>STATO DEL SISTEMA</small><h2>Il nucleo è online.</h2><p>Memoria locale, apprendimento esplicito e attività sono già disponibili.</p></div>
      <div className="stats"><b>{memories.length}<span> memorie</span></b><b>{pending}<span> attività</span></b></div>
    </section>

    <nav>{(["chat","memory","tasks"] as const).map(x=><button className={tab===x?"active":""} onClick={()=>setTab(x)} key={x}>{x==="chat"?"Pandora":x==="memory"?"Memoria":"Attività"}</button>)}</nav>

    {tab==="chat" && <section className="panel chat">
      <div className="messages">{messages.map((m,i)=><div key={i} className={m.role}><span>{m.role==="pandora"?"✦":"Tu"}</span><p>{m.text}</p></div>)}</div>
      <div className="composer"><textarea value={input} onChange={e=>setInput(e.target.value)} onKeyDown={e=>{if(e.key==="Enter"&&!e.shiftKey){e.preventDefault();send()}}} placeholder="Parla con Pandora…"/><button onClick={send}>↑</button></div>
      <div className="hint">Prova: “ricorda che mi piacciono le risposte pratiche”</div>
    </section>}

    {tab==="memory" && <section className="panel"><div className="panelhead"><h2>Memoria</h2><span>{memories.length}</span></div>{memories.length===0?<p className="empty">Nessuna memoria. Insegna qualcosa a Pandora dalla chat.</p>:memories.map(m=><article className="memory" key={m.id}><div><b>{m.text}</b><small>{m.category} · {Math.round(m.confidence*100)}% fiducia</small></div><button onClick={()=>setMemories(x=>x.filter(a=>a.id!==m.id))}>×</button></article>)}</section>}

    {tab==="tasks" && <section className="panel"><div className="addtask"><input id="newtask" placeholder="Nuova attività…" onKeyDown={e=>{if(e.key==="Enter"){const v=e.currentTarget.value.trim();if(v){setTasks(t=>[{id:makeId(),title:v,done:false,createdAt:new Date().toISOString()},...t]);e.currentTarget.value=""}}}}/><button onClick={()=>{const el=document.getElementById("newtask") as HTMLInputElement;const v=el.value.trim();if(v){setTasks(t=>[{id:makeId(),title:v,done:false,createdAt:new Date().toISOString()},...t]);el.value=""}}}>Aggiungi</button></div>{tasks.map(t=><label className="task" key={t.id}><input type="checkbox" checked={t.done} onChange={()=>setTasks(x=>x.map(a=>a.id===t.id?{...a,done:!a.done}:a))}/><span className={t.done?"done":""}>{t.title}</span><button onClick={()=>setTasks(x=>x.filter(a=>a.id!==t.id))}>×</button></label>)}</section>}

    <footer>Pandora v0.2 · memoria sul dispositivo · pronta per il collegamento al Core AI</footer>
  </main>
}

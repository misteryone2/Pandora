'use client';

import { useEffect, useMemo, useState } from "react";

type Tab = "chat" | "memory" | "tasks" | "activity" | "settings";
type Memory = { id: string; text: string; category: string; confidence: number; createdAt: string };
type Task = { id: string; title: string; done: boolean; createdAt: string };
type Message = { id: string; role: "user" | "pandora"; text: string; createdAt: string; mode?: string };
type Activity = { id: string; type: string; text: string; createdAt: string };

const KEYS = {
  memory: "pandora.memory.v3",
  tasks: "pandora.tasks.v3",
  chat: "pandora.chat.v3",
  activity: "pandora.activity.v3",
  autonomy: "pandora.autonomy.v1",
};

const makeId = () => typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
  ? crypto.randomUUID()
  : `${Date.now()}-${Math.random().toString(36).slice(2)}`;

const now = () => new Date().toISOString();

export default function Home() {
  const [tab, setTab] = useState<Tab>("chat");
  const [input, setInput] = useState("");
  const [memories, setMemories] = useState<Memory[]>([]);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [messages, setMessages] = useState<Message[]>([]);
  const [activity, setActivity] = useState<Activity[]>([]);
  const [autonomy, setAutonomy] = useState(true);
  const [loading, setLoading] = useState(false);
  const [mode, setMode] = useState("locale");
  const [hydrated, setHydrated] = useState(false);
  const [coreOnline, setCoreOnline] = useState(false);
  const [coreStats, setCoreStats] = useState<{cycles:number; actions:number; queue:number}>({cycles:0, actions:0, queue:0});

  useEffect(() => {
    try {
      const read = <T,>(key: string, fallback: T): T => {
        const raw = localStorage.getItem(key);
        return raw ? JSON.parse(raw) as T : fallback;
      };
      setMemories(read<Memory[]>(KEYS.memory, []));
      setTasks(read<Task[]>(KEYS.tasks, []));
      setMessages(read<Message[]>(KEYS.chat, [{ id: makeId(), role: "pandora", text: "Ciao Mattia. Sono Pandora. Il mio nucleo locale è attivo. Posso gestire memoria, attività e conversazioni; il mio nucleo locale è separato dall’interfaccia.", createdAt: now(), mode: "locale" }]));
      setActivity(read<Activity[]>(KEYS.activity, []));
      setAutonomy(read<boolean>(KEYS.autonomy, true));
    } catch {}
    setHydrated(true);
  }, []);

  useEffect(() => { if (hydrated) localStorage.setItem(KEYS.memory, JSON.stringify(memories)); }, [memories, hydrated]);
  useEffect(() => { if (hydrated) localStorage.setItem(KEYS.tasks, JSON.stringify(tasks)); }, [tasks, hydrated]);
  useEffect(() => { if (hydrated) localStorage.setItem(KEYS.chat, JSON.stringify(messages.slice(-100))); }, [messages, hydrated]);
  useEffect(() => { if (hydrated) localStorage.setItem(KEYS.activity, JSON.stringify(activity.slice(-100))); }, [activity, hydrated]);
  useEffect(() => { if (hydrated) localStorage.setItem(KEYS.autonomy, JSON.stringify(autonomy)); }, [autonomy, hydrated]);

  useEffect(() => {
    if (typeof navigator !== "undefined" && "serviceWorker" in navigator) navigator.serviceWorker.register("/sw.js").catch(() => {});
  }, []);

  useEffect(() => {
    let alive = true;
    const sync = async () => {
      try { const r = await fetch("/api/core/autonomy", { cache: "no-store" }); const d = await r.json(); if (!alive) return; setCoreOnline(Boolean(d.ok)); if (d.ok) { setCoreStats({ cycles: d.stats?.cycles || 0, actions: d.stats?.actions || 0, queue: d.queue || 0 }); setAutonomy(Boolean(d.autonomy)); } } catch { if (alive) setCoreOnline(false); }
    };
    sync(); const timer = window.setInterval(sync, 15000); return () => { alive = false; window.clearInterval(timer); };
  }, []);

  const log = (type: string, text: string) => setActivity(a => [{ id: makeId(), type, text, createdAt: now() }, ...a].slice(0, 100));

  const learn = (text: string) => {
    const lower = text.toLowerCase();
    const prefixes = ["ricorda che ", "ricordati che ", "preferisco ", "mi piace ", "non mi piace "];
    const prefix = prefixes.find(p => lower.startsWith(p));
    if (!prefix) return null;
    const fact = text.slice(prefix.length).trim();
    if (!fact) return null;
    const category = prefix.includes("prefer") || prefix.includes("piace") ? "Preferenza" : "Memoria";
    setMemories(old => {
      const existing = old.find(m => m.text.toLowerCase() === fact.toLowerCase());
      if (existing) return old.map(m => m.id === existing.id ? { ...m, confidence: Math.min(1, m.confidence + .05) } : m);
      return [{ id: makeId(), text: fact, category, confidence: .75, createdAt: now() }, ...old];
    });
    log("memoria", `Memorizzato: ${fact}`);
    return `Memorizzato. Terrò presente: ${fact}`;
  };

  const addTask = (title: string) => {
    const clean = title.trim();
    if (!clean) return;
    setTasks(t => [{ id: makeId(), title: clean, done: false, createdAt: now() }, ...t]);
    log("attività", `Creata attività: ${clean}`);
  };

  const localAnswer = (text: string) => {
    const learned = learn(text); if (learned) return learned;
    const l = text.toLowerCase();
    if (l.includes("cosa ricordi") || l.includes("cosa sai di me")) {
      return memories.length ? `Queste sono le memorie che ho consolidate:\n${memories.slice(0, 12).map(m => `• ${m.text}`).join("\n")}` : "Non ho ancora memorie consolidate.";
    }
    if (l.startsWith("aggiungi attività") || l.startsWith("aggiungi attività:")) {
      const title = text.replace(/^aggiungi attività\s*: ?/i, "").replace(/^aggiungi attività\s*/i, "").trim();
      if (title) { addTask(title); return `Attività aggiunta: ${title}`; }
    }
    if (l.includes("quante attività")) return `Hai ${tasks.filter(t => !t.done).length} attività aperte.`;
    return "Sono in modalità locale. Posso ricordare informazioni, creare attività e organizzare ciò che mi dai. Avviando Pandora Core posso usare il cervello locale.";
  };

  const send = async () => {
    const text = input.trim();
    if (!text || loading) return;
    const userMessage: Message = { id: makeId(), role: "user", text, createdAt: now() };
    setMessages(m => [...m, userMessage]);
    setInput("");
    setLoading(true);
    log("conversazione", `Messaggio ricevuto: ${text.slice(0, 80)}`);

    const learned = learn(text);
    if (learned) {
      const reply: Message = { id: makeId(), role: "pandora", text: learned, createdAt: now(), mode: "locale" };
      setMessages(m => [...m, reply]); setLoading(false); return;
    }

    try {
      const res = await fetch("/api/core/chat", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ messages: [...messages, userMessage], memories, tasks }) });
      const data = await res.json();
      if (data.ok && data.text) {
        setMode(data.mode || "ai");
        const taskMatches = data.text.match(/\[TASK\]\s*(.+)/gi) || [];
        taskMatches.forEach((line: string) => addTask(line.replace(/^\[TASK\]\s*/i, "")));
        setMessages(m => [...m, { id: makeId(), role: "pandora", text: data.text.replace(/^\[TASK\].*$/gim, "").trim() || "Attività registrata.", createdAt: now(), mode: data.mode }]);
      } else {
        setMode("locale");
        setMessages(m => [...m, { id: makeId(), role: "pandora", text: localAnswer(text), createdAt: now(), mode: "locale" }]);
      }
    } catch {
      setMode("locale");
      setMessages(m => [...m, { id: makeId(), role: "pandora", text: localAnswer(text), createdAt: now(), mode: "locale" }]);
    } finally { setLoading(false); }
  };

  const pending = useMemo(() => tasks.filter(t => !t.done).length, [tasks]);
  const completed = useMemo(() => tasks.filter(t => t.done).length, [tasks]);
  const lastActivity = activity[0];

  const clearAll = () => {
    if (!confirm("Eliminare memoria, attività, conversazioni e registro locale?")) return;
    setMemories([]); setTasks([]); setMessages([]); setActivity([]); log("sistema", "Archivio locale azzerato");
  };

  return <main>
    <header>
      <div className="brand"><span className="orb">✦</span><div><h1>Pandora</h1><p>Personal Autonomous Assistant</p></div></div>
      <div className="header-right"><span className={`status ${coreOnline ? "ai" : ""}`}>● {coreOnline ? "Core locale" : "Core offline"}</span><span className="version">v1.2</span></div>
    </header>

    <section className="hero">
      <div><small>STATO DEL SISTEMA</small><h2>{autonomy ? "Nucleo operativo." : "Autonomia in pausa."}</h2><p>{autonomy ? "Memoria, attività, apprendimento esplicito e Core locale sono pronti." : "Le azioni automatiche sono sospese. La chat resta disponibile."}</p></div>
      <div className="stats"><div><b>{memories.length}</b><span>memorie</span></div><div><b>{pending}</b><span>aperte</span></div><div><b>{completed}</b><span>completate</span></div></div>
    </section>

    <nav className="tabs">{(["chat","memory","tasks","activity","settings"] as Tab[]).map(x => <button className={tab === x ? "active" : ""} onClick={() => setTab(x)} key={x}>{x === "chat" ? "Pandora" : x === "memory" ? "Memoria" : x === "tasks" ? "Attività" : x === "activity" ? "Registro" : "Impostazioni"}</button>)}</nav>

    {tab === "chat" && <section className="panel chat-panel">
      <div className="chat-toolbar"><span>Conversazione</span><small>{loading ? "Pandora sta pensando…" : autonomy ? "autonomia attiva" : "pausa"}</small></div>
      <div className="messages">{messages.length === 0 && <div className="empty-chat"><strong>Inizia una conversazione</strong><span>Puoi chiedermi di ricordare qualcosa, creare un'attività o usare il Core locale.</span></div>}
        {messages.map(m => <div key={m.id} className={`message ${m.role}`}><span className="avatar">{m.role === "pandora" ? "✦" : "Tu"}</span><div><p>{m.text}</p><small>{new Date(m.createdAt).toLocaleTimeString("it-IT", { hour: "2-digit", minute: "2-digit" })}{m.mode ? ` · ${m.mode}` : ""}</small></div></div>)}
        {loading && <div className="message pandora"><span className="avatar">✦</span><div><p className="typing">•••</p></div></div>}
      </div>
      <div className="composer"><textarea value={input} onChange={e => setInput(e.target.value)} onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); } }} placeholder="Parla con Pandora…" rows={1}/><button onClick={send} disabled={loading || !input.trim()}>↑</button></div>
      <div className="quick"><button onClick={() => setInput("Ricorda che ")}>+ Memoria</button><button onClick={() => setInput("Aggiungi attività ")}>+ Attività</button><button onClick={() => setInput("Cosa ricordi di me?")}>Cosa ricordi?</button></div>
    </section>}

    {tab === "memory" && <section className="panel"><div className="panelhead"><div><small>LONG-TERM MEMORY</small><h2>Memoria</h2></div><span>{memories.length}</span></div>{memories.length === 0 ? <p className="empty">Nessuna memoria. Scrivi in chat “ricorda che…”</p> : memories.map(m => <article className="memory" key={m.id}><div><b>{m.text}</b><small>{m.category} · {Math.round(m.confidence * 100)}% · {new Date(m.createdAt).toLocaleDateString("it-IT")}</small></div><button aria-label="Elimina memoria" onClick={() => { setMemories(x => x.filter(a => a.id !== m.id)); log("memoria", `Eliminata: ${m.text}`); }}>×</button></article>)}</section>}

    {tab === "tasks" && <section className="panel"><div className="panelhead"><div><small>PERSONAL WORK QUEUE</small><h2>Attività</h2></div><span>{pending} aperte</span></div><TaskInput onAdd={addTask}/><div className="task-list">{tasks.length === 0 ? <p className="empty">Nessuna attività.</p> : tasks.map(t => <label className="task" key={t.id}><input type="checkbox" checked={t.done} onChange={() => { setTasks(x => x.map(a => a.id === t.id ? { ...a, done: !a.done } : a)); log("attività", `${t.done ? "Riaperta" : "Completata"}: ${t.title}`); }}/><span className={t.done ? "done" : ""}>{t.title}</span><button type="button" aria-label="Elimina attività" onClick={e => { e.preventDefault(); setTasks(x => x.filter(a => a.id !== t.id)); log("attività", `Eliminata: ${t.title}`); }}>×</button></label>)}</div></section>}

    {tab === "activity" && <section className="panel"><div className="panelhead"><div><small>AUDIT LOG</small><h2>Registro</h2></div><span>{activity.length}</span></div>{lastActivity && <div className="last-action"><span>ULTIMA AZIONE</span><b>{lastActivity.text}</b></div>}{activity.length === 0 ? <p className="empty">Nessuna attività registrata.</p> : activity.map(a => <div className="log" key={a.id}><i>{a.type}</i><span>{a.text}</span><time>{new Date(a.createdAt).toLocaleString("it-IT", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })}</time></div>)}</section>}

    {tab === "settings" && <section className="panel settings"><div className="panelhead"><div><small>CONTROL PLANE</small><h2>Impostazioni</h2></div></div>
      <div className="setting"><div><b>Autonomia</b><span>Consente a Pandora di applicare automaticamente le azioni locali sicure. {coreOnline ? `Cicli: ${coreStats.cycles} · azioni: ${coreStats.actions} · coda: ${coreStats.queue}.` : "Core non raggiungibile: il controllo locale resta disponibile."}</span></div><button className={`switch ${autonomy ? "on" : ""}`} onClick={async () => { const next=!autonomy; setAutonomy(next); log("sistema", `Autonomia ${next ? "attivata" : "messa in pausa"}`); try { await fetch("/api/core/autonomy", { method:"POST", headers:{"Content-Type":"application/json"}, body:JSON.stringify({enabled:next}) }); } catch {} }}><span/></button></div>
      <div className="setting"><div><b>Core locale</b><span>Pandora Core gira sul tuo computer/server. Stato corrente: <strong>{mode === "ai" ? "collegato" : "non rilevato"}</strong>.</span></div><code>PANDORA_CORE_URL</code></div>
      <div className="danger"><div><b>Azzeramento locale</b><span>Cancella memoria, attività, conversazioni e registro salvati su questo dispositivo.</span></div><button onClick={clearAll}>Cancella dati</button></div>
      <div className="architecture"><b>Architettura v1.2</b><p>iPhone/PWA → API → Core locale → coda eventi → planner → azioni sicure → osservazioni → memoria.</p><small>Il ciclo autonomo è event-driven: nessun polling continuo. Il Core dorme quando non c’è lavoro e si risveglia alla scadenza di un evento o di una manutenzione.</small></div>
    </section>}

    <footer><span>Pandora v1.2</span><span>·</span><span>local-first</span><span>·</span><span>autonomous core</span></footer>
  </main>;
}

function TaskInput({ onAdd }: { onAdd: (title: string) => void }) {
  const [value, setValue] = useState("");
  const submit = () => { if (value.trim()) { onAdd(value); setValue(""); } };
  return <div className="addtask"><input value={value} onChange={e => setValue(e.target.value)} onKeyDown={e => { if (e.key === "Enter") submit(); }} placeholder="Nuova attività…"/><button onClick={submit}>Aggiungi</button></div>;
}

'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';


type Tab = 'chat'|'research'|'memory'|'tasks'|'activity'|'settings';
type Memory = { id:string; text:string; category:string; confidence:number; createdAt:string; updatedAt?:string; evidence:number; lastConfirmed:string };
type Task = { id:string; title:string; done:boolean; createdAt:string; priority:number };
type Message = { id:string; role:'user'|'pandora'; text:string; createdAt:string; mode?:string };
type Activity = { id:string; type:string; text:string; createdAt:string };
type LearningStatus = 'consolidated'|'candidate';
type Learning = { id:string; text:string; kind:string; confidence:number; createdAt:string; evidence:number; status:LearningStatus };
type Candidate = { id:string; text:string; kind:string; confidence:number; source:string; createdAt:string };
type ResearchSource = { id:string; title:string; url:string; extract:string; source:string; fetchedAt:string };
type Research = { id:string; query:string; createdAt:string; sources:ResearchSource[]; summary:string; keywords:string[] };
type GovernorState = 'idle'|'thinking'|'acting'|'verifying'|'waiting'|'blocked';

type SpeechRecognitionResultEvent = Event & { results: ArrayLike<ArrayLike<{ transcript?: string }>> };
type SpeechRecognitionLike = {
  lang: string;
  interimResults: boolean;
  continuous: boolean;
  onresult: ((event: SpeechRecognitionResultEvent) => void) | null;
  onend: (() => void) | null;
  onerror: (() => void) | null;
  start: () => void;
  stop: () => void;
};
type SpeechRecognitionConstructor = new () => SpeechRecognitionLike;
declare global {
  interface Window {
    SpeechRecognition?: SpeechRecognitionConstructor;
    webkitSpeechRecognition?: SpeechRecognitionConstructor;
  }
}
type Store = { memories:Memory[]; tasks:Task[]; messages:Message[]; activity:Activity[]; learning:Learning[]; candidates:Candidate[]; researches:Research[]; autonomy:boolean; cycles:number; actions:number; governor:GovernorState; lastDecision:string; failureStreak:number; blockedUntil:number };

const KEY='pandora.phone.v2';
const LEGACY_KEYS=['pandora.phone.v1.9','pandora.phone.v1.8','pandora.phone.v1'];
const id=()=>crypto.randomUUID?.()||`${Date.now()}-${Math.random().toString(36).slice(2)}`;
const iso=()=>new Date().toISOString();
const empty:Store={memories:[],tasks:[],messages:[],activity:[],learning:[],candidates:[],researches:[],autonomy:true,cycles:0,actions:0,governor:'idle',lastDecision:'Nessuna decisione autonoma ancora.',failureStreak:0,blockedUntil:0};
const makeLearning=(text:string,kind:string,confidence:number,status:LearningStatus='consolidated',evidence=1):Learning=>({id:id(),text,kind,confidence,createdAt:iso(),evidence,status});
const makeMemory=(text:string,category:string,confidence:number,evidence=1):Memory=>({id:id(),text,category,confidence,createdAt:iso(),evidence,lastConfirmed:iso()});

function readStore():Store{
  try{
    const raw=localStorage.getItem(KEY)||LEGACY_KEYS.map(k=>localStorage.getItem(k)).find(Boolean); if(!raw)return empty;
    const p=JSON.parse(raw);
    const memories=(p.memories||[]).map((m:any)=>({...m,id:m.id||id(),text:String(m.text||''),category:String(m.category||'Memoria'),confidence:Number.isFinite(m.confidence)?m.confidence:.7,evidence:Number.isFinite(m.evidence)?m.evidence:1,lastConfirmed:m.lastConfirmed||m.updatedAt||m.createdAt||iso()}));
    const learning=(p.learning||[]).map((x:any)=>makeLearning(String(x.text||''),String(x.kind||'generale'),Number.isFinite(x.confidence)?x.confidence:.5,x.status==='candidate'?'candidate':'consolidated',Number.isFinite(x.evidence)?x.evidence:1));
    return {...empty,...p,memories,tasks:p.tasks||[],messages:p.messages||[],activity:p.activity||[],learning,candidates:p.candidates||[],researches:p.researches||[],governor:'idle',lastDecision:p.lastDecision||empty.lastDecision,failureStreak:Number.isFinite(p.failureStreak)?p.failureStreak:0,blockedUntil:Number.isFinite(p.blockedUntil)?p.blockedUntil:0};
  }catch{return empty;}
}
function writeStore(s:Store){try{localStorage.setItem(KEY,JSON.stringify(s));}catch{}}

export default function Home(){
  const [tab,setTab]=useState<Tab>('chat');
  const [input,setInput]=useState('');
  const [store,setStore]=useState<Store>(empty);
  const [hydrated,setHydrated]=useState(false);
  const [loading,setLoading]=useState(false);
  const [researchQuery,setResearchQuery]=useState('');
  const [researchLoading,setResearchLoading]=useState(false);
  const [voiceListening,setVoiceListening]=useState(false);
  const [voiceSpeaking,setVoiceSpeaking]=useState(false);
  const recognitionRef=useRef<SpeechRecognitionLike|null>(null);
  const voiceReplyRef=useRef(false);
  const autonomyLock=useRef(false);
  const autonomyTimer=useRef<number|null>(null);

  useEffect(()=>{const s=readStore();if(!s.messages.length)s.messages=[{id:id(),role:'pandora',text:'Ciao. Sono Pandora. Il mio nucleo è locale: memoria, contesto, autonomia e strumenti sono separati e verificabili. Posso anche interagire vocalmente quando il browser lo consente.',createdAt:iso(),mode:'phone-local'}];setStore(s);setHydrated(true);if('serviceWorker' in navigator)navigator.serviceWorker.register('/sw.js').catch(()=>{});},[]);
  useEffect(()=>{if(hydrated)writeStore(store);},[store,hydrated]);

  const log=useCallback((type:string,text:string)=>setStore(s=>({...s,activity:[{id:id(),type,text,createdAt:iso()},...s.activity].slice(0,180)})),[]);

  const scheduleAutonomy=useCallback((reason:string)=>{
    if(!hydrated||!store.autonomy||autonomyLock.current)return;
    if(autonomyTimer.current)window.clearTimeout(autonomyTimer.current);
    autonomyTimer.current=window.setTimeout(()=>{
      autonomyLock.current=true;
      setStore(s=>{
        const now=Date.now();
        if(!s.autonomy||s.blockedUntil>now){autonomyLock.current=false;return s;}
        const open=s.tasks.filter(t=>!t.done).sort((a,b)=>b.priority-a.priority);
        const key=open.length?`task:${open[0].id}`:'idle';
        if(s.lastDecision===key){autonomyLock.current=false;return {...s,governor:'waiting'};}
        const decision=open.length?`task:${open[0].id}`:'idle';
        const activity=open.length?`Decisione autonoma: monitoro “${open[0].title}” (nessuna azione esterna autorizzata).`:`Decisione autonoma: nessuna azione necessaria.`;
        autonomyLock.current=false;
        return {...s,cycles:s.cycles+1,governor:'waiting',lastDecision:decision,activity:[{id:id(),type:'governor',text:`${activity} · trigger: ${reason}`,createdAt:iso()},...s.activity].slice(0,180)};
      });
    },900);
  },[hydrated,store.autonomy]);

  useEffect(()=>{if(hydrated&&store.autonomy)scheduleAutonomy('stato');return()=>{if(autonomyTimer.current)window.clearTimeout(autonomyTimer.current)};},[hydrated,store.autonomy,scheduleAutonomy]);

  const rememberFact=useCallback((fact:string,category='Memoria',confidence=.8,source='conversazione')=>{
    const clean=fact.trim();if(!clean)return;
    setStore(s=>{
      const old=s.memories.find(m=>m.text.toLowerCase()===clean.toLowerCase());
      if(old)return {...s,memories:s.memories.map(m=>m.id===old.id?{...m,confidence:Math.min(1,m.confidence+.05),evidence:m.evidence+1,lastConfirmed:iso(),updatedAt:iso()}:m),learning:[makeLearning(`Memoria rinforzata: ${clean}`,'memoria',Math.min(1,old.confidence+.05),'consolidated',old.evidence+1),...s.learning].slice(0,300)};
      return {...s,memories:[makeMemory(clean,category,confidence),...s.memories].slice(0,300),learning:[makeLearning(`Nuova memoria: ${clean}`,'memoria',confidence,'consolidated',1),...s.learning].slice(0,300)};
    });
    log('apprendimento',`${source}: ${clean}`);
  },[log]);

  const addCandidate=useCallback((text:string,kind:string,confidence:number,source:string)=>{const clean=text.trim();if(!clean)return;setStore(s=>{const old=s.candidates.find(c=>c.text.toLowerCase()===clean.toLowerCase());if(old)return {...s,candidates:s.candidates.map(c=>c.id===old.id?{...c,confidence:Math.min(1,c.confidence+.05)}:c)};return {...s,candidates:[{id:id(),text:clean,kind,confidence,source,createdAt:iso()},...s.candidates].slice(0,40),learning:[makeLearning(`Candidato: ${clean}`,kind,confidence,'candidate',1),...s.learning].slice(0,300)}});log('apprendimento',`Candidato: ${clean}`);},[log]);

  const explicitMemory=(text:string)=>{const patterns:[RegExp,string,number][]=[[/^ricorda(?:ti)? che\s+/i,'Memoria',.99],[/^preferisco\s+/i,'Preferenza',.98],[/^mi piace\s+/i,'Preferenza',.98],[/^non mi piace\s+/i,'Preferenza negativa',.98],[/^non voglio\s+/i,'Vincolo',.98],[/^odio\s+/i,'Preferenza negativa',.98],[/^amo\s+/i,'Preferenza',.98]];const hit=patterns.find(([r])=>r.test(text));if(!hit)return null;const fact=text.replace(hit[0],'').trim();if(!fact)return null;rememberFact(fact,hit[1],hit[2],'istruzione esplicita');return `Memorizzato. Lo terrò presente: ${fact}`;};
  const inferLearning=(text:string)=>{const patterns:[RegExp,string,string,number,boolean][]=[[/\bmi chiamo\s+([a-zà-ÿ][a-zà-ÿ' -]{1,40})/i,'profilo','Hai indicato il nome: $1',.98,true],[/\bpreferisco\s+(.{2,120})$/i,'preferenza','Preferisci: $1',.84,true],[/\bmi piace\s+(.{2,120})$/i,'preferenza','Ti piace: $1',.84,true],[/\bnon mi piace\s+(.{2,120})$/i,'preferenza','Non ti piace: $1',.84,true],[/\bnon voglio\s+(.{2,120})$/i,'vincolo','Vincolo: $1',.9,true],[/\bvorrei\s+(.{2,120})$/i,'obiettivo','Possibile obiettivo: $1',.68,false],[/\bdevo\s+(.{2,120})$/i,'obiettivo','Possibile attività: $1',.68,false],[/\bmi interessa\s+(.{2,120})$/i,'interesse','Interesse: $1',.65,false]];for(const[r,kind,t,c,strong]of patterns){const m=r.exec(text);if(!m)continue;const value=m[1].trim().replace(/[.!?]+$/,'');if(value.length<2)continue;const fact=t.replace('$1',value);if(strong)rememberFact(fact,kind==='profilo'?'Profilo':kind==='vincolo'?'Vincolo':'Preferenza',c);else addCandidate(fact,kind,c,'conversazione');return{kind,value,strong};}return null;};
  const relevant=(text:string)=>{const words=text.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'').split(/[^a-z0-9]+/).filter(w=>w.length>3);return store.memories.map(m=>({m,score:words.filter(w=>m.text.toLowerCase().includes(w)).length})).filter(x=>x.score>0).sort((a,b)=>b.score-a.score).slice(0,4).map(x=>x.m);};

  const addTask=(title:string)=>{const clean=title.trim();if(!clean)return;setStore(s=>({...s,tasks:[{id:id(),title:clean,done:false,createdAt:iso(),priority:1},...s.tasks]}));log('attività',`Creata attività: ${clean}`);scheduleAutonomy('nuova attività');};

  const answer=async(text:string):Promise<string>=>{
    const l=text.toLowerCase().trim();

    // 1) Explicit correction: update the most relevant memory instead of blindly deleting the newest one.
    if(/^(non è vero|non e vero|sbagliato|non è così|non e cosi)\b/i.test(l)){
      const lastUser=store.messages.filter(m=>m.role==='user').slice(-2,-1)[0]?.text;
      const target=relevant(lastUser||'')[0]||store.memories[0];
      if(target){
        setStore(s=>({...s,memories:s.memories.filter(m=>m.id!==target.id),learning:[makeLearning(`Corretta memoria: ${target.text}`,'correzione',1,'consolidated',1),...s.learning].slice(0,300),governor:'verifying'}));
        log('correzione',`Memoria corretta: ${target.text}`);
        return `Ho identificato la memoria collegata e l'ho rimossa: “${target.text}”. Ora puoi indicarmi il dato corretto.`;
      }
      return 'Non trovo una memoria collegata da correggere. Dimmi direttamente quale informazione devo sostituire.';
    }

    // 2) Explicit memory always wins over generic conversation handling.
    const explicit=explicitMemory(text); if(explicit)return explicit;
    const inferred=inferLearning(text);

    // 3) Stable self/context queries.
    if(l.includes('cosa ricordi')||l.includes('cosa sai di me')){
      if(!store.memories.length)return 'Al momento non ho memorie consolidate su di te. Posso però usare il contesto di questa conversazione e imparare informazioni che mi chiedi esplicitamente di ricordare.';
      return `Queste sono le informazioni che ho memorizzato:\n${store.memories.slice(0,15).map(m=>`• ${m.text} (${Math.round(m.confidence*100)}%, ${m.evidence} evidenze)`).join('\n')}`;
    }
    if(l.includes('come preferisco')||l.includes('quale è la mia preferenza')||l.includes('qual è la mia preferenza')){
      const prefs=store.memories.filter(m=>/preferenza/i.test(m.category)||/preferisci|preferisco|piace|non ti piace/i.test(m.text));
      return prefs.length?`La preferenza che risulta attualmente memorizzata è: ${prefs[0].text}.`:'Non ho una preferenza consolidata su questo punto.';
    }
    if(l.includes('cosa stavamo facendo')||l.includes('dove eravamo rimasti')){
      const recent=store.messages.filter(m=>m.role==='user').slice(-6).map(m=>m.text);
      const open=store.tasks.filter(t=>!t.done);
      return `Contesto attuale: stiamo costruendo Pandora come assistente personale autonomo. Le ultime richieste trattavano memoria, autonomia, ricerca e voce.${open.length?` Hai inoltre ${open.length} attività aperte: ${open.slice(0,3).map(t=>t.title).join(', ')}.`:''} ${recent.length?`Ultimo tema: “${recent[recent.length-1]}”.`:''}`;
    }

    // 4) Ask for missing information instead of pretending to know an unspecified goal.
    if(/ho un obiettivo ma non|non ti dirò ancora quale|non ti diro ancora quale/i.test(l)){
      return 'Per aiutarti senza inventare, mi servono almeno: obiettivo, risultato desiderato, scadenza (se esiste), vincoli e risorse/strumenti disponibili. Finché manca l’obiettivo non eseguo azioni arbitrarie.';
    }

    // 5) Planning: use existing tasks; do not invent work.
    if(l.includes('organizza il mio lavoro')||l.includes('organizza il lavoro')||l.includes('pianifica il mio lavoro')){
      const open=store.tasks.filter(t=>!t.done).sort((a,b)=>b.priority-a.priority);
      if(!open.length)return 'Non ho ancora attività concrete da organizzare. Per non inventare lavoro, dimmi le attività o collegami a una fonte da cui recuperarle.';
      return `Piano operativo:\n${open.slice(0,8).map((t,i)=>`${i+1}. ${t.title}`).join('\n')}\n\nOrdine basato sulle priorità disponibili. Non modifico né completo attività senza una richiesta o uno strumento autorizzato.`;
    }

    // 6) Autonomous status: report and allow idle as a valid decision.
    if(l.includes('controlla')&&l.includes('intervento')){
      const open=store.tasks.filter(t=>!t.done);
      if(!open.length)return 'Controllo completato: non rilevo attività aperte che richiedano un intervento. Rimango in attesa.';
      return `Controllo completato: ci sono ${open.length} attività aperte. La più prioritaria è “${open.sort((a,b)=>b.priority-a.priority)[0].title}”. Non eseguo azioni esterne senza autorizzazione.`;
    }

    // 7) Research request from chat: execute the local research engine instead of merely acknowledging it.
    if(/\b(cerca|ricerca|informazioni|approfondisci)\b/i.test(l) && /pandora|progetto|assistente|autonom/i.test(l)){
      const q=text.replace(/^.*?\b(?:su|sul|sulla|riguardo a|per)\b\s*/i,'').trim() || 'tecnologie per un assistente personale autonomo locale';
      try{
        const url=`https://it.wikipedia.org/w/api.php?action=query&generator=search&gsrsearch=${encodeURIComponent(q)}&gsrlimit=6&prop=extracts&exintro=1&explaintext=1&format=json&origin=*`;
        const rr=await fetch(url); if(!rr.ok)throw new Error('research');
        const data=await rr.json();
        const pages=Object.values(data.query?.pages||{}) as any[];
        const sources:ResearchSource[]=pages.map((x:any)=>({id:id(),title:x.title||'Senza titolo',url:`https://it.wikipedia.org/wiki/${encodeURIComponent((x.title||'').replace(/ /g,'_'))}`,extract:String(x.extract||'').slice(0,1200),source:'Wikipedia',fetchedAt:iso()})).filter(x=>x.extract);
        const result:Research={id:id(),query:q,createdAt:iso(),sources,summary:buildSummary(q,sources),keywords:makeKeywords(q)};
        setStore(s=>({...s,researches:[result,...s.researches].slice(0,30),activity:[{id:id(),type:'ricerca',text:`Ricerca da chat completata: ${q} · ${sources.length} fonti`,createdAt:iso()},...s.activity].slice(0,180)}));
        return sources.length?`Ho eseguito la ricerca su “${q}”. Ho trovato ${sources.length} fonti e prodotto questa sintesi:\n\n${result.summary}`:'La ricerca non ha restituito fonti utilizzabili.';
      }catch{return 'Ho provato a eseguire la ricerca, ma in questo momento la fonte web non è raggiungibile. Non considero la ricerca completata.';}
    }

    if(l.includes('autovaluta')||l.includes('analizza tutto quello')||l.includes('trova eventuali problemi')){
      const problems:string[]=[];
      if(store.memories.length===0)problems.push('memoria consolidata ancora vuota');
      if(store.tasks.length===0)problems.push('nessuna attività concreta disponibile per la pianificazione');
      if(store.researches.length===0)problems.push('nessuna ricerca ancora eseguita');
      const p=problems.length?problems.map(x=>`• ${x}`).join('\n'):'Non rilevo lacune evidenti nei moduli locali disponibili.';
      return `Autovalutazione:\n${p}\n\nProssimo passo utile: collegare planner, strumenti autorizzati e verifica dei risultati al Governor. Non considero completata un’azione finché il risultato non è verificato.`;
    }

    if(l.includes('stato')&&l.includes('autonomia'))return `Governor: ${store.governor}. Cicli: ${store.cycles}. Azioni: ${store.actions}. ${store.memories.length} memorie, ${store.learning.length} apprendimenti, ${store.tasks.filter(t=>!t.done).length} attività aperte.`;
    if(/^(?:aggiungi|crea|metti)\s+(?:un[ae]?\s+)?attivit[aà]/i.test(text)){const title=text.replace(/^(?:aggiungi|crea|metti)\s+(?:un[ae]?\s+)?attivit[aà]\s*:?[ ]*/i,'').trim();if(title){addTask(title);return `Attività aggiunta: ${title}.`;}}
    if(l.includes('quante attività')||l.includes('quante attivita'))return `Hai ${store.tasks.filter(t=>!t.done).length} attività aperte.`;
    if(l.includes('elenca')&&l.includes('attivit'))return store.tasks.filter(t=>!t.done).length?store.tasks.filter(t=>!t.done).map((t,i)=>`${i+1}. ${t.title}`).join('\n'):'Non hai attività aperte.';
    if(inferred?.kind==='obiettivo')return inferred.strong?`Ho registrato l’informazione. Posso trasformarla in un’attività quando me lo chiedi.`:`Ho rilevato un possibile obiettivo: “${inferred.value}”. Lo tengo come candidato, non come certezza.`;
    if(inferred?.kind==='interesse')return `Ho rilevato un possibile interesse per “${inferred.value}”. Per ora resta un candidato.`;
    if(inferred?.kind==='vincolo')return `Capito. Terrò conto di questo vincolo: “${inferred.value}”.`;

    const rel=relevant(text);
    if(/^(ciao|salve|hey|buongiorno|buonasera)\b/i.test(l))return 'Ciao. Sono pronta.';
    if(l.includes('cosa puoi fare')||l.includes('cosa sai fare'))return 'Posso gestire memoria, contesto, attività, ricerca e voce. Prima di agire verifico ciò che so, ciò che manca e se l’azione è autorizzata.';
    if(rel.length)return `Ho trovato nella memoria un’informazione pertinente: ${rel.map(m=>m.text).join('; ')}.`;
    if(/\?$/.test(text.trim()))return 'Mi manca abbastanza contesto per rispondere con precisione. Posso usare memoria, attività o ricerca se sono pertinenti.';
    return 'Ho ricevuto la richiesta. La valuto rispetto a contesto, memoria, obiettivi e azioni disponibili prima di decidere il prossimo passo.';
  };

  const speak=useCallback((text:string)=>{if(!('speechSynthesis'in window))return;window.speechSynthesis.cancel();const u=new SpeechSynthesisUtterance(text);u.lang='it-IT';u.rate=.98;u.onstart=()=>setVoiceSpeaking(true);u.onend=()=>setVoiceSpeaking(false);u.onerror=()=>setVoiceSpeaking(false);window.speechSynthesis.speak(u);},[]);

  const send=useCallback(async(textOverride?:string,fromVoice=false)=>{const text=(textOverride??input).trim();if(!text||loading)return;setLoading(true);const u:Message={id:id(),role:'user',text,createdAt:iso(),mode:fromVoice?'voice':'phone-local'};setStore(s=>({...s,messages:[...s.messages,u].slice(-120),governor:'thinking'}));if(!textOverride)setInput('');log('conversazione',`Messaggio ricevuto: ${text.slice(0,100)}`);await new Promise(r=>setTimeout(r,80));const reply=await answer(text);setStore(s=>{const replyMessage:Message={id:id(),role:'pandora',text:reply,createdAt:iso(),mode:fromVoice?'voice':'phone-local'};return {...s,messages:[...s.messages,replyMessage].slice(-120),governor:'verifying',actions:s.actions+1,lastDecision:`reply:${text.slice(0,80)}`};});setLoading(false);scheduleAutonomy('risposta completata');if(fromVoice)window.setTimeout(()=>speak(reply),50);},[answer,input,loading,log,scheduleAutonomy,speak]);

  const startVoice=()=>{const C=window.SpeechRecognition||window.webkitSpeechRecognition;if(!C){log('voce','Riconoscimento vocale non disponibile nel browser.');return;}if(voiceListening){recognitionRef.current?.stop();return;}const r=new C();r.lang='it-IT';r.interimResults=false;r.continuous=false;r.onresult=(e:SpeechRecognitionResultEvent)=>{const text=e.results[0]?.[0]?.transcript?.trim();if(text){voiceReplyRef.current=true;send(text,true);}};r.onend=()=>{setVoiceListening(false);recognitionRef.current=null;};r.onerror=()=>{setVoiceListening(false);recognitionRef.current=null;log('voce','Riconoscimento vocale terminato.');};recognitionRef.current=r;setVoiceListening(true);try{r.start();}catch{setVoiceListening(false);recognitionRef.current=null;}};

  const [researches,setResearches]=useState<Research[]>([]);useEffect(()=>{if(hydrated)setResearches(store.researches)},[hydrated,store.researches]);
  const makeKeywords=(text:string)=>Array.from(new Set(text.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'').split(/[^a-z0-9à-ÿ]+/).filter(w=>w.length>4))).slice(0,12);
  const buildSummary=(query:string,sources:ResearchSource[])=>{const joined=sources.map(s=>s.extract).join(' ');const kws=makeKeywords(query+' '+joined);const sentences=joined.split(/(?<=[.!?])\s+/).filter(Boolean);const selected=sentences.filter(x=>kws.some(k=>x.toLowerCase().includes(k))).slice(0,8);return selected.length?selected.join(' '):joined.slice(0,1600);};
  const runResearch=async()=>{const q=researchQuery.trim();if(!q||researchLoading)return;setResearchLoading(true);try{const url=`https://it.wikipedia.org/w/api.php?action=query&generator=search&gsrsearch=${encodeURIComponent(q)}&gsrlimit=6&prop=extracts&exintro=1&explaintext=1&format=json&origin=*`;const r=await fetch(url);if(!r.ok)throw new Error();const data=await r.json();const pages=Object.values(data.query?.pages||{}) as any[];const sources:ResearchSource[]=pages.map((x:any)=>({id:id(),title:x.title||'Senza titolo',url:`https://it.wikipedia.org/wiki/${encodeURIComponent((x.title||'').replace(/ /g,'_'))}`,extract:String(x.extract||'').slice(0,1200),source:'Wikipedia',fetchedAt:iso()})).filter(x=>x.extract);const result:Research={id:id(),query:q,createdAt:iso(),sources,summary:buildSummary(q,sources),keywords:makeKeywords(q)};setStore(s=>({...s,researches:[result,...s.researches].slice(0,30),activity:[{id:id(),type:'ricerca',text:`Ricerca completata: ${q} · ${sources.length} fonti`,createdAt:iso()},...s.activity].slice(0,180)}));}catch{setStore(s=>({...s,activity:[{id:id(),type:'ricerca',text:`Ricerca non riuscita: ${q}`,createdAt:iso()},...s.activity].slice(0,180)}));}finally{setResearchLoading(false);}};
  const saveResearchMemory=(r:Research)=>rememberFact(`Ricerca: ${r.query}. Sintesi: ${r.summary.slice(0,700)}`,'Ricerca',.75,'ricerca locale');
  const confirmCandidate=(c:Candidate)=>{rememberFact(c.text,c.kind==='vincolo'?'Vincolo':c.kind==='preferenza'?'Preferenza':'Obiettivo',Math.min(1,c.confidence+.15),'conferma');setStore(s=>({...s,candidates:s.candidates.filter(x=>x.id!==c.id)}));};
  const rejectCandidate=(c:Candidate)=>{setStore(s=>({...s,candidates:s.candidates.filter(x=>x.id!==c.id),learning:[makeLearning(`Scartato: ${c.text}`,'correzione',1,'candidate',1),...s.learning].slice(0,300)}));log('apprendimento',`Candidato scartato: ${c.text}`);};
  const pending=useMemo(()=>store.tasks.filter(t=>!t.done).length,[store.tasks]);
  const clearAll=()=>{if(confirm('Eliminare memoria, attività, conversazioni e registro locali?'))setStore({...empty,messages:[]});};

  return <main>
    <header><div className="brand"><span className="orb">✦</span><div><h1>Pandora</h1><p>Personal Autonomous Assistant</p></div></div><div className="header-right"><span className="status ai">● {voiceListening?'Ascolto':voiceSpeaking?'Parlo':'Locale'}</span><span className="version">v2.1</span></div></header>
    <section className="hero"><div><small>STATO DEL SISTEMA</small><h2>{store.governor==='blocked'?'Governor bloccato':store.governor==='thinking'?'Elaborazione…':store.autonomy?'Nucleo operativo.':'Autonomia in pausa.'}</h2><p>Decisioni autonome guidate da eventi, con deduplica, stato esplicito e validazione. Memoria, voce e ricerca restano moduli separati.</p></div><div className="stats"><div><b>{store.memories.length}</b><span>memorie</span></div><div><b>{pending}</b><span>aperte</span></div><div><b>{store.cycles}</b><span>cicli</span></div></div></section>
    <nav className="tabs">{(['chat','research','memory','tasks','activity','settings'] as Tab[]).map(x=><button className={tab===x?'active':''} onClick={()=>setTab(x)} key={x}>{x==='chat'?'Pandora':x==='research'?'Ricerca':x==='memory'?'Memoria':x==='tasks'?'Attività':x==='activity'?'Registro':'Impostazioni'}</button>)}</nav>

    {tab==='chat'&&<section className="panel chat-panel"><div className="chat-toolbar"><span>Conversazione</span><small>{loading?'Pandora sta elaborando…':voiceListening?'ascolto vocale':voiceSpeaking?'risposta vocale':'pronta'}</small></div><div className="messages">{store.messages.map(m=><div key={m.id} className={`message ${m.role}`}><span className="avatar">{m.role==='pandora'?'✦':'Tu'}</span><div><p>{m.text}</p><small>{new Date(m.createdAt).toLocaleTimeString('it-IT',{hour:'2-digit',minute:'2-digit'})} · {m.mode||'locale'}</small></div></div>)}{loading&&<div className="message pandora"><span className="avatar">✦</span><div><p className="typing">•••</p></div></div>}</div><div className="composer"><textarea value={input} onChange={e=>setInput(e.target.value)} onKeyDown={e=>{if(e.key==='Enter'&&!e.shiftKey){e.preventDefault();send()}}} placeholder="Scrivi o parla con Pandora…" rows={1}/><button className={voiceListening?'voice-on':''} onClick={startVoice} title="Parla con Pandora">{voiceListening?'■':'🎙'}</button><button onClick={()=>send()} disabled={loading||!input.trim()} title="Invia">↑</button></div><div className="quick"><button onClick={()=>setInput('Ricorda che ')}>+ Memoria</button><button onClick={()=>setInput('Aggiungi attività ')}>+ Attività</button><button onClick={()=>setInput('Cosa ricordi di me?')}>Cosa ricordi?</button></div></section>}
    {tab==='research'&&<ResearchPanel query={researchQuery} setQuery={setResearchQuery} loading={researchLoading} run={runResearch} researches={researches} onSave={saveResearchMemory}/>} 
    {tab==='memory'&&<><section className="panel"><div className="panelhead"><div><small>LONG-TERM MEMORY</small><h2>Memoria</h2></div><span>{store.memories.length}</span></div>{!store.memories.length?<p className="empty">Nessuna memoria consolidata.</p>:store.memories.map(m=><article className="memory" key={m.id}><div><b>{m.text}</b><small>{m.category} · {Math.round(m.confidence*100)}% · {m.evidence} evidenze</small></div><button onClick={()=>{setStore(s=>({...s,memories:s.memories.filter(x=>x.id!==m.id)}));log('memoria',`Eliminata: ${m.text}`)}}>×</button></article>)}</section>{store.candidates.length>0&&<section className="panel"><div className="panelhead"><div><small>ACTIVE LEARNING</small><h2>Da verificare</h2></div><span>{store.candidates.length}</span></div>{store.candidates.map(c=><article className="memory" key={c.id}><div><b>{c.text}</b><small>{c.kind} · {Math.round(c.confidence*100)}% · candidato</small></div><button onClick={()=>confirmCandidate(c)}>✓</button><button onClick={()=>rejectCandidate(c)}>×</button></article>)}</section>}</>}
    {tab==='tasks'&&<section className="panel"><div className="panelhead"><div><small>PERSONAL WORK QUEUE</small><h2>Attività</h2></div><span>{pending} aperte</span></div><TaskInput onAdd={addTask}/><div className="task-list">{!store.tasks.length?<p className="empty">Nessuna attività.</p>:store.tasks.map(t=><label className="task" key={t.id}><input type="checkbox" checked={t.done} onChange={()=>{setStore(s=>({...s,tasks:s.tasks.map(x=>x.id===t.id?{...x,done:!x.done}:x),governor:'verifying'}));log('attività',`${t.done?'Riaperta':'Completata'}: ${t.title}`);scheduleAutonomy('modifica attività')}}/><span className={t.done?'done':''}>{t.title}</span><button type="button" onClick={e=>{e.preventDefault();setStore(s=>({...s,tasks:s.tasks.filter(x=>x.id!==t.id)}));log('attività',`Eliminata: ${t.title}`)}}>×</button></label>)}</div></section>}
    {tab==='activity'&&<section className="panel"><div className="panelhead"><div><small>LEARNING & AUDIT</small><h2>Registro</h2></div><span>{store.activity.length}</span></div><div className="last-action"><span>ULTIMA DECISIONE</span><b>{store.lastDecision}</b></div>{store.learning.slice(0,15).map(x=><div className="log" key={x.id}><i>impara</i><span>{x.text}</span><time>{Math.round(x.confidence*100)}% · {x.evidence} evidenze</time></div>)}{store.activity.slice(0,80).map(a=><div className="log" key={a.id}><i>{a.type}</i><span>{a.text}</span><time>{new Date(a.createdAt).toLocaleString('it-IT',{day:'2-digit',month:'2-digit',hour:'2-digit',minute:'2-digit'})}</time></div>)}{!store.activity.length&&!store.learning.length&&<p className="empty">Nessuna attività registrata.</p>}</section>}
    {tab==='settings'&&<section className="panel settings"><div className="panelhead"><div><small>PHONE CONTROL PLANE</small><h2>Impostazioni</h2></div></div><div className="setting"><div><b>Governor autonomo</b><span>Event-driven: niente polling aggressivo. Deduplica, decisione “non fare nulla” e stato persistente evitano i loop.</span></div><strong>{store.governor}</strong></div><div className="setting"><div><b>Autonomia locale</b><span>Opera nel browser quando la PWA è attiva. iOS può sospendere JavaScript in background.</span></div><button className={`switch ${store.autonomy?'on':''}`} onClick={()=>{const n=!store.autonomy;setStore(s=>({...s,autonomy:n,governor:n?'waiting':'idle'}));log('sistema',`Autonomia ${n?'attivata':'messa in pausa'}`)}}><span/></button></div><div className="setting"><div><b>Voce</b><span>Riconoscimento vocale + sintesi vocale del dispositivo/browser. Il nucleo di Pandora non viene sostituito da un’AI cloud.</span></div><strong>{voiceListening?'ascolto':voiceSpeaking?'parla':'pronta'}</strong></div><div className="setting"><div><b>Memoria adattiva</b><span>Fatti consolidati e candidati sono separati; confidenza ed evidenze crescono con le conferme.</span></div><strong>{store.memories.length}</strong></div><div className="architecture"><b>Architettura v2.0 — JARVIS foundation</b><p>Percezione → contesto → memoria → ragionamento → Governor → azione → verifica → apprendimento → attesa.</p><small>Il nucleo resta phone-first e non richiede OpenAI, ChatGPT, Anthropic o Google come cervello. Ricerca web e voce sono strumenti/interfacce.</small></div><div className="danger"><div><b>Azzeramento locale</b><span>Cancella tutti i dati salvati su questo telefono.</span></div><button onClick={clearAll}>Cancella dati</button></div></section>}
    <footer><span>Pandora v2.1</span><span>·</span><span>phone-first</span><span>·</span><span>autonomy-governor</span><span>·</span><span>voice</span></footer>
  </main>;
}

function TaskInput({onAdd}:{onAdd:(title:string)=>void}){const[v,setV]=useState('');const submit=()=>{if(v.trim()){onAdd(v);setV('')}};return <div className="addtask"><input value={v} onChange={e=>setV(e.target.value)} onKeyDown={e=>{if(e.key==='Enter')submit()}} placeholder="Nuova attività…"/><button onClick={submit}>Aggiungi</button></div>}

function ResearchPanel({query,setQuery,loading,run,researches,onSave}:{query:string;setQuery:(v:string)=>void;loading:boolean;run:()=>void;researches:Research[];onSave:(r:Research)=>void}){return <section className="panel research"><div className="panelhead"><div><small>LOCAL RESEARCH ENGINE</small><h2>Ricerca & Analisi</h2></div><span>{researches.length}</span></div><p className="empty" style={{padding:'4px 4px 14px'}}>Inserisci una domanda. Pandora interroga una fonte web pubblica, raccoglie risultati, estrae il testo disponibile e costruisce una prima sintesi verificabile.</p><div className="researchbar"><input value={query} onChange={e=>setQuery(e.target.value)} onKeyDown={e=>{if(e.key==='Enter')run()}} placeholder="Es. Come funziona la fotosintesi?"/><button onClick={run} disabled={loading||!query.trim()}>{loading?'…':'Cerca'}</button></div>{researches.length===0?<p className="empty">Nessuna ricerca ancora.</p>:researches.map(r=><article className="research-card" key={r.id}><div className="research-head"><div><small>{new Date(r.createdAt).toLocaleString('it-IT')}</small><h3>{r.query}</h3></div><button onClick={()=>onSave(r)}>+ Memoria</button></div><p>{r.summary||'Nessuna sintesi disponibile.'}</p><div className="keywords">{r.keywords.map(k=><span key={k}>{k}</span>)}</div><details><summary>{r.sources.length} fonti consultate</summary>{r.sources.map(s=><div className="source" key={s.id}><a href={s.url} target="_blank" rel="noreferrer">{s.title}</a><small>{s.source}</small><p>{s.extract}</p></div>)}</details></article>)}</section>}

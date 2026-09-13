# Pandora v1.3 — Autonomous Core + Local LLM

Pandora è **local-first**: il ciclo autonomo non dipende da OpenAI, Anthropic, Google o altri servizi AI esterni.

## Ciclo autonomo

`evento → memoria → valutazione → pianificazione → permessi → azione → osservazione → apprendimento`

In questa versione il ciclo è realmente operativo per le azioni locali sicure già supportate.

### Efficienza

Il Core usa una **coda persistente event-driven** invece di eseguire un polling continuo ogni pochi secondi:

- se non c'è lavoro, il Core resta inattivo;
- un nuovo evento risveglia immediatamente il ciclo;
- gli eventi futuri risvegliano il Core esattamente quando servono;
- una manutenzione leggera viene eseguita periodicamente per recuperare lavori rimasti dopo un riavvio;
- ogni ciclo ha un limite di passi per evitare loop infiniti;
- le azioni sono idempotenti dove possibile e hanno cooldown;
- gli errori vengono ritentati con backoff;
- la coda e le statistiche sono persistenti;
- tutte le azioni vengono registrate nell'audit log.

## Avvio

Requisito: Node.js >= 20.9.

```bash
./start-pandora-core.sh
```

Core: `http://localhost:8787`

## API

- `GET /health` — salute, coda e statistiche
- `GET /state` — stato persistente
- `GET /autonomy` — stato del ciclo autonomo
- `POST /chat` `{ "text": "..." }`
- `POST /memory` `{ "text": "...", "category": "..." }`
- `POST /tasks` `{ "title": "...", "priority": 80, "dueAt": "..." }`
- `POST /autonomy` `{ "enabled": true }`
- `POST /autonomy/wake` — risveglio manuale del ciclo

## Dati

La memoria vive in `data/pandora.json`. Il salvataggio viene effettuato con scrittura temporanea + rename per ridurre il rischio di corruzione durante uno spegnimento.

## Interfaccia iPhone

La PWA interroga il Core tramite le API Next.js e mostra lo stato del nucleo. Il toggle Autonomia controlla direttamente il Core.

## LLM locale

Il Core integra un adapter per **Ollama in locale**. Il modello non viene chiamato da un servizio cloud: per impostazione predefinita Pandora usa `http://127.0.0.1:11434`. Ollama espone l'API locale senza autenticazione e supporta output strutturati tramite JSON Schema. citeturn0search4turn0search0

### Installazione

1. Installa Ollama sul computer che esegue Pandora.
2. Avvia un modello locale, per esempio:

```bash
ollama pull gemma3
ollama serve
```

3. Avvia Pandora Core.

Il Core scopre i modelli installati con `/api/tags` e permette di selezionare il modello. citeturn0search1

### Selezione modello

```text
GET  /llm/models
POST /llm/select { "model": "gemma3" }
GET  /llm/status
```

La selezione resta nel processo corrente; per renderla predefinita usa `PANDORA_LLM_MODEL`.

### Contesto efficiente

Pandora non invia l'intero database al modello. Costruisce un contesto compatto con:
- memorie semanticamente rilevanti;
- ultime conversazioni;
- obiettivi attivi;
- attività aperte;
- stato dell'autonomia.

Il contesto ha limiti configurabili per caratteri, messaggi e memorie.

### Output strutturato

Il planner richiede direttamente a Ollama un JSON Schema e valida il risultato prima di consentire qualsiasi tool. Questo riduce parsing fragile e impedisce al modello di eseguire arbitrariamente codice. Ollama documenta il supporto a JSON Schema nel campo `format` e raccomanda temperature basse per output affidabili. citeturn0search0

### Fallback

Se Ollama è spento, il modello manca, scade il timeout o restituisce JSON non valido, Pandora torna automaticamente al motore deterministico. Il fallimento attiva inoltre un cooldown per evitare di martellare il modello indisponibile.

### Efficienza

Il percorso rapido resta deterministico per comandi ovvi (`ricorda`, `aggiungi attività`, richieste sullo stato). L'LLM viene utilizzato solo quando serve interpretazione semantica. Il modello viene mantenuto caldo per il periodo configurato tramite `keep_alive`. Ollama espone anche metriche di durata e token che possono essere usate per ottimizzare ulteriormente il Core. citeturn0search12turn0search3

Il Core rimane **local-first**: nessun fallback verso OpenAI, Anthropic, Google o altri servizi AI esterni.

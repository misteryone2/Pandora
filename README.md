# Pandora v1.2 — Autonomous Core

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

## Prossimo livello

Il ciclo è ora la base dell'agente. Il passo successivo è collegare un **LLM eseguito localmente** al planner, mantenendo invariati memoria, coda, permessi, audit e autonomia. Il modello sarà un componente sostituibile e non un servizio AI esterno obbligatorio.

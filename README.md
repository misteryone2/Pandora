# Pandora v1.1 — Autonomous Core

Pandora è stata trasformata in un'architettura **local-first**: l'interfaccia web non usa OpenAI o altri servizi AI esterni. Il cervello operativo è `core/server.mjs`, che salva memoria, attività, obiettivi, conversazioni e audit in `data/pandora.json`.

## Avvio del Core

Requisito: Node.js >= 20.9.

```bash
./start-pandora-core.sh
```

Il Core ascolta su `http://localhost:8787`.

## Avvio dell'interfaccia

Dalla root:

```bash
npm install
npm run dev
```

Per usare l'interfaccia sullo stesso computer, il default `PANDORA_CORE_URL=http://127.0.0.1:8787` è sufficiente.

Per un iPhone sulla stessa rete, il browser deve poter raggiungere il Core. Imposta `PANDORA_CORE_URL` sull'IP locale del computer che esegue il Core, ad esempio `http://192.168.1.10:8787`.

## API locale

- `GET /health`
- `GET /state`
- `POST /chat` `{ "text": "..." }`
- `POST /memory` `{ "text": "...", "category": "..." }`
- `POST /tasks` `{ "title": "..." }`
- `POST /autonomy` `{ "enabled": true }`

## Principio architetturale

Nessuna chiave OpenAI è necessaria. Nessun dato fondamentale deve vivere su un provider esterno. Il passo successivo è sostituire/affiancare `localCognition()` con un modello linguistico locale (GGUF/llama.cpp o runtime equivalente), mantenendo invariati memoria, strumenti, permessi e ciclo autonomo.

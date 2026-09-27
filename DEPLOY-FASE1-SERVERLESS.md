# Fase 1 — Pandora "in standby": serverless su Vercel + Redis

Questa modalità non richiede nessuna VM: il "cervello" (memoria, attività,
rete neurale) gira come funzioni di Vercel, si attiva ad ogni richiesta e non
consuma nulla quando l'app è chiusa. In cambio, **nessuna evoluzione in
background**: Pandora ragiona solo mentre la stai usando.

## 1. Collega un database Redis

Nel progetto su Vercel: **Storage → Marketplace → cerca un provider Redis**
(es. Upstash, Redis Cloud, o altri disponibili) e collegalo al progetto,
piano gratuito.

A seconda del provider scelto, Vercel inietta una di queste due forme:
- **`REDIS_URL`** (una singola stringa `redis://...` o `rediss://...`) — è
  quella che il codice usa di default (libreria `ioredis`).
- oppure la coppia **`UPSTASH_REDIS_REST_URL`/`UPSTASH_REDIS_REST_TOKEN`**
  (stile REST, solo per Upstash) — se ti ritrovi questa forma invece di
  `REDIS_URL`, dimmelo: serve una piccola variante del codice per usare
  l'API REST invece della connessione diretta.

**Importante**: dopo aver collegato l'integrazione, vai su **Settings →
Environment Variables**, apri la variabile appena creata e assicurati che le
spunte **Production** (e Preview, se vuoi) siano attive — di norma serve poi
un **Redeploy** (Deployments → `···` sull'ultimo → Redeploy) perché il
progetto la veda davvero.

## 2. NON impostare `PANDORA_CORE_URL`

Il codice sceglie automaticamente la modalità in base a questa variabile:
- **assente/non impostata** → Fase 1 (serverless + Redis, questa guida)
- **impostata** (verso la VM) → Fase 2/3 (sempre accesa)

## 3. Deploy e verifica

Push del codice → deploy automatico. Poi apri da telefono:
```
https://tuo-dominio.vercel.app/api/core/health
```
Deve rispondere `{"ok":true,"mode":"serverless-reactive",...}`. Se sì, apri
l'app e prova a scrivere qualcosa da ricordare — la trovi anche riaprendo
l'app più tardi, perché è salvata su Redis, non nella memoria della funzione.

## Limiti di questa fase, onestamente

- **Nessun ciclo autonomo**: niente task dedotti da soli, niente sinapsi
  rinforzate mentre non usi l'app. Solo reazione a ciò che scrivi.
- **Nessun LLM locale (Ollama)**: la Fase 1 gira su Vercel, che non può
  ospitare un modello locale — resta sul motore deterministico (lo stesso
  "cervello di riserva" già presente anche nella VM quando Ollama non è
  raggiungibile).

## Verifica fatta prima di consegnartelo

Ho testato l'intero percorso con un Redis vero (non solo simulato): build di
produzione, avvio delle route reali, due richieste HTTP separate come
sarebbero due chiamate della funzione serverless, verifica che la memoria e
la rete neurale sopravvivano tra l'una e l'altra leggendo/scrivendo da
Redis. Ha funzionato correttamente. L'unica cosa che non ho potuto testare
da qui è la tua istanza Redis specifica su Vercel — ma il codice parla lo
stesso identico protocollo, quindi il comportamento atteso è lo stesso.

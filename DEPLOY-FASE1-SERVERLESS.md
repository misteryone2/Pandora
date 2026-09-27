# Fase 1 — Pandora "in standby": serverless su Vercel + Upstash Redis

Questa modalità non richiede nessuna VM: il "cervello" (memoria, attività,
rete neurale) gira come funzioni di Vercel, si attiva ad ogni richiesta e non
consuma nulla quando l'app è chiusa. In cambio, **nessuna evoluzione in
background**: Pandora ragiona solo mentre la stai usando.

## 1. Collega un database Redis gratuito

1. Nel progetto su Vercel: **Storage → Marketplace → Redis** (cerca
   "Upstash Redis" — è l'integrazione consigliata da Vercel stesso da quando
   ha ritirato il vecchio "Vercel KV").
2. Scegli il piano gratuito e collegalo al progetto.
3. Vercel inietterà automaticamente le variabili d'ambiente necessarie
   (tipicamente `KV_REST_API_URL` / `KV_REST_API_TOKEN`, oppure
   `UPSTASH_REDIS_REST_URL` / `UPSTASH_REDIS_REST_TOKEN` a seconda di come
   viene proposta l'integrazione quando la installi — il codice qui riconosce
   entrambe le coppie automaticamente, non devi scegliere).

## 2. NON impostare `PANDORA_CORE_URL`

Il codice sceglie automaticamente la modalità in base a questa variabile:
- **assente/non impostata** → Fase 1 (serverless + Redis, questa guida)
- **impostata** (verso la VM) → Fase 2/3 (sempre accesa)

Per restare in Fase 1, semplicemente non impostarla (o rimuoverla se l'avevi
già messa in Vercel dalle fasi successive).

## 3. Deploy

Fai il push del repo (o redeploy se già collegato) — build e route sono già
verificate qui. Apri l'app dal telefono: alla prima richiesta la funzione
serverless si "accende" da sola, legge/scrive lo stato su Redis.

## Limiti di questa fase, onestamente

- **Nessun ciclo autonomo**: niente task dedotti da soli, niente sinapsi
  rinforzate mentre non usi l'app. Solo reazione a ciò che scrivi.
- **Nessun LLM locale (Ollama)**: la Fase 1 gira su Vercel, che non può
  ospitare un modello locale — resta sul motore deterministico (lo stesso
  "cervello di riserva" già presente anche nella VM quando Ollama non è
  raggiungibile).
- Non ho potuto testare la connessione Redis end-to-end in questo ambiente
  di sviluppo (non ho un'istanza Upstash reale a disposizione): la logica è
  la stessa già verificata sul core VM, ma la prima prova vera sarà al tuo
  primo deploy. Se `/api/core/health` risponde con `{"ok":true,...}` e la
  chat funziona, sei a posto.

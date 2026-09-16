# Pandora v1.9 — Phone First / Active Learning

Pandora è una PWA progettata per essere utilizzata direttamente da iPhone senza un PC, un server locale o un'API AI cloud.

## Cosa aggiunge v1.9

- **Risposte contestuali**: Pandora usa le memorie pertinenti e gli ultimi messaggi per evitare risposte isolate.
- **Apprendimento attivo locale**: riconosce segnali espliciti o forti come preferenze, vincoli, profilo e possibili obiettivi.
- **Confidenza**: ogni apprendimento ha una confidenza e può essere rinforzato quando la stessa informazione ricompare.
- **Memoria persistente**: dati, conversazioni, attività e apprendimenti sono salvati localmente sul dispositivo.
- **Registro dell'apprendimento**: è possibile vedere cosa Pandora ha imparato e con quale confidenza.
- **Autonomia phone-first**: controlla le attività mentre la PWA è attiva. iOS può sospendere JavaScript quando l'app è in background o chiusa.
- **Nessun cervello cloud**: nessuna chiamata a OpenAI, ChatGPT o altri servizi AI esterni.

## Apprendimento a due livelli

Pandora ora separa gli apprendimenti in due livelli:

1. **Memoria consolidata** — informazioni esplicite o molto forti vengono salvate e rinforzate quando ricompaiono.
2. **Candidati** — interessi, obiettivi o intenzioni meno certe vengono mantenuti come ipotesi. Pandora può proporteli nella conversazione e puoi confermarli o scartarli dalla sezione Memoria.

Le correzioni hanno priorità: se dici che un'informazione è sbagliata, Pandora può rimuoverla invece di continuare a usarla.

La risposta considera istruzioni esplicite, memoria pertinente, segnali di apprendimento, filo recente della conversazione e necessità di chiarimento. Questo evita che ogni messaggio venga trattato come completamente indipendente.

## Esempi

Puoi scrivere normalmente:

- `Mi piace molto cucinare con la friggitrice ad aria.`
- `Non voglio usare un computer per Pandora.`
- `Vorrei costruire una serra sul balcone.`
- `Devo ricordarmi di controllare le piante.`

Pandora può riconoscere il segnale, registrarlo localmente e usarlo nelle conversazioni successive.

Per una memoria esplicita puoi sempre usare `Ricorda che ...`.

## Limite importante

Questa versione implementa un **motore cognitivo locale deterministico**. Non è ancora un LLM generativo eseguito sul telefono. La struttura è stata preparata affinché un modello locale on-device possa essere aggiunto in seguito senza rendere il cloud una dipendenza.

## v1.9 — Ricerca & Analisi
Pandora aggiunge un motore di ricerca phone-first: una domanda può interrogare Wikipedia pubblica direttamente dal browser, raccogliere più risultati, conservarne titolo/URL/estratto, costruire una sintesi locale e salvare una ricerca nella memoria. Le fonti restano visibili per la verifica. Il motore non usa un'API AI cloud.


## v1.9 — stabilizzazione Active Learning
- Corretto definitivamente il type error TypeScript su `Learning.status`.
- Tutti i record `Learning` vengono creati tramite `makeLearning`, con `LearningStatus` tipizzato.
- I dati precedenti vengono normalizzati durante la migrazione da v1.8/v1.
- Ricerca locale/web di v1.8 mantenuta.

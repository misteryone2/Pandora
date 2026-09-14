# Pandora v1.5.1 — Phone First

Pandora v1.5.1 è stata riprogettata per poter essere usata **solo da iPhone**, senza Pandora Core su un computer e senza Ollama/API AI obbligatori.

## Cosa funziona direttamente dal telefono

- chat locale
- memoria persistente
- attività e completamento
- registro/audit locale
- autonomia locale mentre la PWA è attiva
- Service Worker per rendere l'app installabile come PWA
- nessun indirizzo IP da configurare
- nessun server personale obbligatorio
- nessuna API AI cloud obbligatoria

## Limite importante di iOS

Una PWA non può essere garantita come processo autonomo continuo quando viene sospesa o chiusa da iOS. Per questo l'autonomia di questa versione lavora quando Pandora è attiva/in primo piano. Non viene spacciata per un demone in background che iOS non consentirebbe.

## Sviluppo da solo iPhone

Il progetto può essere modificato tramite un editor GitHub/web dal telefono e pubblicato su un hosting statico/Next.js. Non è necessario avere un PC per usare Pandora.

## Modello generativo locale

Il modello generativo non è una dipendenza di v1.5.1. L'architettura lascia un punto di estensione per un modello eseguito localmente nel browser (WebGPU/WASM) in una versione successiva. Questo mantiene il requisito: **nessun altro sistema AI cloud deve essere il cervello di Pandora**.


### v1.5.1
Corretto un errore TypeScript nella gestione dei messaggi della chat: il messaggio di risposta di Pandora viene ora tipizzato esplicitamente come `Message`, evitando l'inferenza di `role` come `string`.

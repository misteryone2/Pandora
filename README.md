# Pandora v1.6 — Phone First / Active Learning

Pandora è una PWA progettata per essere utilizzata direttamente da iPhone senza un PC, un server locale o un'API AI cloud.

## Cosa aggiunge v1.6

- **Risposte contestuali**: Pandora usa le memorie pertinenti e gli ultimi messaggi per evitare risposte isolate.
- **Apprendimento attivo locale**: riconosce segnali espliciti o forti come preferenze, vincoli, profilo e possibili obiettivi.
- **Confidenza**: ogni apprendimento ha una confidenza e può essere rinforzato quando la stessa informazione ricompare.
- **Memoria persistente**: dati, conversazioni, attività e apprendimenti sono salvati localmente sul dispositivo.
- **Registro dell'apprendimento**: è possibile vedere cosa Pandora ha imparato e con quale confidenza.
- **Autonomia phone-first**: controlla le attività mentre la PWA è attiva. iOS può sospendere JavaScript quando l'app è in background o chiusa.
- **Nessun cervello cloud**: nessuna chiamata a OpenAI, ChatGPT o altri servizi AI esterni.

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

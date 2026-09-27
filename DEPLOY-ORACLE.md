# Deploy del core Pandora su Oracle Cloud (Always Free)

Guida passo-passo per far girare `core/server.mjs` 24/7 gratis, e collegarlo
alla UI già su Vercel.

## 1. Crea l'account e la VM

1. Vai su https://www.oracle.com/cloud/free/ e crea un account (serve una
   carta per la verifica identità, non viene addebitato nulla per le risorse
   "Always Free").
2. Nella Console OCI: **Compute → Instances → Create Instance**.
3. Immagine: **Canonical Ubuntu 22.04** (o 24.04 se disponibile).
4. Shape: scegli una shape **Ampere A1 (ARM)** — è quella inclusa nel piano
   Always Free (fino a 4 OCPU / 24GB, oggi in alcuni account ridotta a 2/12GB:
   qualsiasi valore sopra 1 OCPU / 2GB basta per il core, senza Ollama).
5. In "Add SSH keys" carica la tua chiave pubblica (o generane una nuova e
   scarica la privata: ti servirà per collegarti).
6. Crea l'istanza e annota l'**IP pubblico**.
7. In **Networking → Virtual Cloud Network → Security Lists**, aggiungi una
   Ingress Rule per la porta **8787** (TCP), sorgente `0.0.0.0/0` — è la
   porta su cui ascolta il core. (La porta 22 per SSH è già aperta di default.)

## 2. Collegati e installa Docker

```bash
ssh -i /percorso/alla/tua_chiave.pem ubuntu@IP_PUBBLICO_VM

curl -fsSL https://get.docker.com | sudo sh
sudo usermod -aG docker $USER
# esci e ri-entra in SSH perché il gruppo abbia effetto
exit
```

## 3. Carica il progetto sulla VM

Dal tuo PC, dalla cartella del repo (dopo aver fatto `git clone` del tuo
repo aggiornato):

```bash
scp -i /percorso/alla/tua_chiave.pem -r . ubuntu@IP_PUBBLICO_VM:~/pandora
```

(In alternativa, se preferisci: fai il push su GitHub e poi `git clone` il
repo direttamente sulla VM via SSH — più pulito per gli aggiornamenti
futuri.)

## 4. Configura la chiave API e avvia

```bash
ssh -i /percorso/alla/tua_chiave.pem ubuntu@IP_PUBBLICO_VM
cd ~/pandora
cp .env.example .env
openssl rand -hex 32   # copia il risultato...
nano .env               # ...e incollalo come valore di PANDORA_API_KEY, salva con Ctrl+O poi Ctrl+X

docker compose up -d --build
docker compose logs -f   # controlla che parta senza errori, poi Ctrl+C per uscire dai log
```

Verifica dall'esterno (dal tuo PC/telefono):
```
curl http://IP_PUBBLICO_VM:8787/health
```
Deve rispondere con `{"ok":true, ...}`.

## 5. Collega Vercel al core

Nel progetto su Vercel: **Settings → Environment Variables**, aggiungi:

| Nome | Valore |
|---|---|
| `PANDORA_CORE_URL` | `http://IP_PUBBLICO_VM:8787` |
| `PANDORA_API_KEY` | la stessa chiave generata al punto 4 |

Poi fai un redeploy (o aspetta il prossimo push) perché le variabili
vengano applicate. Da questo momento l'indicatore "Core online" nella UI
dovrebbe accendersi anche dal telefono, ovunque tu sia.

## Nota sulla sicurezza

Il traffico verso la VM oggi è in **HTTP semplice, non HTTPS** (va bene per
partire, ma i dati — incluso l'header con la chiave — viaggiano in chiaro).
Quando vuoi, il passo successivo naturale è mettere **Caddy** o **nginx** con
certificato Let's Encrypt automatico davanti al core, così anche
`PANDORA_CORE_URL` su Vercel diventa `https://...`. Se vuoi, te lo preparo
quando arrivi a questo punto.

## Aggiornare il core in futuro

```bash
ssh -i /percorso/alla/tua_chiave.pem ubuntu@IP_PUBBLICO_VM
cd ~/pandora
# porta qui i file aggiornati (scp o git pull), poi:
docker compose up -d --build
```

I dati (memorie, rete neurale, task) restano intatti tra un aggiornamento e
l'altro: sono su un volume Docker separato (`pandora_data`), non dentro
l'immagine.

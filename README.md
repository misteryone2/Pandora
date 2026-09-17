# Pandora v2.0

Phone-first foundation for a personal autonomous digital operating/reasoning assistant.

## What changed from v1.9

- Replaced the 30-second autonomy polling loop with an event-driven Autonomy Governor.
- Added explicit governor states and a valid `do nothing` decision.
- Added decision deduplication so the same autonomous observation is not repeatedly executed/logged.
- Added persistent decision/audit information.
- Preserved v1.9 data through migration from the previous localStorage key.
- Expanded memory records with evidence and last confirmation.
- Added voice input through the browser speech-recognition interface when supported.
- Added spoken replies through the device/browser speech-synthesis interface.
- Voice is an interface layer; it does not replace Pandora's local core with a cloud AI service.
- Kept research, memory, activity and task modules local and auditable.

## Architecture target

`perception -> context -> memory -> reasoning -> autonomy governor -> action -> verification -> learning -> waiting`

The Governor is deliberately conservative: it must not create an action merely because time passed. iOS can suspend a PWA, so true always-on background autonomy/wake-word listening is not claimed by this web build.

## Run

```bash
npm install
npm run dev
```

Production:

```bash
npm run build
npm start
```

## Privacy / dependency boundary

The application does not require OpenAI, ChatGPT, Anthropic or Google as its reasoning brain. Web research and browser speech capabilities are external platform/tool capabilities, not Pandora's core intelligence.

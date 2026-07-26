# Windows MVP runbook

## Required environment

Use a new UUID for `LIVE_SESSION_ID` when a new TikTok LIVE starts, and keep the same UUID across every process restart during that LIVE. Put these values in `.env` at the repository root:

```dotenv
DATABASE_URL=postgres://tarot:tarot@127.0.0.1:5432/tarot
REDIS_URL=redis://127.0.0.1:6379
PERSISTENCE=postgres
QUEUE_PROVIDER=redis
PLAYBACK_LEASE_TTL_MS=15000
WORKER_HEARTBEAT_MAX_AGE_MS=15000
FREE_LIKES_THRESHOLD=2000
QUESTION_LOOKBACK_SECONDS=300
AWAITING_QUESTION_SECONDS=120
PLAYBACK_WATCHDOG_GRACE_MS=30000
ADMIN_TOKEN=replace-with-a-long-random-secret
ACCOUNT_KEY=your-tiktok-account
DEFAULT_LOCALE=es-MX
EVENT_SOURCE=tikfinity
TIKFINITY_WS_URL=ws://127.0.0.1:21213
LIVE_SESSION_ID=replace-with-one-uuid-for-this-live
LLM_PROVIDER=gemini
GEMINI_API_KEY=replace-with-your-gemini-api-key
GEMINI_MODEL=gemini-3.5-flash-lite
TTS_PROVIDER=azure
TTS_API_KEY=replace-with-your-azure-speech-key
TTS_REGION=replace-with-your-azure-speech-region
TTS_VOICE=es-MX-DaliaNeural
CTA_TTS_ENABLED=true
CTA_TTS_INITIAL_DELAY_SECONDS=20
CTA_TTS_INTERVAL_SECONDS=60
CTA_TTS_TEXT=Mora está leyendo el chat en vivo. Escribe una pregunta breve para participar.
CTA_TTS_TEXTS=Mora está leyendo el chat en vivo. Escribe una pregunta breve para participar.|Cada lectura nace de una pregunta distinta. Cuéntame qué energía quieres mirar hoy.|Las cartas no prometen el futuro: abren una conversación. Deja tu pregunta en el chat.|¿Te llegó una señal esta semana? Escribe tu pregunta y Mora mezclará el mazo contigo.|El mazo está despierto. Una pregunta clara ayuda a encontrar un mensaje para reflexionar.|Si estás pasando por un cambio, comparte una pregunta breve. Las cartas pueden acompañar tu reflexión.|Mora está observando el chat. Tu siguiente pregunta puede ser la próxima lectura en vivo.|Regala Perfume, Hand Heart, Fairy Hide o Face-pulling y escribe tu pregunta para una lectura personal.|Respira, piensa en tu pregunta y escríbela en el chat. El mensaje de las cartas empieza contigo.|Este espacio es para entretenimiento y reflexión. Comparte una pregunta y participa en el LIVE.
INTERACTION_TTS_ENABLED=true
INTERACTION_TTS_MIN_INTERVAL_SECONDS=20
INTERACTION_TTS_GIFT_AWAITING_TEXT={name}, gracias por tu regalo. Escribe tu pregunta en el chat para activar tu lectura de {cards}.
AUDIO_DIR=C:\TarotAutoTiktok\data\audio
HMAC_SECRET=replace-with-a-separate-long-random-secret
LOG_LEVEL=info
SERVER_URL=http://127.0.0.1:3001
```

`LLM_PROVIDER=gemini` uses the stable `gemini-3.5-flash-lite` model through Gemini structured output. `GEMINI_API_KEY` is required. Every response is validated, Gemini is retried once, and the deterministic safe generator is used if both attempts fail. Azure Speech is primary for readings, CTA prompts, and interaction prompts. It retries once and then uses Windows System.Speech locally. CTA audio is synthesized once, cached, randomly selected without an immediate repeat, played only while idle, and stopped before any reading audio begins. Each CTA also rotates Mora through distinct expressions and visual effects.

Interaction TTS thanks a mapped gift only when the viewer still needs to post a question. It uses the viewer's short, sanitized display name and the actual card tier, is limited by `INTERACTION_TTS_MIN_INTERVAL_SECONDS`, and never overlaps a reading or CTA. The template supports `{name}` and `{cards}`. Raw chat text is never spoken. When a paid reading starts, its audio begins with a personalized thank-you. Set `INTERACTION_TTS_ENABLED=false` to turn this feature off.

Active paid gifts are: Perfume for one card, Hand Heart for three cards, Fairy Hide for five cards, and Face-pulling for seven cards. Run `pnpm db:migrate` after updating so legacy products become disabled historical rows and the new catalog is seeded.

## Install and migrate

Run in PowerShell from `C:\TarotAutoTiktok`:

```powershell
corepack enable
corepack prepare pnpm@9.15.5 --activate
pnpm install --frozen-lockfile
docker compose -f .\infra\docker-compose.yml up -d postgres redis
pnpm db:migrate
pnpm typecheck
pnpm test
pnpm build
```

## Start each process

Keep TikFinity Desktop running and its local API enabled. Use four PowerShell windows, each at `C:\TarotAutoTiktok`:

```powershell
pnpm --filter @tarot/server dev
```

```powershell
pnpm --filter @tarot/worker dev
```

```powershell
pnpm --filter @tarot/dashboard dev
```

```powershell
pnpm --filter @tarot/renderer dev
```

Open the dashboard at `http://127.0.0.1:5173`.

In OBS, set **Settings → Video → Base (Canvas) Resolution** and **Output (Scaled) Resolution** to `1080x1920`. Add a **Browser Source**, not Window Capture:

- URL: `http://127.0.0.1:5174/live`
- Width: `1080`
- Height: `1920`
- FPS: `30` or `60`
- Local file: off
- Use custom frame rate: on

Right-click the Browser Source and choose **Transform → Fit to Screen**. Do not stretch a Chrome or Edge window into the vertical canvas. If TikTok LIVE Studio is the final encoder, use its browser/link-source equivalent or a correctly configured 1080×1920 OBS feed; do not capture the browser window.

Make a local OBS recording and inspect text, card faces, motion, audio, and the full 9:16 frame before connecting the encoder to TikTok.

If preflight reports `audio_autoplay_blocked`, right-click the OBS Browser Source, choose **Interact**, click once inside the renderer, and rerun preflight. The renderer now fails this condition within five seconds instead of silently timing out.

With the renderer open and the worker running, execute:

```powershell
pnpm preflight:live
Invoke-RestMethod http://127.0.0.1:3001/ready | ConvertTo-Json -Depth 8
```

`/ready` must return `status=ready`, `liveReady=true`, fresh `worker.ready=true`, `renderer.ready=true`, `preflight.status=passed`, zero blockers, PostgreSQL/Redis ready, and TikFinity connected. HTTP 503 before the preflight is intentional.

If the worker logs `worker heartbeat failed ... HTTP 404`, it is connected to an older or different process on `SERVER_URL`; the current server exposes `POST /api/internal/worker-heartbeat`. Stop both stale server and worker terminals, confirm `SERVER_URL=http://127.0.0.1:3001`, start the server from this repository first, then start the worker from the same repository. A wrong `SERVER_URL` or a server started from an older extracted zip produces this exact 404.

For unattended operation, run these four commands under a Windows service supervisor with automatic restart. Vite and `tsx` are the current runtime launchers; native Windows services/installers are intentionally outside this MVP.

## Exact live acceptance sequence

1. Start a fresh TikTok LIVE, generate one UUID with `[guid]::NewGuid()`, put it in `LIVE_SESSION_ID`, and start all processes. Do not change it during restart testing.
2. Run `pnpm preflight:live` and confirm it creates, generates, voices, renders, acknowledges, and completes one local one-card reading through the active TikFinity normalizer. Confirm `/ready` has no blockers. After 20 seconds, hear one CTA variant. Start a test reading while the CTA is speaking and confirm CTA audio stops before preparation/reading audio begins. Leave the renderer idle and confirm CTA variants recur at a non-exact interval around 60 seconds.
3. Pause playback in the dashboard. From TikFinity, send a repeat gift progress packet (`repeatEnd=false`). Confirm the event count changes but entitlement and paid queue counts do not.
4. Send the corresponding final packet (`repeatEnd=true`) twice with the same external event ID. Confirm exactly one entitlement exists.
5. With no recent viewer question, confirm that entitlement is `AWAITING_QUESTION`. Post a safe question from that same TikTok account within 120 seconds. Confirm the same entitlement moves through moderation to one paid `READY` request.
6. Repeat with the question posted before the final gift. Confirm it is attached by the stable TikTok platform user ID. Send a gift whose exact normalized `giftName` conflicts with a legacy `giftId`; confirm the name-mapped product/card count wins.
7. Post an unsafe paid question such as a death prediction, then finalize a gift. Confirm no playback starts, the entitlement returns to `AWAITING_QUESTION`, and a later safe question reuses that entitlement.
8. From one viewer, send normalized LIKE quantities totaling 1,999 and confirm no free grant. Cross 2,000 and confirm exactly one free, priority-0, one-card request. Replay the same LIKE event ID and cross the threshold again; confirm the session still has one grant.
9. Queue a paid request while the free request is waiting. Confirm the paid request is first. Resume playback and confirm the current reading is never interrupted.
10. Observe renderer acknowledgments in the event/audit view: `STARTED`, recurring `HEARTBEAT`/`PROGRESS`, and finally `COMPLETED`. Confirm the state returns through `COMPLETE` to `WAITING`, current request clears, and the paid entitlement becomes `COMPLETED`.
11. Start another paid reading and close/disconnect the OBS browser source before completion. Confirm the request becomes `FAILED_RETRYABLE`, the entitlement becomes `NEEDS_REPLACEMENT`, current clears, and reconnect shows an idle scene rather than the stale reading.
12. Restart server and worker without changing `LIVE_SESSION_ID`. Send more likes from the viewer already granted a free reading; confirm no second free request. Then start a genuinely new LIVE with a new `LIVE_SESSION_ID` and confirm that viewer can earn one new free reading.
13. Temporarily make Azure unavailable in a non-live test run and synthesize a reading. Confirm two Azure attempts, a local `.wav` asset, and duration metadata derived from the generated file. Restore Azure credentials before going live.
14. Stop Redis and PostgreSQL one at a time and confirm `/ready` returns HTTP 503. Restore them, confirm unpublished outbox work is republished, and verify no duplicate request is created.
15. Inspect `Invoke-RestMethod http://127.0.0.1:3001/api/provider-events | ConvertTo-Json -Depth 12`. Every account-specific TikFinity gift envelope must say `normalized=true`. Any rejected payload is a release blocker and must be retained as a fixture before changing the adapter.

### Provider event troubleshooting

The dashboard now shows the `detail` for each audit action and a Provider diagnostics panel. `PROVIDER_PAYLOAD_REJECTED` means the WebSocket message arrived but did not contain a supported event type/identity; copy the corresponding `payload` from `/api/provider-events` before changing the adapter. `UNMAPPED_GIFT` means the gift was normalized successfully but its exact normalized `giftName` (then legacy `giftId`) is not one of the four enabled products. `ENTITLEMENT_MODERATION` is a normal transition after a mapped gift has a question; it is not itself an error.

## Readiness boundary

The durable PostgreSQL/Redis path, immediate dispatch with durable outbox fallback, restart recovery, playback lease, worker heartbeat, renderer check, raw TikFinity diagnostics, and end-to-end preflight are implemented. A green `/ready` is a local technical gate only; it is not a guarantee of TikTok policy acceptance. Do not call the deployment fully 24/7-ready until the account-specific TikFinity envelope has passed the sequence above, the processes are installed under a Windows service supervisor, backups/alerting are configured, and a PostgreSQL/Redis integration soak test has passed on the target PC.

Never begin a public LIVE to discover whether the technical path works. Use the local preflight and recording first. Avoid repetitive static scenes or repeated pressure for Gifts, and keep a human operator actively monitoring the LIVE and third-party tools.

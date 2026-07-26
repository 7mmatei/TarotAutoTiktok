# Setup

## Local mock run

1. Install Node.js LTS and pnpm.
2. Copy `.env.example` to `.env`.
3. Run `pnpm install`.
4. Run `pnpm dev`.
5. Open [http://127.0.0.1:5173](http://127.0.0.1:5173) for the operator dashboard and [http://127.0.0.1:5174/renderer/test](http://127.0.0.1:5174/renderer/test) for the renderer test route.

The simulator starts a session, posts a question, and sends a Hand Heart gift. The API is at port 3001. For credential-free development, explicitly set `LLM_PROVIDER=deterministic`, `TTS_PROVIDER=local`, and optionally `CTA_TTS_ENABLED=false`. Production uses `LLM_PROVIDER=gemini` with `GEMINI_MODEL=gemini-3.5-flash-lite`.

The active paid catalog is Perfume for one card, Hand Heart for three cards, Fairy Hide for five cards, and Face-pulling for seven cards.

## Audio playback

The local speech provider writes content-addressed `.wav` files under `AUDIO_DIR` and serves them from `/audio/:file`. On Windows it attempts the built-in System.Speech voice first; if that voice is unavailable it writes a valid silent timing track so the renderer still receives playable media. For production-quality Mexican Spanish, use Azure Speech with `TTS_PROVIDER=azure`, `TTS_API_KEY=<your Azure Speech key>`, `TTS_REGION=<your resource region>`, and `TTS_VOICE=es-MX-DaliaNeural` (or another supported `es-MX` neural voice). Azure configuration is required when selected; runtime Azure failure retries once and then falls back to local Windows speech.

## PostgreSQL and Redis

Run `docker compose -f infra/docker-compose.yml up -d`, set `PERSISTENCE=postgres` and `QUEUE_PROVIDER=redis` in `.env`, then run `pnpm db:migrate`. The default demo remains memory-backed; PostgreSQL/Redis mode enables the durable raw-event and outbox path plus BullMQ reconciliation.

## TikFinity

Set `EVENT_SOURCE=tikfinity` and point `TIKFINITY_WS_URL` to TikFinity Desktop's local API, normally `ws://localhost:21213`. Set `LIVE_SESSION_ID` to one UUID per real LIVE and reuse it across restarts during that LIVE; this is what makes the persisted one-free-reading grant restart-safe. TikFinity Desktop must be running on the same Windows streaming PC as this server; `localhost` refers to the machine running the Tarot server. This direct WebSocket path is preferred over building a webhook bridge. The server matches products by normalized exact `giftName` first, then falls back to the legacy `giftId` mapping. `coins` and TikFinity's `diamondCount` are normalized and retained on the event for diagnostics. TikFinity can emit a progress packet with `repeatEnd=false` followed by the single final packet with `repeatEnd=true`; only the final packet creates an entitlement. The server connects with reconnect/backoff, normalizes common TikFinity chat/gift/follow/like envelopes, and stores the external payload under `raw` for diagnostics. If you use a separate TikFinity action or bridge instead, pass dynamic fields such as `"giftName":"{giftName}","giftId":"{giftId}","coins":"{coins}"` (or `%giftName%`, `%giftId%`, `%coins%`). Validate the account-specific payload with a captured event before going live; malformed messages are ignored without stopping ingestion. Never put TikTok or provider credentials in dashboard or renderer code.

The complete Windows environment, startup commands, and acceptance sequence are in [WINDOWS_MVP_RUNBOOK.md](./WINDOWS_MVP_RUNBOOK.md).

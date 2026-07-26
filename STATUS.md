# Build status

## Implemented

- pnpm workspace with strict TypeScript configuration and validated environment configuration.
- Normalized LIVE contracts for comments, gifts, follows, likes, and connection events.
- Idempotent in-memory event recorder, recent-question matching, gift-to-product mapping, entitlement lifecycle, queue priorities, moderation prefilter, card selection, mock reading generation, offline TTS seam, and playback state machine.
- Fastify REST API and renderer/dashboard WebSockets.
- Dashboard with status, current reading, paid queue, awaiting-question queue, event log, controls, and es-MX/pt-BR message catalogs.
- Fixed 1080×1920 renderer with placeholder card/avatar assets, safe zones, Gift/test controls, and permanent disclaimer.
- PostgreSQL DDL starter, Docker Compose for PostgreSQL/Redis, simulator, worker reconciliation heartbeat, setup and operations docs.
- Drizzle PostgreSQL schema/migration package covering the full event, entitlement, reading, playback, audit, outbox, and system-event model.
- Configurable persistence and queue modes; PostgreSQL raw-event idempotency and outbox journaling; Redis/BullMQ reading and reconciliation queue adapters.
- Atomic PostgreSQL ingestion transaction for raw events, entitlements, reading requests, and reading-request outbox rows, with duplicate preflight for replayed source events.
- PostgreSQL recovery now restores recent sessions, users, comments, and active operator queue requests; Redis mode includes a renewable token-based playback lease.
- Reconnecting TikFinity WebSocket source with tolerant payload normalization for comments, gifts, follows, likes, connection events, and raw payload retention.
- Product matching prefers TikFinity's dynamic exact `giftName` and uses `giftId` only as a legacy fallback; `coins` is normalized for diagnostics. The active paid catalog is Perfume (1), Hand Heart (3), Fairy Hide (5), and Face-pulling (7).
- TikFinity Desktop's direct local API is supported as the recommended provider connection: `ws://localhost:21213`.
- TikFinity repeat batches now classify `repeatEnd=false` as progress and only `repeatEnd=true` as the completed gift; server playback has a watchdog fallback so a missing renderer completion cannot stall the queue.
- Local audio now produces content-addressed WAV assets, attempts Windows System.Speech, and serves the generated file through the audio endpoint instead of returning a text placeholder.
- Optional Azure Speech provider added for natural `es-MX` MP3 output, with local fallback when credentials are absent.
- Configurable, idempotent LIKE accumulation and a durable one-free-reading grant per viewer/LIVE session.
- Stable UUID product seeds, finalized `gift_events`, free grants/like totals, account-scoped recovery, outbox replay, and dependency-aware readiness.
- Strict reading validation, explicit deterministic/Gemini 3.5 Flash-Lite provider selection, one provider retry before safe fallback, and actual-file audio duration metadata.
- Cached paid-product CTA speech on an isolated idle renderer audio lane that yields immediately to reading audio.
- Renderer lifecycle acknowledgments plus replacement work on disconnect, error, lease loss, or missing completion; failed/manual-review work is excluded from automatic playback.

## Validation

- `pnpm install --ignore-scripts`
- `pnpm typecheck`
- `pnpm test` — 49 tests passing across intake, free grants, domain, renderer contract, audio, playback, recovery, and repository transaction coverage
- `pnpm build` — dashboard, renderer, and server builds passing
- Local smoke test — question + Hand Heart produced one paid entitlement and a `PLAYING` 3-card reading with local audio.

## Next production hardening

- Validate the account-specific TikFinity payload mapping against a live capture.
- Add Testcontainers/Windows soak coverage and Playwright/load acceptance coverage.
- Install the processes under a Windows service supervisor and configure backups/monitoring.

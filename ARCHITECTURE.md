# Tarot LIVE Interactive Reading Engine

## Runtime shape

This repository is a TypeScript pnpm workspace with a local-first modular monolith. `apps/server` owns the HTTP and WebSocket protocols, event normalization, state changes, queue ordering, and playback orchestration. `apps/worker` is the reconciliation process. `apps/dashboard` is the operator surface, `apps/renderer` is the OBS browser source, and `apps/simulator` is a deterministic local event source.

The current development adapter is memory-backed so a clean checkout can demonstrate the complete vertical slice without credentials or running infrastructure. `packages/db` now owns the Drizzle schema, migrations, and repository; `packages/queue` owns Redis/BullMQ queue construction. Set `PERSISTENCE=postgres` and `QUEUE_PROVIDER=redis` to enable durable event/outbox processing and restart recovery. The event and provider interfaces are kept in `packages/contracts` and `packages/adapters` so PostgreSQL/Drizzle, Redis/BullMQ, TikFinity, an LLM, and TTS can be substituted without changing the domain rules.

## Decisions

- External payloads are parsed at the adapter boundary with Zod. Malformed payloads are ignored and never crash the consumer.
- Raw event IDs are deduplicated before domain actions. A gift creates at most one entitlement.
- Only the domain transition functions can change lifecycle states; every transition appends an operator/audit action.
- Paid queue priority is numeric and FIFO within a priority. Playback is never interrupted by a newer request.
- Cards use HMAC-derived deterministic selection, crypto-backed material, and persist only the hash for auditability.
- Renderer commands carry a sequence and command ID. The renderer receives a snapshot after reconnect; only an acknowledged completion can complete the request.
- The scene has a permanent Spanish safety disclaimer and no administrative controls on the LIVE route.

## Production persistence seam

The server now rehydrates recent sessions, users, comments, pending entitlements, and operator queue requests from PostgreSQL. An interrupted `PLAYING` request is converted to retryable replacement work on boot, while selected cards, readings, audio metadata, playback attempts, and heartbeats are persisted. PostgreSQL event ingestion commits the raw event, domain state, and request outbox atomically. Redis mode adds a renewable token-based playback lease so only one process owns the live playback slot. The domain and API contracts are intentionally independent of those infrastructure choices.

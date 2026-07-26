# Operations

- Start a session from the dashboard before accepting events.
- Watch `GET /api/status` for the current reading, queue, awaiting questions, and metrics.
- Use pause playback to let the current reading finish while holding the queue. Use reset only when the renderer is unavailable; it creates a retry/replacement path instead of silently completing paid work.
- An `AWAITING_QUESTION` entitlement is retained after its deadline for operator resolution.
- Unsafe questions are returned to an awaiting/manual-review path and never consume paid fulfillment.
- The OBS source is `http://127.0.0.1:5174/live` as a native Browser Source at 1080×1920. Never use Window Capture for the renderer.
- `/ready` is LIVE-ready only after the worker heartbeat, renderer connection, TikFinity connection, CTA assets, storage, Redis, and `pnpm preflight:live` all pass.
- Inspect `GET /api/provider-events` whenever a real TikFinity event does not produce the expected state. Rejected payloads are retained in the in-memory diagnostic ring.
- A green technical preflight does not guarantee platform-policy acceptance. Keep an operator actively monitoring the LIVE and stop on warnings or degraded interaction.

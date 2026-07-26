# Failure recovery

The server never treats a renderer disconnect as delivery. A playback heartbeat is expected every ten seconds in production; a missed heartbeat moves the request to `FAILED_RETRYABLE` and the entitlement to `NEEDS_REPLACEMENT` for operator action. Duplicate external event IDs are ignored before gift processing. Restart recovery is provided by the PostgreSQL outbox and BullMQ reconciliation seam; the demo adapter keeps the same state transitions in memory so the behavior remains visible locally.

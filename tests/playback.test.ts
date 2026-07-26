import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { LocalSpeechProvider } from "@tarot/adapters";
import { ReadingEngine } from "../apps/server/src/engine.js";
import { MemoryStore } from "../apps/server/src/store.js";

describe("paid playback lifecycle", () => {
  it("moves the entitlement through fulfilling before completion and releases the slot", async () => {
    const audioDir = await mkdtemp(path.join(os.tmpdir(), "tarot-playback-"));
    try {
      const store = new MemoryStore("demo-account");
      const session = store.createSession("es-MX", "session-playback");
      const user = { platformUserId: "viewer-1", username: "viewer", displayName: "Viewer" };
      store.ingest({ type: "COMMENT", id: "comment-1", sessionId: session.id, occurredAt: new Date().toISOString(), user, text: "¿Qué observo esta semana?" });
      const gift = store.ingest({ type: "GIFT_COMPLETED", id: "gift-1", sessionId: session.id, occurredAt: new Date().toISOString(), user, giftId: "hand-heart", giftName: "Hand Heart", quantity: 1 });
      const request = gift.created;
      expect(request).toBeDefined();
      const engine = new ReadingEngine(store, "test-secret", audioDir, new LocalSpeechProvider(audioDir, false));

      await engine.process(request!.id);
      expect(store.entitlements.get(request!.entitlementId!)?.status).toBe("QUEUED");
      await engine.play(request!);
      expect(store.entitlements.get(request!.entitlementId!)?.status).toBe("FULFILLING");
      engine.complete(request!.id);

      expect(store.requests.get(request!.id)?.status).toBe("COMPLETED");
      expect(store.entitlements.get(request!.entitlementId!)?.status).toBe("COMPLETED");
      expect(store.currentRequest()).toBeUndefined();
    } finally {
      await rm(audioDir, { recursive: true, force: true });
    }
  });
});

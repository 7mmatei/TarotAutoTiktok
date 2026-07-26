import { describe, expect, it } from "vitest";
import { MemoryStore } from "../apps/server/src/store.js";

describe("durable restart recovery", () => {
  it("restores users and comments used for question matching", () => {
    const store = new MemoryStore("demo-account");
    store.restore({
      sessions: [{ id: "session-1", accountKey: "demo-account", locale: "es-MX", status: "LIVE", startedAt: 1 }],
      users: [{ id: "user-1", platform: "tiktok", platformUserId: "creator-1", username: "luna", displayName: "Luna" }],
      comments: [{ id: "comment-1", sessionId: "session-1", userId: "user-1", text: "¿Qué observo?", occurredAt: Date.now() }],
      entitlements: [],
      requests: []
    });
    expect(store.users.get("tiktok:creator-1")?.displayName).toBe("Luna");
    expect(store.eligibleQuestion("session-1", "user-1")?.text).toBe("¿Qué observo?");
  });

  it("turns interrupted playback into retryable replacement work", () => {
    const store = new MemoryStore("demo-account");
    store.restore({
      sessions: [{ id: "session-1", accountKey: "demo-account", locale: "es-MX", status: "LIVE", startedAt: 1 }],
      users: [],
      comments: [],
      entitlements: [{ id: "ent-1", giftEventId: "gift-1", sessionId: "session-1", userId: "user-1", productId: "product-galaxy", status: "FULFILLING", createdAt: 1 }],
      requests: [{ id: "request-1", entitlementId: "ent-1", sessionId: "session-1", userId: "user-1", displayName: "Luna", source: "paid", question: "¿Qué observo?", status: "PLAYING", priority: 200, queuedAt: 1, cards: [{ id: "the-star", orientation: "upright" }] }]
    });
    expect(store.requests.get("request-1")?.status).toBe("FAILED_RETRYABLE");
    expect(store.entitlements.get("ent-1")?.status).toBe("NEEDS_REPLACEMENT");
    expect(store.queue()).toEqual([]);
    expect(store.reviewQueue().map((request) => request.id)).toEqual(["request-1"]);
  });

  it("restores a completed free request together with its persisted grant",()=>{
    const store=new MemoryStore("demo-account",100);
    store.restore({
      sessions:[{id:"session-1",accountKey:"demo-account",locale:"es-MX",status:"LIVE",startedAt:1}],
      users:[{id:"user-1",platform:"tiktok",platformUserId:"viewer-1",username:"luna",displayName:"Luna"}],
      comments:[],
      entitlements:[],
      freeGrants:[{id:"grant-1",sessionId:"session-1",userId:"user-1",platformUserId:"viewer-1",requestId:"request-1",likeCount:100,createdAt:2}],
      requests:[{id:"request-1",sessionId:"session-1",userId:"user-1",displayName:"Luna",source:"free",question:"¿Qué energía observo?",status:"COMPLETED",priority:0,queuedAt:2,completedAt:3}]
    });

    expect(store.freeGrants.size).toBe(1);
    expect(store.requests.get("request-1")?.status).toBe("COMPLETED");
  });
});

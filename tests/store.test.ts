import { describe, expect, it } from "vitest";
import { MemoryStore } from "../apps/server/src/store.js";

describe("gift product mapping", () => {
  it("seeds the requested four paid tiers",()=>{
    const products=[...new MemoryStore("demo-account").products.values()].map(({giftName,cards,priority})=>({giftName,cards,priority}));
    expect(products).toEqual([
      {giftName:"Perfume",cards:1,priority:100},
      {giftName:"Hand Heart",cards:3,priority:200},
      {giftName:"Fairy Hide",cards:5,priority:300},
      {giftName:"Face-pulling",cards:7,priority:400}
    ]);
  });

  it("does not create an entitlement for a repeat progress event", () => {
    const store = new MemoryStore("demo-account");
    const session = store.createSession("es-MX", "session-progress");
    const event = {
      type: "GIFT_PROGRESS" as const,
      id: "gift-progress-1",
      sessionId: session.id,
      occurredAt: new Date().toISOString(),
      user: { platformUserId: "user-progress", username: "rosa", displayName: "Rosa" },
      giftId: "perfume",
      giftName: "Perfume",
      quantity: 1,
      coins: 1
    };

    const result = store.ingest(event);

    expect(result.entitlement).toBeUndefined();
    expect(store.entitlements.size).toBe(0);
  });

  it("matches the exact gift name before falling back to a legacy gift id", () => {
    const store = new MemoryStore("demo-account");
    const session = store.createSession("es-MX", "session-1");
    const event = {
      type: "GIFT_COMPLETED" as const,
      id: "gift-rose-transaction-1",
      sessionId: session.id,
      occurredAt: new Date().toISOString(),
      user: { platformUserId: "user-rose", username: "rosa", displayName: "Rosa" },
      giftId: "transaction-perfume-1",
      giftName: " Perfume ",
      coins: 1,
      quantity: 1
    };

    const result = store.ingest(event);

    expect(result.entitlement).toBeDefined();
    expect([...store.products.values()].find((product) => product.id === result.entitlement!.productId)?.productCode).toBe("quick");
  });
});

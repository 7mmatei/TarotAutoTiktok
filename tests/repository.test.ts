import { describe, expect, it } from "vitest";
import { DurableRepository, entitlements, outbox, rawEvents, readingRequests } from "@tarot/db";

function fakeDatabase(rawEventInserted: boolean) {
  const insertedTables: unknown[] = [];
  const statement = (table: unknown) => {
    insertedTables.push(table);
    return {
      values: () => ({
        onConflictDoNothing: () => ({ returning: async () => rawEventInserted ? [{ id: "raw-1" }] : [] }),
        onConflictDoUpdate: async () => undefined,
        then: (resolve: (value: undefined) => unknown) => resolve(undefined)
      })
    };
  };
  const tx = { insert: statement };
  return {
    insertedTables,
    transaction: async (callback: (transaction: typeof tx) => Promise<boolean>) => callback(tx)
  } as any;
}

const input = {
  event: { type: "CONNECTED", id: "event-1", sessionId: "session-1", occurredAt: "2026-07-25T10:00:00.000Z" } as const,
  source: "test",
  entitlement: { id: "entitlement-1", giftEventId: "gift-1", userId: "user-1", productId: "product-1", status: "MODERATION" as const, createdAt: Date.now() },
  request: { id: "request-1", entitlementId: "entitlement-1", sessionId: "session-1", userId: "user-1", displayName: "Luna", source: "paid" as const, question: "¿Qué observo?", status: "RECEIVED" as const, priority: 200, queuedAt: Date.now() },
  outbox: { topic: "reading.requested", aggregateId: "request-1", payload: { requestId: "request-1" } }
};

describe("durable ingestion", () => {
  it("writes raw event, domain state, and outbox inside one transaction", async () => {
    const database = fakeDatabase(true);
    const repository = new DurableRepository(database);

    await expect(repository.ingestAtomically(input)).resolves.toBe(true);
    expect(database.insertedTables).toEqual([rawEvents, entitlements, readingRequests, outbox]);
  });

  it("does not write domain state when the raw event is already present", async () => {
    const database = fakeDatabase(false);
    const repository = new DurableRepository(database);

    await expect(repository.ingestAtomically(input)).resolves.toBe(false);
    expect(database.insertedTables).toEqual([rawEvents]);
  });
});

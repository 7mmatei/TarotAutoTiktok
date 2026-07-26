import { describe, expect, it } from "vitest";
import { normalizeTikfinityPayload } from "@tarot/adapters";
import { TikfinityEventSource, type TikfinitySocket } from "@tarot/adapters";

describe("TikFinity normalization", () => {
  it("normalizes a nested chat payload and preserves the raw message", () => {
    const raw = { event: "chat", data: { eventId: "chat-1", roomId: "room-1", user: { uid: "u-1", uniqueId: "luna", nickname: "Luna" }, message: "¿Qué observo?" } };
    const event = normalizeTikfinityPayload(raw, "session-1", new Date("2026-07-25T10:00:00.000Z"));

    expect(event).toMatchObject({ type: "COMMENT", id: "chat-1", sessionId: "room-1", user: { platformUserId: "u-1", username: "luna", displayName: "Luna" }, text: "¿Qué observo?", raw });
  });

  it("maps gift repeats to progress and finalized gifts to completion", () => {
    const raw = { type: "gift", id: "gift-1", session_id: "session-1", userInfo: { userId: "u-1", username: "luna", displayName: "Luna" }, gift: { id: "galaxy", name: "Galaxy" }, repeatCount: 2 };
    const progress = normalizeTikfinityPayload({ ...raw, type: "gift_progress" }, "session-1");
    const completed = normalizeTikfinityPayload({ ...raw, type: "gift_completed", repeatCount: 1 }, "session-1");

    expect(progress).toMatchObject({ type: "GIFT_PROGRESS", giftId: "galaxy", quantity: 2 });
    expect(completed).toMatchObject({ type: "GIFT_COMPLETED", giftId: "galaxy", quantity: 1 });
  });

  it("completes non-streak TikFinity gifts even when repeatEnd is false", () => {
    const event = normalizeTikfinityPayload({ event: "gift", data: { giftId: 7934, repeatCount: 1, giftType:4, userId: "6892455204449944581", uniqueId: "alinamantarau82", nickname: "Alina", giftName: "Heart Me", coins: "5", repeatEnd: false } }, "session-1");

    expect(event).toMatchObject({ type: "GIFT_COMPLETED", giftId: "7934", giftName: "Heart Me", coins: 5, user: { platformUserId: "6892455204449944581", username: "alinamantarau82", displayName: "Alina" } });
  });

  it("classifies the repeatEnd message as the single completed gift", () => {
    const event = normalizeTikfinityPayload({ event: "gift", data: { giftId: 5655, repeatCount: 1, userId: "u-rose", uniqueId: "rosa", nickname: "Rosa", giftName: "Rose", diamondCount: 1, repeatEnd: true } }, "session-1");

    expect(event).toMatchObject({ type: "GIFT_COMPLETED", giftId: "5655", giftName: "Rose", coins: 1, user: { platformUserId: "u-rose" } });
  });

  it("accepts dynamically mapped TikFinity placeholders when the gift id is transactional", () => {
    const event = normalizeTikfinityPayload({ type: "gift_completed", giftId: "transaction-rose-1", giftName: "Rose", coins: 1, quantity: 1, user: { userId: "u-rose", uniqueId: "rosa", nickname: "Rosa" } }, "session-1");

    expect(event).toMatchObject({ type: "GIFT_COMPLETED", giftId: "transaction-rose-1", giftName: "Rose", coins: 1, quantity: 1 });
  });

  it("accepts the direct TikFinity Desktop API envelope", () => {
    const event = normalizeTikfinityPayload({ event: "gift", data: { giftId: 5655, giftName: "Rose", coins: 1, repeatCount: 1, userId: "u-desktop", uniqueId: "desktopviewer", nickname: "Desktop Viewer" } }, "session-1");

    expect(event).toMatchObject({ type: "GIFT_COMPLETED", giftId: "5655", giftName: "Rose", coins: 1, user: { platformUserId: "u-desktop", displayName: "Desktop Viewer" } });
  });

  it("normalizes TikFinity room joins and viewer counts as live state",()=>{
    const joined=normalizeTikfinityPayload({event:"member",data:{userId:"u-join",uniqueId:"luna",nickname:"Luna",displayType:"live_room_enter_toast"}},"session-1");
    const room=normalizeTikfinityPayload({event:"roomUser",data:{viewerCount:7,tikfinityUsername:"mora.lecturas"}},"session-1");

    expect(joined).toMatchObject({type:"JOIN",user:{platformUserId:"u-join",displayName:"Luna"}});
    expect(room).toMatchObject({type:"ROOM_STATS",viewerCount:7});
  });

  it("rejects unknown or incomplete provider payloads", () => {
    expect(normalizeTikfinityPayload({ type: "unknown", id: "x" }, "session-1")).toBeUndefined();
    expect(normalizeTikfinityPayload({ type: "comment", text: "missing user" }, "session-1")).toBeUndefined();
  });

  it("retains diagnostics for accepted and rejected provider payloads", () => {
    const diagnostics:any[]=[];
    const source=new TikfinityEventSource("ws://tikfinity.test","session-1",{onPayloadDiagnostic:(diagnostic)=>diagnostics.push(diagnostic)});
    source.recordRawEvent({event:"gift",data:{eventId:"gift-diagnostic",giftId:5655,giftName:"Rose",userId:"u-1",nickname:"Luna",repeatEnd:true}});
    source.recordRawEvent({event:"provider_schema_changed",data:{mystery:true}});

    expect(diagnostics).toHaveLength(2);
    expect(diagnostics[0]).toMatchObject({normalized:true,eventTypes:["GIFT_COMPLETED"]});
    expect(diagnostics[1]).toMatchObject({normalized:false,eventTypes:[]});
    expect(diagnostics[1].payload).toEqual({event:"provider_schema_changed",data:{mystery:true}});
  });

  it("recognizes TikFinity control packets without counting them as rejected viewer events",()=>{
    const diagnostics:any[]=[];
    const source=new TikfinityEventSource("ws://tikfinity.test","session-1",{onPayloadDiagnostic:(diagnostic)=>diagnostics.push(diagnostic)});
    source.recordRawEvent({event:"config",data:{version:"1"}});
    source.recordRawEvent({event:"liveStatusChange",data:{isLive:false}});

    expect(diagnostics).toHaveLength(2);
    expect(diagnostics.every((item)=>item.normalized&&item.ignoredControl&&item.eventTypes.length===0)).toBe(true);
  });

  it("reconnects after the provider socket closes", async () => {
    class FakeSocket implements TikfinitySocket {
      private onceListeners = new Map<string, () => void>();
      once(event: "open" | "error" | "close", listener: () => void): FakeSocket { this.onceListeners.set(event, listener); return this; }
      on(_event: "message", _listener: (data: any) => void): FakeSocket { return this; }
      close(): void { this.emit("close"); }
      emit(event: "open" | "error" | "close"): void { const listener = this.onceListeners.get(event); this.onceListeners.delete(event); listener?.(); }
    }
    const sockets: FakeSocket[] = [];
    const source = new TikfinityEventSource("ws://tikfinity.test", "session-1", { reconnectMinMs: 1, reconnectMaxMs: 1, webSocketFactory: () => { const socket = new FakeSocket(); sockets.push(socket); return socket; } });
    const iterator = source.events()[Symbol.asyncIterator]();
    await source.connect();

    sockets[0]?.emit("open");
    await expect(iterator.next()).resolves.toMatchObject({ value: { type: "CONNECTED", sessionId: "session-1" }, done: false });
    sockets[0]?.emit("close");
    await expect(iterator.next()).resolves.toMatchObject({ value: { type: "DISCONNECTED", sessionId: "session-1" }, done: false });
    await new Promise((resolve) => setTimeout(resolve, 10));
    sockets[1]?.emit("open");
    await expect(iterator.next()).resolves.toMatchObject({ value: { type: "CONNECTED", sessionId: "session-1" }, done: false });

    await source.disconnect();
  });
});

import crypto from "node:crypto";
import { and, asc, desc, eq, inArray, isNull, lte, notInArray, sql } from "drizzle-orm";
import type { LiveEvent } from "@tarot/contracts";
import type { EntitlementState, RequestState } from "@tarot/domain";
import type { Database } from "./client.js";
import { audioAssets, comments, entitlements, freeReadingGrants, giftEvents, giftProducts, likeTotals, liveSessions, operatorActions, outbox, playbackAttempts, rawEvents, readingRequests, readings, selectedCards, systemEvents, users } from "./schema.js";

export type DurableEntitlement = { id: string; giftEventId: string; sessionId: string; userId: string; productId: string; status: EntitlementState; questionDeadline?: number; failureReason?: string; createdAt: number; completedAt?: number };
export type DurableRequest = { id: string; entitlementId?: string; sessionId: string; userId: string; displayName: string; source: "paid" | "free"; question?: string; status: RequestState; priority: number; queuedAt: number; startedAt?: number; completedAt?: number; cards?: Array<{ id: string; orientation: "upright" | "reversed" }>; seedHash?: string; reading?: { id?: string; spokenText: string; cards: Array<{ cardId: string; interpretation: string }>; [key: string]: unknown }; audio?: { contentHash: string; localPath: string; durationMs: number } };
export type DurableUser = { id: string; platform: string; platformUserId: string; username: string; displayName: string };
export type DurableComment = { id: string; sessionId: string; userId: string; text: string; occurredAt: number };
export type DurableProduct = { id:string;accountKey:string;giftId:string;giftName:string;productCode:string;cards:number;priority:number;questionRequired:boolean;maxWords:number;maxAudioSeconds:number;enabled:boolean };
export type DurableFreeGrant = { id:string;sessionId:string;userId:string;platformUserId:string;requestId:string;likeCount:number;createdAt:number };
export type DurableLikeTotal = { sessionId:string;userId:string;platformUserId:string;quantity:number };
export type DurableGiftEvent = { id:string;sessionId:string;userId:string;giftId:string;giftName:string;quantity:number;productId?:string;finalizedAt:number };
export type DurableRecovery = { sessions: Array<{ id: string; accountKey: string; locale: string; status: "LIVE" | "ENDED" | "PAUSED"; startedAt: number; endedAt?: number }>; users: DurableUser[]; comments: DurableComment[]; products?:DurableProduct[]; entitlements: DurableEntitlement[]; requests: DurableRequest[];likeTotals?:DurableLikeTotal[];freeGrants?:DurableFreeGrant[] };
export type DurableIngestion = { event: LiveEvent; source: string; accountKey?:string; locale?:string; user?: DurableUser; comment?: Omit<DurableComment, "id">; giftEvent?:DurableGiftEvent; entitlement?: DurableEntitlement; request?: DurableRequest; likeTotal?:DurableLikeTotal; freeGrant?:DurableFreeGrant; outbox?: { id?: ReturnType<typeof crypto.randomUUID>; topic: string; aggregateId: string; payload: unknown } };

export class DurableRepository {
  constructor(private readonly db: Database) {}
  async ready():Promise<boolean> { try { await this.db.execute(sql`select 1`); return true; } catch { return false; } }
  async ensureProducts(products:DurableProduct[]):Promise<void> { if(!products.length)return;await this.db.update(giftProducts).set({enabled:false}).where(and(eq(giftProducts.accountKey,products[0]!.accountKey),notInArray(giftProducts.id,products.map((product)=>product.id))));for(const product of products) await this.db.insert(giftProducts).values(product).onConflictDoUpdate({target:giftProducts.id,set:{accountKey:product.accountKey,giftId:product.giftId,giftName:product.giftName,productCode:product.productCode,cards:product.cards,priority:product.priority,questionRequired:product.questionRequired,maxWords:product.maxWords,maxAudioSeconds:product.maxAudioSeconds,enabled:product.enabled}}); }
  async createSession(input: { id: string; accountKey: string; locale: string }): Promise<void> { await this.db.insert(liveSessions).values({ id: input.id, accountKey: input.accountKey, locale: input.locale, status: "LIVE", startedAt: new Date() }).onConflictDoNothing(); }
  async eventExists(eventId: string, source: string): Promise<boolean> { const rows = await this.db.select({ id: rawEvents.id }).from(rawEvents).where(and(eq(rawEvents.externalId, eventId), eq(rawEvents.source, source))).limit(1); return rows.length > 0; }
  async recordEvent(event: LiveEvent, source: string): Promise<boolean> {
    const inserted = await this.db.insert(rawEvents).values({ id: crypto.randomUUID(), sessionId: event.sessionId, source, externalId: event.id, type: event.type, payloadJson: event, occurredAt: new Date(event.occurredAt) }).onConflictDoNothing({ target: [rawEvents.source, rawEvents.externalId] }).returning({ id: rawEvents.id });
    return inserted.length > 0;
  }
  async ingestAtomically(input: DurableIngestion): Promise<boolean> {
    return this.db.transaction(async (tx) => {
      if(input.accountKey) await tx.insert(liveSessions).values({id:input.event.sessionId,accountKey:input.accountKey,locale:input.locale??"es-MX",status:"LIVE",startedAt:new Date(input.event.occurredAt)}).onConflictDoNothing();
      const inserted = await tx.insert(rawEvents).values({ id: crypto.randomUUID(), sessionId: input.event.sessionId, source: input.source, externalId: input.event.id, type: input.event.type, payloadJson: input.event, occurredAt: new Date(input.event.occurredAt) }).onConflictDoNothing({ target: [rawEvents.source, rawEvents.externalId] }).returning({ id: rawEvents.id });
      if (inserted.length === 0) return false;
      if (input.user) await this.upsertUserWith(tx, input.user);
      if (input.comment) await this.recordCommentWith(tx, { id: crypto.randomUUID(), ...input.comment }, inserted[0]!.id);
      if (input.giftEvent) await tx.insert(giftEvents).values({id:input.giftEvent.id,rawEventId:inserted[0]!.id,sessionId:input.giftEvent.sessionId,userId:input.giftEvent.userId,giftId:input.giftEvent.giftId,giftName:input.giftEvent.giftName,quantity:input.giftEvent.quantity,...(input.giftEvent.productId?{productId:input.giftEvent.productId}:{}),finalizedAt:new Date(input.giftEvent.finalizedAt)}).onConflictDoNothing();
      if(input.likeTotal) await tx.insert(likeTotals).values({id:crypto.randomUUID(),...input.likeTotal}).onConflictDoUpdate({target:[likeTotals.sessionId,likeTotals.platformUserId],set:{quantity:input.likeTotal.quantity,userId:input.likeTotal.userId,updatedAt:new Date()}});
      if (input.entitlement) await this.saveEntitlementWith(tx, input.entitlement);
      if (input.request) await this.saveRequestWith(tx, input.request);
      if(input.freeGrant) await tx.insert(freeReadingGrants).values({...input.freeGrant,createdAt:new Date(input.freeGrant.createdAt)}).onConflictDoNothing({target:[freeReadingGrants.sessionId,freeReadingGrants.platformUserId]});
      if (input.outbox) await this.appendOutboxWith(tx, input.outbox.topic, input.outbox.aggregateId, input.outbox.payload, input.outbox.id);
      return true;
    });
  }
  private async upsertUserWith(db: any, user: DurableUser): Promise<void> { const now = new Date(); await db.insert(users).values({ ...user, firstSeenAt: now, lastSeenAt: now }).onConflictDoUpdate({ target: [users.platform, users.platformUserId], set: { username: user.username, displayName: user.displayName, lastSeenAt: now } }); }
  async upsertUser(user: DurableUser): Promise<void> { await this.upsertUserWith(this.db, user); }
  private async recordCommentWith(db: any, input: DurableComment, rawEventId: string): Promise<void> { await db.insert(comments).values({ ...input, rawEventId, occurredAt: new Date(input.occurredAt) }).onConflictDoNothing(); }
  async recordComment(input: { id: string; rawEventId: string; sessionId: string; userId: string; text: string; occurredAt: Date }): Promise<void> { await this.db.insert(comments).values(input).onConflictDoNothing(); }
  private async saveEntitlementWith(db: any, item: DurableEntitlement): Promise<void> { await db.insert(entitlements).values({ id: item.id, giftEventId: item.giftEventId, userId: item.userId, productId: item.productId, status: item.status as never, ...(item.questionDeadline !== undefined ? { questionDeadline: new Date(item.questionDeadline) } : {}), ...(item.failureReason ? { failureReason: item.failureReason } : {}), createdAt: new Date(item.createdAt), ...(item.completedAt !== undefined ? { completedAt: new Date(item.completedAt) } : {}) }).onConflictDoUpdate({ target: entitlements.id, set: { status: item.status as never, ...(item.questionDeadline !== undefined ? { questionDeadline: new Date(item.questionDeadline) } : {}), ...(item.failureReason ? { failureReason: item.failureReason } : {}), ...(item.completedAt !== undefined ? { completedAt: new Date(item.completedAt) } : {}) } }); }
  async saveEntitlement(item: DurableEntitlement): Promise<void> { await this.saveEntitlementWith(this.db, item); }
  private async saveRequestWith(db: any, item: DurableRequest): Promise<void> { await db.insert(readingRequests).values({ id: item.id, ...(item.entitlementId ? { entitlementId: item.entitlementId } : {}), sessionId: item.sessionId, userId: item.userId, displayName: item.displayName, source: item.source, ...(item.question ? { question: item.question } : {}), status: item.status as never, priority: item.priority, queuedAt: new Date(item.queuedAt), ...(item.startedAt !== undefined ? { startedAt: new Date(item.startedAt) } : {}), ...(item.completedAt !== undefined ? { completedAt: new Date(item.completedAt) } : {}) }).onConflictDoUpdate({ target: readingRequests.id, set: { ...(item.question ? { question: item.question } : {}), status: item.status as never, priority: item.priority, displayName: item.displayName, ...(item.startedAt !== undefined ? { startedAt: new Date(item.startedAt) } : {}), ...(item.completedAt !== undefined ? { completedAt: new Date(item.completedAt) } : {}) } }); }
  async saveRequest(item: DurableRequest): Promise<void> { await this.saveRequestWith(this.db, item); }
  async saveFulfillment(item: DurableRequest, locale: string,metadata:{generatorName:string;audioProvider:string;voice:string}): Promise<void> { if (item.cards?.length && item.seedHash) { for (const [position, card] of item.cards.entries()) await this.db.insert(selectedCards).values({ requestId: item.id, position, cardId: card.id, orientation: card.orientation, seedHash: item.seedHash }).onConflictDoUpdate({ target: [selectedCards.requestId, selectedCards.position], set: { cardId: card.id, orientation: card.orientation, seedHash: item.seedHash } }); } if (item.reading) { const readingId = item.reading.id ?? crypto.randomUUID(); item.reading.id = readingId; await this.db.insert(readings).values({ id: readingId, requestId: item.id, locale, generatedJson: item.reading, spokenText: item.reading.spokenText, safetyStatus: "SAFE", generatorName: metadata.generatorName }).onConflictDoUpdate({ target: readings.id, set: { generatedJson: item.reading, spokenText: item.reading.spokenText,generatorName:metadata.generatorName } }); if (item.audio) await this.db.insert(audioAssets).values({ id: crypto.randomUUID(), readingId, provider: metadata.audioProvider, voice: metadata.voice, contentHash: item.audio.contentHash, localPath: item.audio.localPath, durationMs: item.audio.durationMs }).onConflictDoUpdate({ target: audioAssets.contentHash, set: { readingId, provider:metadata.audioProvider,voice:metadata.voice,localPath: item.audio.localPath, durationMs: item.audio.durationMs } }); } }
  async savePlaybackAttempt(input: { id: string; requestId: string; commandId: string; status: string; startedAt?: number; lastHeartbeatAt?: number; completedAt?: number; error?: string }): Promise<void> { await this.db.insert(playbackAttempts).values({ id: input.id, requestId: input.requestId, commandId: input.commandId, status: input.status, ...(input.startedAt !== undefined ? { startedAt: new Date(input.startedAt) } : {}), ...(input.lastHeartbeatAt !== undefined ? { lastHeartbeatAt: new Date(input.lastHeartbeatAt) } : {}), ...(input.completedAt !== undefined ? { completedAt: new Date(input.completedAt) } : {}), ...(input.error ? { error: input.error } : {}) }).onConflictDoUpdate({ target: playbackAttempts.id, set: { status: input.status, ...(input.lastHeartbeatAt !== undefined ? { lastHeartbeatAt: new Date(input.lastHeartbeatAt) } : {}), ...(input.completedAt !== undefined ? { completedAt: new Date(input.completedAt) } : {}), ...(input.error ? { error: input.error } : {}) } }); }
  async recover(accountKey: string): Promise<DurableRecovery> {
    const sessions = await this.db.select().from(liveSessions).where(eq(liveSessions.accountKey, accountKey)).orderBy(desc(liveSessions.startedAt)).limit(5);
    const sessionIds = sessions.map((row) => row.id);
    const productRows=await this.db.select().from(giftProducts).where(eq(giftProducts.accountKey,accountKey));
    const userRows = await this.db.select().from(users);
    const commentRows = sessionIds.length ? await this.db.select().from(comments).where(inArray(comments.sessionId, sessionIds)) : [];
    const giftRows=sessionIds.length?await this.db.select().from(giftEvents).where(inArray(giftEvents.sessionId,sessionIds)):[];
    const entRows = giftRows.length?await this.db.select().from(entitlements).where(and(inArray(entitlements.giftEventId,giftRows.map((row)=>row.id)),inArray(entitlements.status, ["AWAITING_QUESTION", "MODERATION", "QUEUED", "FULFILLING", "NEEDS_REPLACEMENT", "MANUAL_REVIEW"]))):[];
    const reqRows = sessionIds.length ? await this.db.select().from(readingRequests).where(and(inArray(readingRequests.sessionId, sessionIds), inArray(readingRequests.status, ["RECEIVED", "MODERATION", "CARD_SELECTION", "GENERATING_TEXT", "VALIDATING_TEXT", "GENERATING_AUDIO", "READY", "PLAYING", "COMPLETED", "FAILED_RETRYABLE", "MANUAL_REVIEW"]))) : [];
    const likeRows=sessionIds.length?await this.db.select().from(likeTotals).where(inArray(likeTotals.sessionId,sessionIds)):[];
    const grantRows=sessionIds.length?await this.db.select().from(freeReadingGrants).where(inArray(freeReadingGrants.sessionId,sessionIds)):[];
    const requestIds = reqRows.map((row) => row.id);
    const cardRows = requestIds.length ? await this.db.select().from(selectedCards).where(inArray(selectedCards.requestId, requestIds)) : [];
    const readingRows = requestIds.length ? await this.db.select().from(readings).where(inArray(readings.requestId, requestIds)) : [];
    const audioRows = readingRows.length ? await this.db.select().from(audioAssets).where(inArray(audioAssets.readingId, readingRows.map((row) => row.id))) : [];
    return {
      sessions: sessions.map((row) => ({ id: row.id, accountKey: row.accountKey, locale: row.locale, status: row.status, startedAt: row.startedAt.getTime(), ...(row.endedAt ? { endedAt: row.endedAt.getTime() } : {}) })),
      users: userRows.map((row) => ({ id: row.id, platform: row.platform, platformUserId: row.platformUserId, username: row.username, displayName: row.displayName })),
      comments: commentRows.map((row) => ({ id: row.id, sessionId: row.sessionId, userId: row.userId, text: row.text, occurredAt: row.occurredAt.getTime() })),
      products:productRows,
      likeTotals:likeRows.map((row)=>({sessionId:row.sessionId,userId:row.userId,platformUserId:row.platformUserId,quantity:row.quantity})),
      freeGrants:grantRows.map((row)=>({id:row.id,sessionId:row.sessionId,userId:row.userId,platformUserId:row.platformUserId,requestId:row.requestId,likeCount:row.likeCount,createdAt:row.createdAt.getTime()})),
      entitlements: entRows.map((row) => ({ id: row.id, giftEventId: row.giftEventId, sessionId:giftRows.find((gift)=>gift.id===row.giftEventId)!.sessionId, userId: row.userId, productId: row.productId, status: row.status, ...(row.questionDeadline ? { questionDeadline: row.questionDeadline.getTime() } : {}), ...(row.failureReason ? { failureReason: row.failureReason } : {}), createdAt: row.createdAt.getTime(), ...(row.completedAt ? { completedAt: row.completedAt.getTime() } : {}) })),
      requests: reqRows.map((row) => {
        const reading = readingRows.find((candidate) => candidate.requestId === row.id);
        const audio = reading ? audioRows.find((candidate) => candidate.readingId === reading.id) : undefined;
        const request: DurableRequest = { id: row.id, sessionId: row.sessionId, userId: row.userId, displayName: row.displayName, source: row.source as "paid" | "free", status: row.status, priority: row.priority, queuedAt: row.queuedAt.getTime() };
        if (row.entitlementId) request.entitlementId = row.entitlementId;
        if (row.question) request.question = row.question;
        if (row.startedAt) request.startedAt = row.startedAt.getTime();
        if (row.completedAt) request.completedAt = row.completedAt.getTime();
        const cards = cardRows.filter((card) => card.requestId === row.id);
        if (cards.length) { request.cards = cards.sort((a,b)=>a.position-b.position).map((card) => ({ id: card.cardId, orientation: card.orientation as "upright" | "reversed" })); request.seedHash=cards[0]!.seedHash; }
        if (reading) request.reading = reading.generatedJson as NonNullable<DurableRequest["reading"]>;
        if (audio) request.audio = { contentHash: audio.contentHash, localPath: audio.localPath, durationMs: audio.durationMs };
        return request;
      })
    };
  }
  private async appendOutboxWith(db: any, topic: string, aggregateId: string, payloadJson: unknown, id = crypto.randomUUID()): Promise<void> { await db.insert(outbox).values({ id, topic, aggregateId, payloadJson }); }
  async appendOutbox(topic: string, aggregateId: string, payloadJson: unknown): Promise<void> { await this.appendOutboxWith(this.db, topic, aggregateId, payloadJson); }
  async audit(action: string, requestId: string | undefined, detailJson: unknown): Promise<void> { await this.db.insert(operatorActions).values({ id: crypto.randomUUID(), action, ...(requestId ? { requestId } : {}), detailJson }); }
  async systemEvent(type: string, payloadJson: unknown): Promise<void> { await this.db.insert(systemEvents).values({ id: crypto.randomUUID(), type, payloadJson }); }
  async unpublishedOutbox(limit = 100): Promise<Array<typeof outbox.$inferSelect>> { return this.db.select().from(outbox).where(isNull(outbox.publishedAt)).orderBy(asc(outbox.availableAt)).limit(limit); }
  async markOutboxPublished(id: string): Promise<void> { await this.db.update(outbox).set({ publishedAt: new Date() }).where(eq(outbox.id, id)); }
  async markOutboxFailed(id: string, error: string): Promise<void> { await this.db.update(outbox).set({ attempts: sql`${outbox.attempts} + 1`, lastError: error }).where(eq(outbox.id, id)); }
  async stuckRequests(before: Date): Promise<Array<typeof readingRequests.$inferSelect>> { return this.db.select().from(readingRequests).where(and(eq(readingRequests.status, "PLAYING"), lte(readingRequests.startedAt, before))); }
}

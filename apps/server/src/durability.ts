import type { LiveEvent, LiveUser } from "@tarot/contracts";
import { createDatabase, DurableRepository, type DurableEntitlement, type DurableIngestion, type DurableProduct, type DurableRecovery, type DurableRequest, type DurableUser } from "@tarot/db";
import type { AppConfig } from "@tarot/config";
import type { Entitlement, Request } from "./store.js";

export function toDurableEntitlement(item: Entitlement): DurableEntitlement { return { id: item.id, giftEventId: item.giftEventId, sessionId:item.sessionId, userId: item.userId, productId: item.productId, status: item.status, ...(item.questionDeadline !== undefined ? { questionDeadline: item.questionDeadline } : {}), ...(item.failureReason ? { failureReason: item.failureReason } : {}), createdAt: item.createdAt, ...(item.completedAt !== undefined ? { completedAt: item.completedAt } : {}) }; }
export function toDurableRequest(item: Request): DurableRequest { return { id: item.id, ...(item.entitlementId ? { entitlementId: item.entitlementId } : {}), sessionId: item.sessionId, userId: item.userId, displayName: item.displayName, source: item.source, ...(item.question ? { question: item.question } : {}), status: item.status, priority: item.priority, queuedAt: item.queuedAt, ...(item.startedAt !== undefined ? { startedAt: item.startedAt } : {}), ...(item.completedAt !== undefined ? { completedAt: item.completedAt } : {}), ...(item.cards ? { cards: item.cards.map((card) => ({ id: card.id, orientation: card.orientation })) } : {}), ...(item.seedHash ? { seedHash: item.seedHash } : {}), ...(item.reading ? { reading: item.reading as NonNullable<DurableRequest["reading"]> } : {}), ...(item.audio?.contentHash && item.audio.localPath ? { audio: { contentHash: item.audio.contentHash, localPath: item.audio.localPath, durationMs: item.audio.durationMs } } : {}) }; }
export function toDurableUser(item: LiveUser & { id: string }): DurableUser { return { id: item.id, platform: "tiktok", platformUserId: item.platformUserId, username: item.username, displayName: item.displayName }; }

export interface DurabilityPort {
  mode: "memory" | "postgres";
  createSession(input: { id: string; accountKey: string; locale: string }): Promise<void>;
  ensureProducts(products:DurableProduct[]):Promise<void>;
  ready():Promise<boolean>;
  eventExists(eventId: string, source: string): Promise<boolean>;
  recordEvent(event: LiveEvent, source: string): Promise<boolean>;
  ingestAtomically(input: DurableIngestion): Promise<boolean>;
  saveEntitlement(item: DurableEntitlement): Promise<void>;
  saveRequest(item: DurableRequest): Promise<void>;
  saveFulfillment(item: DurableRequest, locale: string,metadata:{generatorName:string;audioProvider:string;voice:string}): Promise<void>;
  savePlaybackAttempt(input: { id: string; requestId: string; commandId: string; status: string; startedAt?: number; lastHeartbeatAt?: number; completedAt?: number; error?: string }): Promise<void>;
  recover(accountKey: string): Promise<DurableRecovery>;
  appendOutbox(topic: string, aggregateId: string, payload: unknown): Promise<void>;
  markOutboxPublished(id: string): Promise<void>;
  audit(action: string, requestId: string | undefined, detail: unknown): Promise<void>;
  close(): Promise<void>;
}

class MemoryDurability implements DurabilityPort {
  mode = "memory" as const;
  async createSession(): Promise<void> {}
  async ensureProducts():Promise<void> {}
  async ready():Promise<boolean> { return true; }
  async eventExists(): Promise<boolean> { return false; }
  async recordEvent(): Promise<boolean> { return true; }
  async ingestAtomically(): Promise<boolean> { return true; }
  async saveEntitlement(): Promise<void> {}
  async saveRequest(): Promise<void> {}
  async saveFulfillment(): Promise<void> {}
  async savePlaybackAttempt(): Promise<void> {}
  async recover(): Promise<DurableRecovery> { return { sessions: [], users: [], comments: [], entitlements: [], requests: [] }; }
  async appendOutbox(): Promise<void> {}
  async markOutboxPublished(): Promise<void> {}
  async audit(): Promise<void> {}
  async close(): Promise<void> {}
}

class PostgresDurability implements DurabilityPort {
  mode = "postgres" as const;
  constructor(private readonly repository: DurableRepository, private readonly closePool: () => Promise<void>,private readonly accountKey:string,private readonly locale:string) {}
  createSession(input: { id: string; accountKey: string; locale: string }): Promise<void> { return this.repository.createSession(input); }
  ensureProducts(products:DurableProduct[]):Promise<void> { return this.repository.ensureProducts(products); }
  ready():Promise<boolean> { return this.repository.ready(); }
  eventExists(eventId: string, source: string): Promise<boolean> { return this.repository.eventExists(eventId, source); }
  recordEvent(event: LiveEvent, source: string): Promise<boolean> { return this.repository.recordEvent(event, source); }
  ingestAtomically(input: DurableIngestion): Promise<boolean> { return this.repository.ingestAtomically({...input,accountKey:this.accountKey,locale:this.locale}); }
  saveEntitlement(item: DurableEntitlement): Promise<void> { return this.repository.saveEntitlement(item); }
  saveRequest(item: DurableRequest): Promise<void> { return this.repository.saveRequest(item); }
  saveFulfillment(item: DurableRequest, locale: string,metadata:{generatorName:string;audioProvider:string;voice:string}): Promise<void> { return this.repository.saveFulfillment(item, locale,metadata); }
  savePlaybackAttempt(input: { id: string; requestId: string; commandId: string; status: string; startedAt?: number; lastHeartbeatAt?: number; completedAt?: number; error?: string }): Promise<void> { return this.repository.savePlaybackAttempt(input); }
  recover(accountKey: string): Promise<DurableRecovery> { return this.repository.recover(accountKey); }
  appendOutbox(topic: string, aggregateId: string, payload: unknown): Promise<void> { return this.repository.appendOutbox(topic, aggregateId, payload); }
  markOutboxPublished(id: string): Promise<void> { return this.repository.markOutboxPublished(id); }
  audit(action: string, requestId: string | undefined, detail: unknown): Promise<void> { return this.repository.audit(action, requestId, detail); }
  close(): Promise<void> { return this.closePool(); }
}

export function createDurability(config: AppConfig): DurabilityPort {
  if (config.PERSISTENCE === "memory") return new MemoryDurability();
  const { db, pool } = createDatabase(config.DATABASE_URL);
  return new PostgresDurability(new DurableRepository(db), () => pool.end().then(() => undefined),config.ACCOUNT_KEY,config.DEFAULT_LOCALE);
}

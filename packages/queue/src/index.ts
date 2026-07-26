import crypto from "node:crypto";
import { Queue, Worker, type Job } from "bullmq";
import { Redis } from "ioredis";

export const queueNames = { readings: "tarot-readings", reconciliation: "tarot-reconciliation" } as const;
export type ReadingJob = { requestId: string };
export type ReconciliationJob = { kind: "outbox" | "stuck-work" | "awaiting-question" | "audio-files" };
export function createRedisConnection(redisUrl: string): Redis { return new Redis(redisUrl, { maxRetriesPerRequest: null, enableReadyCheck: true }); }
export function createReadingQueue(redisUrl: string): Queue<ReadingJob> { return new Queue<ReadingJob>(queueNames.readings, { connection: createRedisConnection(redisUrl), defaultJobOptions: { attempts: 3, backoff: { type: "exponential", delay: 1000 }, removeOnComplete: 1000, removeOnFail: 5000 } }); }
export function createReconciliationQueue(redisUrl: string): Queue<ReconciliationJob> { return new Queue<ReconciliationJob>(queueNames.reconciliation, { connection: createRedisConnection(redisUrl), defaultJobOptions: { attempts: 5, backoff: { type: "exponential", delay: 5000 }, removeOnComplete: 1000 } }); }
export function startReadingWorker(redisUrl: string, processor: (job: Job<ReadingJob>) => Promise<void>): Worker<ReadingJob> { return new Worker<ReadingJob>(queueNames.readings, processor, { connection: createRedisConnection(redisUrl), concurrency: 4 }); }
export function startReconciliationWorker(redisUrl: string, processor: (job: Job<ReconciliationJob>) => Promise<void>): Worker<ReconciliationJob> { return new Worker<ReconciliationJob>(queueNames.reconciliation, processor, { connection: createRedisConnection(redisUrl), concurrency: 1 }); }

export interface PlaybackLease {
  acquire(): Promise<boolean>;
  renew(): Promise<boolean>;
  release(): Promise<void>;
  ready():Promise<boolean>;
  close(): Promise<void>;
}

const renewScript = "if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('pexpire', KEYS[1], ARGV[2]) else return 0 end";
const releaseScript = "if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('del', KEYS[1]) else return 0 end";

export function createPlaybackLease(redisUrl: string, key: string, ttlMs = 15_000): PlaybackLease {
  const redis = createRedisConnection(redisUrl);
  const token = crypto.randomUUID();
  let owned = false;
  return {
    async acquire(): Promise<boolean> {
      const result = await redis.set(key, token, "PX", ttlMs, "NX");
      owned = result === "OK";
      return owned;
    },
    async renew(): Promise<boolean> {
      if (!owned) return false;
      const result = await redis.eval(renewScript, 1, key, token, String(ttlMs));
      owned = Number(result) === 1;
      return owned;
    },
    async release(): Promise<void> {
      if (!owned) return;
      await redis.eval(releaseScript, 1, key, token);
      owned = false;
    },
    async ready():Promise<boolean> { try { return await redis.ping()==="PONG"; } catch { return false; } },
    async close(): Promise<void> { await redis.quit(); }
  };
}

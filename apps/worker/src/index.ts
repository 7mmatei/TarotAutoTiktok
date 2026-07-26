import { loadConfig } from "@tarot/config";
import { createDatabase, DurableRepository } from "@tarot/db";
import { createReadingQueue, createReconciliationQueue, startReadingWorker, startReconciliationWorker } from "@tarot/queue";

const config = loadConfig();
const serverUrl = process.env.SERVER_URL ?? "http://127.0.0.1:3001";

if (config.PERSISTENCE === "postgres" && config.QUEUE_PROVIDER === "redis") {
  const { db, pool } = createDatabase(config.DATABASE_URL);
  const repository = new DurableRepository(db);
  const readingQueue = createReadingQueue(config.REDIS_URL);
  const reconciliationQueue = createReconciliationQueue(config.REDIS_URL);
  startReadingWorker(config.REDIS_URL, async (job) => {
    const response = await fetch(`${serverUrl}/api/internal/reading-jobs/${job.data.requestId}/process`, { method: "POST", headers: { authorization: `Bearer ${config.ADMIN_TOKEN}` } });
    if (!response.ok) throw new Error(`Reading job failed with HTTP ${response.status}`);
  });
  startReconciliationWorker(config.REDIS_URL, async (job) => {
    if(job.data.kind==="outbox") {
      const rows = await repository.unpublishedOutbox();
      for (const row of rows) {
        const payload = row.payloadJson as { id?: string; requestId?: string };
        const requestId = payload.requestId ?? payload.id;
        if (!requestId) { await repository.markOutboxFailed(row.id, "Outbox payload has no request ID"); continue; }
        try { await readingQueue.add("reading.requested", { requestId }, { jobId: row.id }); await repository.markOutboxPublished(row.id); }
        catch(error) { await repository.markOutboxFailed(row.id,String(error)); throw error; }
      }
      return;
    }
    const response=await fetch(`${serverUrl}/api/internal/reconcile`,{method:"POST",headers:{authorization:`Bearer ${config.ADMIN_TOKEN}`,"content-type":"application/json"},body:JSON.stringify({kind:job.data.kind})});
    if(!response.ok) throw new Error(`Reconciliation ${job.data.kind} failed with HTTP ${response.status}`);
  });
  const heartbeat=async()=>{try{const response=await fetch(`${serverUrl}/api/internal/worker-heartbeat`,{method:"POST",headers:{authorization:`Bearer ${config.ADMIN_TOKEN}`}});if(!response.ok)throw new Error(`HTTP ${response.status}`);}catch(error){console.error("worker heartbeat failed",error);}};
  const enqueueReconciliation=(kind:"outbox"|"stuck-work"|"awaiting-question"|"audio-files",bucketMs:number)=>{const bucket=Math.floor(Date.now()/bucketMs);return reconciliationQueue.add(kind,{kind},{jobId:`${kind}-${bucket}`}).catch((error)=>console.error("reconciliation enqueue failed",error));};
  void heartbeat();
  void enqueueReconciliation("outbox",5_000);
  setInterval(()=>void heartbeat(),5_000);
  setInterval(()=>void enqueueReconciliation("outbox",5_000),5_000);
  setInterval(()=>{for(const kind of ["stuck-work","awaiting-question","audio-files"] as const)void enqueueReconciliation(kind,60_000);},60_000);
  console.log("Worker online: PostgreSQL outbox + Redis/BullMQ");
  process.once("SIGTERM", () => { pool.end().catch(console.error); });
} else {
  console.log("Worker reconciliation loop ready (memory mode)");
  setInterval(async () => { try { const status = await fetch(`${serverUrl}/api/status`).then((response) => response.json()) as { awaiting?: unknown[]; queue?: unknown[] }; console.log(JSON.stringify({ topic: "reconciliation", at: new Date().toISOString(), awaiting: status.awaiting?.length ?? 0, queue: status.queue?.length ?? 0 })); } catch (error) { console.error("reconciliation failed", error); } }, 60_000);
}

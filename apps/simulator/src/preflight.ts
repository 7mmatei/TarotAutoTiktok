import crypto from "node:crypto";

const baseUrl=process.env.SERVER_URL??"http://127.0.0.1:3001";
const token=crypto.randomUUID().slice(0,8);
const question=`¿Qué energía positiva puedo observar hoy? Referencia ${token}`;
const user={userId:`mora-preflight-${token}`,uniqueId:`mora_preflight_${token}`,nickname:"Mora Preflight"};
const startedAt=Date.now();

async function request(path:string,init?:RequestInit):Promise<any> {
  const response=await fetch(`${baseUrl}${path}`,init);
  if(!response.ok)throw new Error(`${path} failed with HTTP ${response.status}: ${await response.text()}`);
  const text=await response.text();
  return text?JSON.parse(text):undefined;
}

async function waitForServer():Promise<void> {
  for(let attempt=0;attempt<30;attempt++) {
    try { await request("/health"); return; } catch { await new Promise((resolve)=>setTimeout(resolve,1000)); }
  }
  throw new Error("Server did not become healthy within 30 seconds");
}

async function report(passed:boolean,requestId?:string,detail?:unknown):Promise<void> {
  try {
    await request("/api/preflight/report",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({passed,...(requestId?{requestId}:{}),...(detail!==undefined?{detail}:{})})});
  } catch(error) {
    console.error("Could not report preflight result",error);
  }
}

async function main():Promise<void> {
  await waitForServer();
  await request("/api/preflight/start",{method:"POST"});
  const readyResponse=await fetch(`${baseUrl}/ready`);
  const health=await readyResponse.json() as any;
  if(!health.renderer?.ready)throw new Error("Open the 1080x1920 renderer Browser Source before running preflight");
  if(health.redis?.mode==="redis"&&!health.worker?.ready)throw new Error("The reading worker is not running or has no fresh heartbeat");
  if(health.eventSource?.mode==="tikfinity") {
    await request("/api/tikfinity/replay",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({event:"chat",data:{eventId:`preflight-comment-${token}`,sessionId:process.env.LIVE_SESSION_ID,...user,message:question}})});
    await new Promise((resolve)=>setTimeout(resolve,250));
    await request("/api/tikfinity/replay",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({event:"gift",data:{eventId:`preflight-gift-${token}`,sessionId:process.env.LIVE_SESSION_ID,...user,giftId:"perfume",giftName:"Perfume",repeatCount:1,repeatEnd:true}})});
  } else {
    const session=await request("/api/sessions",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({locale:"es-MX"})});
    const common={sessionId:session.id,occurredAt:new Date().toISOString(),user:{platformUserId:user.userId,username:user.uniqueId,displayName:user.nickname}};
    await request("/api/simulator/events",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({...common,type:"COMMENT",id:`preflight-comment-${token}`,text:question})});
    await request("/api/simulator/events",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({...common,type:"GIFT_COMPLETED",id:`preflight-gift-${token}`,giftId:"perfume",giftName:"Perfume",quantity:1})});
  }
  let requestId:string|undefined;
  let lastStatus="not_seen";
  for(let attempt=0;attempt<180;attempt++) {
    const status=await request("/api/status");
    const item=(status.recentRequests??[]).find((candidate:any)=>String(candidate.question??"").includes(token));
    if(item) {
      requestId=item.id;
      if(item.status!==lastStatus) {
        lastStatus=item.status;
        console.log(`Preflight request ${requestId}: ${lastStatus}`);
      }
      if(item.status==="COMPLETED") {
        const diagnostics=await request("/api/provider-events");
        const detail={latencyMs:Date.now()-startedAt,providerPayloads:diagnostics.received,rejectedPayloads:diagnostics.rejected,cards:item.cards?.length??0,llm:Boolean(item.reading),audio:Boolean(item.audio)};
        if((item.cards?.length??0)!==1||!item.reading||!item.audio)throw new Error(`Incomplete reading result: ${JSON.stringify(detail)}`);
        await report(true,requestId,detail);
        console.log(`LIVE PREFLIGHT PASSED in ${detail.latencyMs} ms`);
        return;
      }
      if(["FAILED_RETRYABLE","MANUAL_REVIEW"].includes(item.status))throw new Error(`Preflight request ended in ${item.status}`);
    }
    await new Promise((resolve)=>setTimeout(resolve,1000));
  }
  throw new Error(`Preflight timed out; last request state was ${lastStatus}`);
}

main().catch(async(error)=>{
  const message=error instanceof Error?error.message:String(error);
  await report(false,undefined,{error:message,latencyMs:Date.now()-startedAt});
  console.error(`LIVE PREFLIGHT FAILED: ${message}`);
  process.exitCode=1;
});

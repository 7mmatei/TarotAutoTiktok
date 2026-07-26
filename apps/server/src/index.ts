import crypto from "node:crypto";
import Fastify from "fastify";
import { access, readFile } from "node:fs/promises";
import path from "node:path";
import websocket from "@fastify/websocket";
import cors from "@fastify/cors";
import { z } from "zod";
import { loadConfig } from "@tarot/config";
import { liveEventSchema, rendererMessageSchema, type LiveEvent } from "@tarot/contracts";
import { SimulatorEventSource, TikfinityEventSource, createInteractionGenerator, createReadingGenerator, createSpeechProvider, type TikfinityPayloadDiagnostic } from "@tarot/adapters";
import { premoderate } from "@tarot/domain";
import { createPlaybackLease, createReadingQueue } from "@tarot/queue";
import { allCards } from "@tarot/tarot";
import { MemoryStore } from "./store.js";
import { ReadingEngine, safeViewerNameForSpeech } from "./engine.js";
import { createDurability, toDurableEntitlement, toDurableRequest, toDurableUser } from "./durability.js";
import { GeminiDailyBudget } from "./geminiBudget.js";

const config=loadConfig();
const durability=createDurability(config);
const playbackLease=config.QUEUE_PROVIDER==="redis" ? createPlaybackLease(config.REDIS_URL,`tarot:playback:${config.ACCOUNT_KEY}`,config.PLAYBACK_LEASE_TTL_MS) : undefined;
const readingQueue=config.QUEUE_PROVIDER==="redis" ? createReadingQueue(config.REDIS_URL) : undefined;
const store=new MemoryStore(config.ACCOUNT_KEY,config.FREE_LIKES_THRESHOLD,config.QUESTION_LOOKBACK_SECONDS*1000,config.AWAITING_QUESTION_SECONDS*1000);
const speech=createSpeechProvider({provider:config.TTS_PROVIDER,audioDir:config.AUDIO_DIR,region:config.TTS_REGION,voice:config.TTS_VOICE,...(config.TTS_API_KEY ? {apiKey:config.TTS_API_KEY} : {})});
const geminiBudget=new GeminiDailyBudget(path.join(config.AUDIO_DIR,"gemini-request-budget.json"),config.GEMINI_DAILY_REQUEST_BUDGET,config.GEMINI_INTERACTION_DAILY_BUDGET);
const llmStatus={provider:config.LLM_PROVIDER,model:config.GEMINI_MODEL,configured:config.LLM_PROVIDER!=="gemini"||Boolean(config.GEMINI_API_KEY),attempts:0,successes:0,failures:0,lastAttemptAt:null as string|null,lastSuccessAt:null as string|null,lastFailureAt:null as string|null,lastError:null as string|null};
function safeLlmError(error:unknown):string { const message=error instanceof Error?error.message:String(error); return config.GEMINI_API_KEY?message.replaceAll(config.GEMINI_API_KEY,"[redacted]"):message; }
const generator=createReadingGenerator({provider:config.LLM_PROVIDER,model:config.GEMINI_MODEL,...(config.GEMINI_API_KEY?{apiKey:config.GEMINI_API_KEY}:{}),...(config.LLM_PROVIDER==="gemini"?{hooks:{beforeRequest:()=>{geminiBudget.acquire("reading");},onAttempt:()=>{llmStatus.attempts++;llmStatus.lastAttemptAt=new Date().toISOString();},onSuccess:()=>{llmStatus.successes++;llmStatus.lastSuccessAt=new Date().toISOString();store.actions.push({at:Date.now(),action:"LLM_REQUEST_SUCCEEDED",detail:{provider:config.LLM_PROVIDER,model:config.GEMINI_MODEL}});},onFailure:(error:unknown)=>{llmStatus.failures++;llmStatus.lastFailureAt=new Date().toISOString();llmStatus.lastError=safeLlmError(error);store.actions.push({at:Date.now(),action:"LLM_REQUEST_FAILED",detail:{provider:config.LLM_PROVIDER,model:config.GEMINI_MODEL,error:safeLlmError(error)}});}}}:{})});
const interactionGenerator=createInteractionGenerator({provider:config.LLM_PROVIDER,model:config.GEMINI_MODEL,...(config.GEMINI_API_KEY?{apiKey:config.GEMINI_API_KEY}:{}),...(config.LLM_PROVIDER==="gemini"?{hooks:{beforeRequest:()=>{geminiBudget.acquire("interaction");},onAttempt:()=>{llmStatus.attempts++;llmStatus.lastAttemptAt=new Date().toISOString();},onSuccess:()=>{llmStatus.successes++;llmStatus.lastSuccessAt=new Date().toISOString();store.actions.push({at:Date.now(),action:"LLM_INTERACTION_SUCCEEDED",detail:{provider:config.LLM_PROVIDER,model:config.GEMINI_MODEL}});},onFailure:(error:unknown)=>{llmStatus.failures++;llmStatus.lastFailureAt=new Date().toISOString();llmStatus.lastError=safeLlmError(error);store.actions.push({at:Date.now(),action:"LLM_INTERACTION_FAILED",detail:{provider:config.LLM_PROVIDER,model:config.GEMINI_MODEL,error:safeLlmError(error)}});}}}:{})});
const fallbackInteractionGenerator=createInteractionGenerator({provider:"deterministic",model:config.GEMINI_MODEL});
const engine=new ReadingEngine(store,config.HMAC_SECRET,config.AUDIO_DIR,speech,generator);
const providerDiagnostics:TikfinityPayloadDiagnostic[]=[];
function retainProviderDiagnostic(diagnostic:TikfinityPayloadDiagnostic):void {
  providerDiagnostics.push(diagnostic);
  if(providerDiagnostics.length>200)providerDiagnostics.splice(0,providerDiagnostics.length-200);
  if(!diagnostic.normalized) {
    const payload = diagnostic.payload && typeof diagnostic.payload === "object" && !Array.isArray(diagnostic.payload) ? diagnostic.payload as Record<string, unknown> : undefined;
    const payloadKeys = payload ? Object.keys(payload).slice(0, 20) : [];
    const eventType = payload ? ["type", "eventType", "event", "name", "action", "command"].map((key) => payload[key]).find((value) => typeof value === "string" || typeof value === "number") : undefined;
    store.actions.push({at:Date.now(),action:"PROVIDER_PAYLOAD_REJECTED",detail:{receivedAt:diagnostic.receivedAt,error:diagnostic.error??"unsupported_payload",...(eventType !== undefined ? {eventType:String(eventType)} : {}),...(payloadKeys.length ? {payloadKeys} : {})}});
  }
}
const source=config.EVENT_SOURCE==="tikfinity" ? new TikfinityEventSource(config.TIKFINITY_WS_URL,config.LIVE_SESSION_ID,{onPayloadDiagnostic:retainProviderDiagnostic}) : new SimulatorEventSource();
const app=Fastify({logger:{level:config.LOG_LEVEL}}); await app.register(cors,{origin:true}); await app.register(websocket);
let workerHeartbeatAt=0;
let preflight:{status:"not_run"|"running"|"passed"|"failed";updatedAt:number;requestId?:string;detail?:unknown}={status:"not_run",updatedAt:Date.now()};
async function persistRequestState(requestId:string):Promise<void> { const request=store.requests.get(requestId); if(!request) return; await durability.saveRequest(toDurableRequest(request)); if(request.entitlementId) { const entitlement=store.entitlements.get(request.entitlementId); if(entitlement) await durability.saveEntitlement(toDurableEntitlement(entitlement)); } }
async function persistFulfillment(requestId:string):Promise<void> { const request=store.requests.get(requestId); if(!request) return; await persistRequestState(requestId); if(request.reading && request.audio?.contentHash && request.audio.localPath) await durability.saveFulfillment(toDurableRequest(request),store.latestSession()?.locale ?? config.DEFAULT_LOCALE,{generatorName:config.LLM_PROVIDER,audioProvider:config.TTS_PROVIDER,voice:config.TTS_VOICE}); }
async function persistPlayback(status:string, extra: { startedAt?:number; lastHeartbeatAt?:number; completedAt?:number; error?:string } = {}):Promise<void> { const attempt=engine.playbackAttempt(); if(!attempt) return; await durability.savePlaybackAttempt({id:attempt.id,requestId:attempt.requestId,commandId:attempt.commandId,status,...extra}); }
async function releasePlaybackLease():Promise<void> { if(playbackLease) await playbackLease.release(); }
let playbackWatchdog: NodeJS.Timeout | undefined;
let leaseRenewal:NodeJS.Timeout|undefined;
let ctaInitialTimer:NodeJS.Timeout|undefined;
let ctaInterval:NodeJS.Timeout|undefined;
let tarotFocusInitialTimer:NodeJS.Timeout|undefined;
let tarotFocusInterval:NodeJS.Timeout|undefined;
const defaultCtaText="Mora está leyendo el chat en vivo. Escribe una pregunta breve para participar.";
const defaultCtaTexts=[
  defaultCtaText,
  "Cada lectura nace de una pregunta distinta. Cuéntame qué energía quieres mirar hoy.",
  "Las cartas no prometen el futuro: abren una conversación. Deja tu pregunta en el chat.",
  "¿Te llegó una señal esta semana? Escribe tu pregunta y Mora mezclará el mazo contigo.",
  "El mazo está despierto. Una pregunta clara ayuda a encontrar un mensaje para reflexionar.",
  "Si estás pasando por un cambio, comparte una pregunta breve. Las cartas pueden acompañar tu reflexión.",
  "Mora está observando el chat. Tu siguiente pregunta puede ser la próxima lectura en vivo.",
  "Estoy siguiendo lo que ocurre ahora mismo en el chat. Escribe una pregunta breve y conversemos en vivo.",
  "Respira, piensa en tu pregunta y escríbela en el chat. El mensaje de las cartas empieza contigo.",
  "Este espacio es para entretenimiento y reflexión. Comparte una pregunta y participa en el LIVE."
];
const ctaVisuals=[
  {characterState:"listening",effect:"luminous-feathers"},
  {characterState:"mysterious",effect:"constellation-markings"},
  {characterState:"thinking",effect:"card-orbit"},
  {characterState:"shuffling",effect:"golden-plumage"},
  {characterState:"happy",effect:"radiant-wings"},
  {characterState:"grateful",effect:"heart-glow"},
  {characterState:"surprised",effect:"wing-embrace"},
  {characterState:"mysterious",effect:"grand-reveal"},
  {characterState:"listening",effect:"card-orbit"},
  {characterState:"happy",effect:"luminous-feathers"}
] as const;
let ctaAssets:Array<{audioUrl:string;durationMs:number;characterState:string;effect:string}>=[];
type TarotFocusAsset={cardId:string;title:string;subtitle:string;audioUrl:string;durationMs:number;characterState:string;effect:string};
let tarotFocusAssets:TarotFocusAsset[]=[];
let tarotFocusBag:number[]=[];
let tarotFocusCount=0;
let lastCtaIndex=-1;
let lastCtaPlayedAt=0;
let sessionCtaCount=0;
let interactionSpeechBusy=false;
let interactionSpeechLastAt=0;
let interactionSpeechWatchdog:NodeJS.Timeout|undefined;
let commentInteractionSequence=0;
type PendingCommentInteraction={displayName:string;comment:string;visual?:{characterState:string;effect:string};enqueuedAt:number};
const pendingCommentInteractions:PendingCommentInteraction[]=[];
type PendingGiftInteraction={displayName:string;giftName:string;quantity:number;enqueuedAt:number};
const pendingGiftInteractions:PendingGiftInteraction[]=[];
let viewerEventsSinceLastCta=0;
let lastViewerEventAt=0;
function clearPlaybackWatchdog(): void { if(playbackWatchdog) clearTimeout(playbackWatchdog); playbackWatchdog = undefined; }
function clearLeaseRenewal():void { if(leaseRenewal) clearInterval(leaseRenewal); leaseRenewal=undefined; }
function clearCtaSchedule():void { if(ctaInitialTimer) clearTimeout(ctaInitialTimer);if(ctaInterval) clearInterval(ctaInterval);ctaInitialTimer=undefined;ctaInterval=undefined; }
function clearTarotFocusSchedule():void { if(tarotFocusInitialTimer) clearTimeout(tarotFocusInitialTimer);if(tarotFocusInterval) clearTimeout(tarotFocusInterval);tarotFocusInitialTimer=undefined;tarotFocusInterval=undefined; }
function clearInteractionSpeechWatchdog():void { if(interactionSpeechWatchdog) clearTimeout(interactionSpeechWatchdog);interactionSpeechWatchdog=undefined; }
function interactionSpeechCanPlay():boolean { return !store.currentRequestId&&!store.pausedPlayback&&store.rendererClients.size>0; }
function finishInteractionSpeech(reason:string):void {
  if(!interactionSpeechBusy)return;
  clearInteractionSpeechWatchdog();
  interactionSpeechBusy=false;
  store.actions.push({at:Date.now(),action:"INTERACTION_TTS_FINISHED",detail:{reason}});
}
async function promptForGiftQuestion(displayName:string,cards:number):Promise<void> {
  if(!config.INTERACTION_TTS_ENABLED||interactionSpeechBusy||Date.now()-interactionSpeechLastAt<config.INTERACTION_TTS_MIN_INTERVAL_SECONDS*1000||!interactionSpeechCanPlay())return;
  interactionSpeechBusy=true;
  interactionSpeechLastAt=Date.now();
  try {
    const name=safeViewerNameForSpeech(displayName)??"quien nos acompaña";
    const tier=`${cards} carta${cards===1?"":"s"}`;
    const text=config.INTERACTION_TTS_GIFT_AWAITING_TEXT.replaceAll("{name}",name).replaceAll("{cards}",tier);
    const audio=await speech.synthesize({locale:config.DEFAULT_LOCALE,voice:config.TTS_VOICE,text});
    // If a reading arrived while synthesizing, it will carry its own spoken thank-you.
    if(!interactionSpeechCanPlay()) { finishInteractionSpeech("superseded_by_reading"); return; }
    const durationMs=audio.durationMs;
    store.broadcast({type:"PLAY_INTERACTION_TTS",audioUrl:`/audio/${audio.contentHash}.${audio.format}`,durationMs,characterState:"grateful",effect:giftEffect(cards)});
    store.actions.push({at:Date.now(),action:"INTERACTION_TTS_PLAYED",detail:{kind:"gift_awaiting_question",durationMs}});
    interactionSpeechWatchdog=setTimeout(()=>finishInteractionSpeech("renderer_timeout"),Math.max(10_000,durationMs+5_000));
  } catch(error) {
    app.log.warn({error:String(error)},"interaction TTS synthesis failed");
    finishInteractionSpeech("synthesis_failed");
  }
}
function safeGiftNameForSpeech(value:string):string|undefined {
  const normalized=value.normalize("NFKD").replace(/[\u0300-\u036f]/g,"").replace(/[^\p{L}\p{N}\s-]/gu," ").trim().replace(/\s+/g," ").slice(0,40).trim();
  return normalized||undefined;
}
async function drainGiftInteractionQueue():Promise<void> {
  if(interactionSpeechBusy||Date.now()-interactionSpeechLastAt<config.INTERACTION_TTS_MIN_INTERVAL_SECONDS*1000||!interactionSpeechCanPlay())return;
  const pending=pendingGiftInteractions.shift();
  if(!pending)return;
  const name=safeViewerNameForSpeech(pending.displayName);
  const giftName=safeGiftNameForSpeech(pending.giftName);
  if(!name||!giftName)return;
  interactionSpeechBusy=true;
  interactionSpeechLastAt=Date.now();
  try {
    const gift=`${pending.quantity>1?`${pending.quantity} `:""}${giftName}`;
    const text=`${name}, gracias por enviar ${gift}. Los regalos son opcionales; me alegra tenerte aquí en el LIVE.`;
    const audio=await speech.synthesize({locale:config.DEFAULT_LOCALE,voice:config.TTS_VOICE,text});
    if(!interactionSpeechCanPlay()){pendingGiftInteractions.unshift(pending);finishInteractionSpeech("superseded_by_reading");return;}
    store.broadcast({type:"PLAY_INTERACTION_TTS",audioUrl:`/audio/${audio.contentHash}.${audio.format}`,durationMs:audio.durationMs,characterState:"grateful",effect:"heart-glow"});
    store.actions.push({at:Date.now(),action:"INTERACTION_TTS_PLAYED",detail:{kind:"unmapped_gift_thank_you",giftName,quantity:pending.quantity,durationMs:audio.durationMs}});
    interactionSpeechWatchdog=setTimeout(()=>finishInteractionSpeech("renderer_timeout"),Math.max(10_000,audio.durationMs+5_000));
  } catch(error) {
    app.log.warn({error:String(error)},"unmapped gift TTS synthesis failed");
    finishInteractionSpeech("synthesis_failed");
  }
}
function queueUnmappedGiftThankYou(displayName:string,giftName:string,quantity:number):void {
  if(!config.INTERACTION_TTS_ENABLED)return;
  pendingGiftInteractions.push({displayName,giftName,quantity,enqueuedAt:Date.now()});
  if(pendingGiftInteractions.length>12)pendingGiftInteractions.splice(0,pendingGiftInteractions.length-12);
  store.actions.push({at:Date.now(),action:"INTERACTION_QUEUED",detail:{kind:"unmapped_gift",giftName,quantity,pending:pendingGiftInteractions.length}});
  void drainGiftInteractionQueue();
}
function safeCommentSnippet(text:string,maxChars=48):string|undefined {
  if(premoderate(text).action!=="ALLOW")return undefined;
  const normalized=text.normalize("NFKD").replace(/[\u0300-\u036f]/g,"").replace(/[^\p{L}\p{N}\s]/gu," ").trim().replace(/\s+/g," ");
  if(normalized.length<4)return undefined;
  return normalized.slice(0,maxChars).trim();
}
async function drainCommentInteractionQueue():Promise<void> {
  if(interactionSpeechBusy||Date.now()-interactionSpeechLastAt<config.INTERACTION_TTS_MIN_INTERVAL_SECONDS*1000||!interactionSpeechCanPlay())return;
  const pending=pendingCommentInteractions.shift();
  if(!pending)return;
  const snippet=safeCommentSnippet(pending.comment,96);
  const name=safeViewerNameForSpeech(pending.displayName);
  if(!snippet||!name)return;
  interactionSpeechBusy=true;
  interactionSpeechLastAt=Date.now();
  try {
    let response;
    let generatedBy:"gemini"|"local"="local";
    commentInteractionSequence++;
    const sampledForGemini=config.LLM_PROVIDER==="gemini"&&commentInteractionSequence%config.GEMINI_INTERACTION_EVERY_N_COMMENTS===0;
    const useGemini=sampledForGemini&&geminiBudget.canUseInteraction();
    if(useGemini) {
      try {
        response=await interactionGenerator.generate({locale:config.DEFAULT_LOCALE,viewerName:name,comment:snippet,maxWords:32});
        generatedBy="gemini";
      } catch(error) {
        app.log.warn({error:String(error)},"Gemini comment interaction generation failed; using safe local response");
        response=await fallbackInteractionGenerator.generate({locale:config.DEFAULT_LOCALE,viewerName:name,comment:snippet,maxWords:32});
      }
    } else {
      geminiBudget.skipInteraction();
      store.actions.push({at:Date.now(),action:"LLM_INTERACTION_SKIPPED",detail:{reason:sampledForGemini?"daily_interaction_budget":"sampled_local",everyNComments:config.GEMINI_INTERACTION_EVERY_N_COMMENTS}});
      response=await fallbackInteractionGenerator.generate({locale:config.DEFAULT_LOCALE,viewerName:name,comment:snippet,maxWords:32});
    }
    const audio=await speech.synthesize({locale:config.DEFAULT_LOCALE,voice:config.TTS_VOICE,text:response.spokenText});
    if(!interactionSpeechCanPlay()){pendingCommentInteractions.unshift(pending);finishInteractionSpeech("superseded_by_reading");return;}
    store.broadcast({type:"PLAY_INTERACTION_TTS",audioUrl:`/audio/${audio.contentHash}.${audio.format}`,durationMs:audio.durationMs,characterState:pending.visual?.characterState??"listening",effect:pending.visual?.effect});
    store.actions.push({at:Date.now(),action:"INTERACTION_TTS_PLAYED",detail:{kind:"comment_response",durationMs:audio.durationMs,generatedBy}});
    interactionSpeechWatchdog=setTimeout(()=>finishInteractionSpeech("renderer_timeout"),Math.max(10_000,audio.durationMs+5_000));
  } catch(error) {
    app.log.warn({error:String(error)},"comment interaction TTS synthesis failed");
    finishInteractionSpeech("synthesis_failed");
  }
}
function promptForCommentResponse(displayName:string,comment:string,visual?:{characterState:string;effect:string}):void {
  const snippet=safeCommentSnippet(comment,72);
  if(!snippet||!config.INTERACTION_TTS_ENABLED)return;
  const existing=pendingCommentInteractions.findIndex((item)=>item.displayName===displayName);
  const pending={displayName,comment:snippet,...(visual?{visual}:{}),enqueuedAt:Date.now()};
  if(existing>=0)pendingCommentInteractions.splice(existing,1,pending);
  else pendingCommentInteractions.push(pending);
  if(pendingCommentInteractions.length>8)pendingCommentInteractions.splice(0,pendingCommentInteractions.length-8);
  store.actions.push({at:Date.now(),action:"INTERACTION_QUEUED",detail:{kind:"comment",pending:pendingCommentInteractions.length}});
  void drainCommentInteractionQueue();
}
async function prepareCtaAssets():Promise<void> {
  if(!config.CTA_TTS_ENABLED)return;
  const configured=config.CTA_TTS_TEXTS?.split("|").map((text)=>text.trim()).filter(Boolean);
  const texts=configured?.length?configured:(config.CTA_TTS_TEXT===defaultCtaText?defaultCtaTexts:[config.CTA_TTS_TEXT]);
  const unique=[...new Set(texts)].slice(0,12);
  ctaAssets=await Promise.all(unique.map(async(text,index)=>{const audio=await speech.synthesize({locale:config.DEFAULT_LOCALE,voice:config.TTS_VOICE,text});return{audioUrl:`/audio/${audio.contentHash}.${audio.format}`,durationMs:audio.durationMs,...ctaVisuals[index%ctaVisuals.length]!};}));
}
async function prepareTarotFocusAssets():Promise<void> {
  if(!config.TAROT_FOCUS_ENABLED)return;
  const featured=allCards().filter((card)=>!card.id.includes("-of-")).slice(0,22);
  tarotFocusAssets=await Promise.all(featured.map(async(card,index)=>{
    const title=`Carta en foco · ${card.names["es-MX"]}`;
    const subtitle=card.upright.general;
    const text=`Carta en foco: ${card.names["es-MX"]}. Esta carta invita a reflexionar sobre ${card.upright.general}. Observa el símbolo y cuéntame en el chat qué parte conecta contigo hoy.`;
    const audio=await speech.synthesize({locale:config.DEFAULT_LOCALE,voice:config.TTS_VOICE,text});
    return {cardId:card.id,title,subtitle,audioUrl:`/audio/${audio.contentHash}.${audio.format}`,durationMs:audio.durationMs,...ctaVisuals[(index+2)%ctaVisuals.length]!};
  }));
}
function shuffleFocusBag():void {
  tarotFocusBag=tarotFocusAssets.map((_asset,index)=>index);
  for(let index=tarotFocusBag.length-1;index>0;index--){const swap=Math.floor(Math.random()*(index+1));[tarotFocusBag[index],tarotFocusBag[swap]]=[tarotFocusBag[swap]!,tarotFocusBag[index]!];}
}
function playTarotFocusIfIdle():void {
  if(!config.TAROT_FOCUS_ENABLED||!tarotFocusAssets.length||tarotFocusCount>=config.TAROT_FOCUS_MAX_PER_SESSION||interactionSpeechBusy||pendingGiftInteractions.length>0||pendingCommentInteractions.length>0||store.currentRequestId||store.pausedPlayback||store.queue().length>0||store.rendererClients.size===0)return;
  if(!tarotFocusBag.length)shuffleFocusBag();
  const asset=tarotFocusAssets[tarotFocusBag.shift()!]!;
  tarotFocusCount++;
  store.broadcast({type:"PLAY_TAROT_FOCUS",...asset});
  store.actions.push({at:Date.now(),action:"TAROT_FOCUS_PLAYED",detail:{cardId:asset.cardId,durationMs:asset.durationMs,sessionCount:tarotFocusCount,maxPerSession:config.TAROT_FOCUS_MAX_PER_SESSION}});
}
function scheduleNextTarotFocus():void {
  const jitter=.86+Math.random()*.28;
  tarotFocusInterval=setTimeout(()=>{playTarotFocusIfIdle();scheduleNextTarotFocus();},Math.round(config.TAROT_FOCUS_INTERVAL_SECONDS*1000*jitter));
}
function startTarotFocusSchedule():void {
  if(!config.TAROT_FOCUS_ENABLED||!tarotFocusAssets.length)return;
  tarotFocusInitialTimer=setTimeout(()=>{playTarotFocusIfIdle();scheduleNextTarotFocus();},config.TAROT_FOCUS_INITIAL_DELAY_SECONDS*1000);
}
function playCtaIfIdle():void {
  const now=Date.now();
  if(!ctaAssets.length||sessionCtaCount>=config.CTA_TTS_MAX_PER_SESSION||now-lastCtaPlayedAt<config.CTA_TTS_MIN_GAP_SECONDS*1000||viewerEventsSinceLastCta===0||now-lastViewerEventAt>120_000||interactionSpeechBusy||pendingGiftInteractions.length>0||pendingCommentInteractions.length>0||store.currentRequestId||store.pausedPlayback||store.queue().length>0||store.rendererClients.size===0)return;
  const candidates=ctaAssets.map((_asset,index)=>index).filter((index)=>index!==lastCtaIndex);
  const index=(candidates.length?candidates:[0])[Math.floor(Math.random()*(candidates.length||1))]!;
  const ctaAsset=ctaAssets[index]!;
  lastCtaIndex=index;
  lastCtaPlayedAt=now;
  sessionCtaCount++;
  viewerEventsSinceLastCta=0;
  store.broadcast({type:"PLAY_CTA",...ctaAsset});
  store.actions.push({at:now,action:"IDLE_CTA_PLAYED",detail:{durationMs:ctaAsset.durationMs,variant:index,sessionCount:sessionCtaCount,maxPerSession:config.CTA_TTS_MAX_PER_SESSION,characterState:ctaAsset.characterState,effect:ctaAsset.effect}});
}
function scheduleNextCta():void {
  const jitter=.8+Math.random()*.4;
  ctaInterval=setTimeout(()=>{playCtaIfIdle();scheduleNextCta();},Math.round(config.CTA_TTS_INTERVAL_SECONDS*1000*jitter));
}
function startCtaSchedule():void { if(!config.CTA_TTS_ENABLED||!ctaAssets.length)return;ctaInitialTimer=setTimeout(()=>{playCtaIfIdle();scheduleNextCta();},config.CTA_TTS_INITIAL_DELAY_SECONDS*1000); }
function playbackWatchdogDelay(request: Parameters<ReadingEngine["play"]>[0]): number { const cardCount = request.cards?.length ?? 1; const finalCue = 1_800 + Math.max(0, cardCount - 1) * 2_500; return Math.max(config.PLAYBACK_WATCHDOG_GRACE_MS, (request.audio?.durationMs ?? 3_000) + config.PLAYBACK_WATCHDOG_GRACE_MS, finalCue + config.PLAYBACK_WATCHDOG_GRACE_MS); }
async function completePlayback(reason: string): Promise<void> { clearPlaybackWatchdog(); clearLeaseRenewal(); const requestId=store.currentRequestId; if(!requestId) return; const attempt=engine.playbackAttempt(); engine.complete(requestId); await persistRequestState(requestId); if(attempt) await durability.savePlaybackAttempt({id:attempt.id,requestId,commandId:attempt.commandId,status:"COMPLETED",completedAt:Date.now()}); await releasePlaybackLease(); if(reason!=="renderer") app.log.warn({requestId,reason},"playback completed outside the renderer acknowledgment path"); }
async function failPlayback(reason: string): Promise<void> { clearPlaybackWatchdog(); clearLeaseRenewal(); const requestId=store.currentRequestId; if(!requestId) return; const attempt=engine.playbackAttempt(); engine.failPlayback(requestId,reason); await persistRequestState(requestId); if(attempt) await durability.savePlaybackAttempt({id:attempt.id,requestId,commandId:attempt.commandId,status:"FAILED",error:reason}); await releasePlaybackLease(); store.broadcast({type:"RESET",requestId}); }
async function startPlayback(request: Parameters<ReadingEngine["play"]>[0]):Promise<boolean> { if(playbackLease && !(await playbackLease.acquire())) return false; try { await engine.play(request); await persistRequestState(request.id); await persistPlayback("PLAYING",{startedAt:Date.now()}); clearPlaybackWatchdog(); playbackWatchdog=setTimeout(()=>{void failPlayback("renderer_completion_timeout");},playbackWatchdogDelay(request)); if(playbackLease) leaseRenewal=setInterval(()=>{void playbackLease.renew().then((renewed)=>{if(!renewed) void failPlayback("playback_lease_lost");});},Math.max(1000,Math.floor(config.PLAYBACK_LEASE_TTL_MS/3))); return true; } catch (error) { clearPlaybackWatchdog(); clearLeaseRenewal(); await releasePlaybackLease(); throw error; } }
async function recoverFromPersistence():Promise<void> { await durability.ensureProducts([...store.products.values()]); const snapshot=await durability.recover(config.ACCOUNT_KEY); store.restore(snapshot); for(const request of store.requests.values()) { if(["CARD_SELECTION","GENERATING_TEXT","VALIDATING_TEXT","GENERATING_AUDIO"].includes(request.status)) { request.status="FAILED_RETRYABLE"; store.actions.push({at:Date.now(),action:"STUCK_REQUEST_RECOVERED",requestId:request.id}); } if(request.status!=="COMPLETED"&&request.audio?.localPath) { try { await access(request.audio.localPath); } catch { request.status="FAILED_RETRYABLE"; if(request.entitlementId) { const entitlement=store.entitlements.get(request.entitlementId); if(entitlement&&["QUEUED","FULFILLING"].includes(entitlement.status)) entitlement.status="NEEDS_REPLACEMENT"; } store.actions.push({at:Date.now(),action:"MISSING_AUDIO_RECOVERED",requestId:request.id}); } } if(["RECEIVED","MODERATION","FAILED_RETRYABLE"].includes(request.status)) { try { await engine.process(request.id); await persistFulfillment(request.id); } catch(error) { app.log.error({error:String(error),requestId:request.id},"recovered request processing failed"); } } else if(request.status==="READY" || request.status==="PLAYING") await persistRequestState(request.id); } if(snapshot.sessions.length || snapshot.requests.length) app.log.info({sessions:snapshot.sessions.length,requests:snapshot.requests.length},"durable state recovered"); }
async function auth(request:any,reply:any):Promise<void> { if(request.headers.host?.startsWith("localhost") || request.headers.host?.startsWith("127.0.0.1")) return; if(request.headers.authorization!==`Bearer ${config.ADMIN_TOKEN}`) { reply.code(401).send({error:"Unauthorized"}); } }
async function internalAuth(request:any,reply:any):Promise<void> { if(request.headers.authorization!==`Bearer ${config.ADMIN_TOKEN}`) reply.code(401).send({error:"Unauthorized"}); }
function currentSessionMetrics():Record<string,number> {
  const sessionId=store.latestSession()?.id;
  const requests=[...store.requests.values()].filter((item)=>!sessionId||item.sessionId===sessionId);
  const grants=[...store.freeGrants.values()].filter((item)=>!sessionId||item.sessionId===sessionId);
  const likes=[...store.likeTotals.entries()].filter(([key])=>!sessionId||key.startsWith(`${sessionId}:`)).reduce((sum,[,value])=>sum+value,0);
  return {events:store.rawEvents.size,users:store.users.size,entitlements:[...store.entitlements.values()].filter((item)=>!sessionId||item.sessionId===sessionId).length,requests:requests.length,completed:requests.filter((item)=>item.status==="COMPLETED").length,paidQueued:requests.filter((item)=>item.source==="paid"&&item.status==="READY").length,freeQueued:requests.filter((item)=>item.source==="free"&&item.status==="READY").length,freeGranted:grants.length,freeCompleted:requests.filter((item)=>item.source==="free"&&item.status==="COMPLETED").length,likes,freeLikesThreshold:store.freeLikesThreshold};
}
app.get("/health",async()=>({status:"ok",service:"tarot-live-engine",time:new Date().toISOString()}));
app.post("/api/internal/worker-heartbeat",{preHandler:internalAuth},async()=>{workerHeartbeatAt=Date.now();return{accepted:true,at:workerHeartbeatAt};});
app.get("/api/preflight",async()=>preflight);
app.post("/api/preflight/start",{preHandler:auth},async()=>{preflight={status:"running",updatedAt:Date.now()};store.actions.push({at:Date.now(),action:"PREFLIGHT_STARTED"});return preflight;});
app.post("/api/preflight/report",{preHandler:auth},async(request:any)=>{const body=z.object({passed:z.boolean(),requestId:z.string().optional(),detail:z.unknown().optional()}).parse(request.body??{});preflight={status:body.passed?"passed":"failed",updatedAt:Date.now(),...(body.requestId?{requestId:body.requestId}:{}),...(body.detail!==undefined?{detail:body.detail}:{})};store.actions.push({at:Date.now(),action:body.passed?"PREFLIGHT_PASSED":"PREFLIGHT_FAILED",...(body.requestId?{requestId:body.requestId}:{}),...(body.detail!==undefined?{detail:body.detail}:{})});return preflight;});
app.post("/api/tikfinity/replay",{preHandler:auth},async(request:any,reply)=>{if(!(source instanceof TikfinityEventSource))return reply.code(409).send({error:"TikFinity event source is not active"});source.recordRawEvent(request.body);return{accepted:true};});
app.get("/api/provider-events",async()=>({received:providerDiagnostics.length,rejected:providerDiagnostics.filter((item)=>!item.normalized).length,events:providerDiagnostics.slice(-100)}));
app.get("/ready",async(_request,reply)=>{
  const database=await durability.ready();
  const redis=playbackLease?await playbackLease.ready():true;
  const productionConfigured=config.PERSISTENCE==="postgres"&&config.QUEUE_PROVIDER==="redis";
  const stableLiveSession=config.EVENT_SOURCE!=="tikfinity"||Boolean(config.LIVE_SESSION_ID);
  const eventSourceReady=source instanceof TikfinityEventSource?source.isConnected():true;
  const ctaReady=!config.CTA_TTS_ENABLED||ctaAssets.length>0;
  const tarotFocusReady=!config.TAROT_FOCUS_ENABLED||tarotFocusAssets.length>0;
  const rendererReady=store.rendererClients.size>0;
  const workerAgeMs=workerHeartbeatAt?Date.now()-workerHeartbeatAt:null;
  const workerReady=config.QUEUE_PROVIDER!=="redis"||(workerAgeMs!==null&&workerAgeMs<=config.WORKER_HEARTBEAT_MAX_AGE_MS);
  const preflightReady=!productionConfigured||preflight.status==="passed";
  const ready=database&&redis&&stableLiveSession&&eventSourceReady&&ctaReady&&tarotFocusReady&&rendererReady&&workerReady&&preflightReady&&(productionConfigured||config.PERSISTENCE==="memory");
  const blockers=[
    !productionConfigured&&config.PERSISTENCE!=="memory"?"PostgreSQL and Redis production mode is incomplete":undefined,
    !stableLiveSession?"LIVE_SESSION_ID is required for restart-safe TikFinity grants":undefined,
    !eventSourceReady?"TikFinity is not connected":undefined,
    !ctaReady?"CTA audio is not ready":undefined,
    !tarotFocusReady?"Tarot-focus audio is not ready":undefined,
    !rendererReady?"The 1080x1920 browser renderer is not connected":undefined,
    !workerReady?"The reading worker heartbeat is missing or stale":undefined,
    !preflightReady?"Run pnpm preflight:live and wait for it to pass":undefined,
  ].filter(Boolean);
  return reply.code(ready?200:503).send({
    status:ready?"ready":"not_ready",
    liveReady:ready,
    database:{mode:config.PERSISTENCE,ready:database},
    redis:{mode:config.QUEUE_PROVIDER,ready:redis},
    eventSource:{mode:config.EVENT_SOURCE,ready:eventSourceReady,receivedPayloads:providerDiagnostics.length,rejectedPayloads:providerDiagnostics.filter((item)=>!item.normalized).length},
    llm:{...llmStatus,budget:geminiBudget.snapshot()},
    worker:{ready:workerReady,lastHeartbeatAt:workerHeartbeatAt?new Date(workerHeartbeatAt).toISOString():null,ageMs:workerAgeMs},
    renderer:{ready:rendererReady,clients:store.rendererClients.size},
    cta:{enabled:config.CTA_TTS_ENABLED,ready:ctaReady,variants:ctaAssets.length},
    tarotFocus:{enabled:config.TAROT_FOCUS_ENABLED,ready:tarotFocusReady,variants:tarotFocusAssets.length,played:tarotFocusCount,maxPerSession:config.TAROT_FOCUS_MAX_PER_SESSION},
    preflight,
    stableLiveSession,
    productionConfigured,
    blockers,
  });
});
app.post("/api/sessions",{preHandler:auth},async(request:any)=>{const session=store.createSession(z.object({locale:z.string().optional()}).parse(request.body ?? {}).locale ?? config.DEFAULT_LOCALE); await durability.createSession({id:session.id,accountKey:session.accountKey,locale:session.locale}); return session;});
app.post("/api/sessions/:id/end",{preHandler:auth},async(request:any,reply)=>{const session=store.sessions.get(request.params.id);if(!session)return reply.code(404).send({error:"Session not found"});session.status="ENDED";session.endedAt=Date.now();return session;});
app.get("/api/status",async()=>({session:store.latestSession(),current:store.currentRequest(),queue:store.queue(),review:store.reviewQueue(),awaiting:[...store.entitlements.values()].filter((e)=>e.status==="AWAITING_QUESTION"),recentRequests:[...store.requests.values()].sort((a,b)=>b.queuedAt-a.queuedAt).slice(0,20),llm:{...llmStatus,budget:geminiBudget.snapshot()},interaction:{pendingGifts:pendingGiftInteractions.length,pendingComments:pendingCommentInteractions.length,busy:interactionSpeechBusy,lastViewerEventAt:lastViewerEventAt?new Date(lastViewerEventAt).toISOString():null,viewerEventsSinceLastCta},metrics:currentSessionMetrics()}));
app.get("/api/queue",async()=>({paid:store.queue().filter((r)=>r.source==="paid"),free:store.queue().filter((r)=>r.source==="free")}));
app.get("/api/requests/:id",async(request:any,reply)=>{const item=store.requests.get(request.params.id);return item ?? reply.code(404).send({error:"Request not found"});});
app.get("/api/products",async()=>[...store.products.values()]);
app.put("/api/products/:id",{preHandler:auth},async(request:any,reply)=>{const item=[...store.products.values()].find((p)=>p.id===request.params.id);if(!item)return reply.code(404).send({error:"Product not found"});Object.assign(item,z.object({enabled:z.boolean().optional(),priority:z.number().optional(),maxWords:z.number().optional()}).parse(request.body ?? {}));return item;});
app.post("/api/requests/:id/approve",{preHandler:auth},async(request:any,reply)=>{const item=store.requests.get(request.params.id);if(!item)return reply.code(404).send({error:"Request not found"});if(item.status==="MANUAL_REVIEW") {store.transitionRequest(item.id,"MODERATION");await engine.process(item.id);}return item;});
app.post("/api/requests/:id/retry",{preHandler:auth},async(request:any,reply)=>{const item=store.requests.get(request.params.id);if(!item)return reply.code(404).send({error:"Request not found"});if(item.status!=="FAILED_RETRYABLE")return reply.code(409).send({error:"Request is not retryable"});await engine.process(item.id);return item;});
app.post("/api/internal/reading-jobs/:id/process",{preHandler:internalAuth},async(request:any,reply)=>{const item=store.requests.get(request.params.id);if(!item)return reply.code(404).send({error:"Request not loaded in this process"});await engine.process(item.id);await persistFulfillment(item.id);return {requestId:item.id,status:item.status};});
app.post("/api/internal/reconcile",{preHandler:internalAuth},async(request:any)=>{const kind=z.object({kind:z.enum(["stuck-work","awaiting-question","audio-files"])}).parse(request.body).kind;let repaired=0;if(kind==="awaiting-question"){for(const entitlement of store.expireAwaitingQuestions()){await durability.saveEntitlement(toDurableEntitlement(entitlement));repaired++;}}if(kind==="stuck-work"&&store.currentRequest()?.startedAt&&store.currentRequest()!.startedAt!<Date.now()-playbackWatchdogDelay(store.currentRequest()!)){await failPlayback("stale_playback_reconciled");repaired++;}if(kind==="audio-files"){for(const item of store.queue()){if(!item.audio?.localPath)continue;try{await access(item.audio.localPath);}catch{item.status="FAILED_RETRYABLE";await persistRequestState(item.id);repaired++;}}}return{kind,repaired};});
app.post("/api/requests/:id/replay",{preHandler:auth},async(request:any,reply)=>{const item=store.requests.get(request.params.id);if(!item)return reply.code(404).send({error:"Request not found"});if(item.status!=="COMPLETED")return reply.code(409).send({error:"Only completed readings can replay"});item.status="READY";if(!(await startPlayback(item)))return reply.code(409).send({error:"Playback is owned by another process"});return item;});
app.post("/api/requests/:id/replacement",{preHandler:auth},async(request:any,reply)=>{const item=store.requests.get(request.params.id);if(!item)return reply.code(404).send({error:"Request not found"});if(item.entitlementId) {const entitlement=store.entitlements.get(item.entitlementId);if(entitlement?.status==="NEEDS_REPLACEMENT")store.transitionEntitlement(entitlement.id,"QUEUED");}item.status="READY";return item;});
app.post("/api/playback/pause",{preHandler:auth},async()=>{store.pausedPlayback=true;store.broadcast({type:"PAUSE"});return {paused:true};});
app.post("/api/playback/resume",{preHandler:auth},async()=>{store.pausedPlayback=false;return {paused:false};});
app.post("/api/playback/reset",{preHandler:auth},async()=>{await failPlayback("operator_reset");store.broadcast({type:"RESET"});return {reset:true};});
app.post("/api/simulator/events",{preHandler:auth},async(request:any,reply)=>{const parsed=liveEventSchema.safeParse(request.body);if(!parsed.success)return reply.code(400).send({error:"Malformed event",issues:parsed.error.issues});source.push(parsed.data);return {accepted:true,id:parsed.data.id};});
app.get("/api/events",async()=>({events:[...store.rawEvents.values()].slice(-100),actions:store.actions.slice(-100)}));
app.get("/audio/:file",async(request:any,reply)=>{const file=path.basename(String(request.params.file));const filePath=path.join(config.AUDIO_DIR,file);try {const content=await readFile(filePath);if(file.toLowerCase().endsWith(".wav")) return reply.type("audio/wav").header("cache-control","public, max-age=31536000, immutable").send(content);if(file.toLowerCase().endsWith(".mp3")) return reply.type("audio/mpeg").header("cache-control","public, max-age=31536000, immutable").send(content);return reply.type("text/plain").send(content); } catch { return reply.code(404).send({error:"Audio asset not found"}); }});
app.register(async(instance)=>{instance.get("/ws/renderer",{websocket:true},(socket:any)=>{store.rendererClients.add(socket);socket.send(JSON.stringify({sequence:store.rendererSequence,type:"SNAPSHOT",status:{current:store.currentRequest(),queue:store.queue()}}));socket.on("message",(raw:Buffer)=>{void (async()=>{try {const parsed=rendererMessageSchema.safeParse(JSON.parse(raw.toString()));if(!parsed.success)return;const message=parsed.data;const attempt=engine.playbackAttempt();if("commandId" in message&&message.commandId&&attempt&&message.commandId!==attempt.commandId)return;if(message.type==="READY") socket.send(JSON.stringify({sequence:store.rendererSequence,type:"SNAPSHOT",status:{current:store.currentRequest(),queue:store.queue()}}));if(message.type==="STARTED") await persistPlayback("STARTED",{lastHeartbeatAt:Date.now()});if(message.type==="HEARTBEAT"||message.type==="PROGRESS") { if(playbackLease) await playbackLease.renew(); await persistPlayback("PLAYING",{lastHeartbeatAt:Date.now()}); } if(message.type==="COMPLETED"&&message.commandId===attempt?.commandId) await completePlayback("renderer"); if(message.type==="ERROR") await failPlayback(`renderer_error:${message.error}`); if(message.type==="INTERACTION_COMPLETED") finishInteractionSpeech("renderer_completed"); if(message.type==="INTERACTION_ERROR") finishInteractionSpeech(`renderer_error:${message.error}`); } catch {/* malformed renderer messages are ignored */}})();});socket.on("close",()=>{store.rendererClients.delete(socket);finishInteractionSpeech("renderer_disconnected");if(store.currentRequestId) void failPlayback("renderer_disconnected");});});});
app.register(async(instance)=>{instance.get("/ws/dashboard",{websocket:true},(socket:any)=>{const timer=setInterval(()=>socket.send(JSON.stringify({type:"STATUS",status:{session:store.latestSession(),current:store.currentRequest(),queue:store.queue(),awaiting:[...store.entitlements.values()].filter((e)=>e.status==="AWAITING_QUESTION")}})),1000);socket.on("close",()=>clearInterval(timer));});});
let lastPassiveInteractionAt=0;
type ViewerPulseKind="comment"|"like"|"follow"|"join"|"gift";
/**
 * Ambient audience feedback for the renderer's activity rail. Separate from
 * VIEWER_INTERACTION: a pulse is a named one-line acknowledgement that keeps running
 * underneath a reading, where VIEWER_INTERACTION takes over the headline and is
 * suppressed during playback. Likes arrive in bursts, so each kind is throttled.
 */
const pulseThrottleMs:Record<ViewerPulseKind,number>={comment:1_400,like:2_600,follow:700,join:900,gift:0};
const lastPulseAt:Partial<Record<ViewerPulseKind,number>>={};
const commentVisuals=[
  {characterState:"listening",effect:"card-orbit"},
  {characterState:"thinking",effect:"constellation-markings"},
  {characterState:"happy",effect:"luminous-feathers"},
  {characterState:"mysterious",effect:"grand-reveal"},
] as const;
let lastCommentVisualIndex=-1;
function nextCommentVisual():typeof commentVisuals[number] {
  const candidates=commentVisuals.map((_visual,index)=>index).filter((index)=>index!==lastCommentVisualIndex);
  const index=(candidates.length?candidates:[0])[Math.floor(Math.random()*candidates.length)]!;
  lastCommentVisualIndex=index;
  return commentVisuals[index]!;
}
function broadcastViewerPulse(kind:ViewerPulseKind,displayName:string,detail?:string):void {
  // Pulses put chat names on the broadcast overlay. Before pulses, on-screen names came
  // almost only from gifters; this path is open to the whole chat, so names go through
  // the same strip-to-letters-and-digits filter as spoken names and a rejected name
  // drops the pulse entirely rather than falling back to a generic label.
  const name=safeViewerNameForSpeech(displayName);
  if(!name||store.rendererClients.size===0)return;
  const now=Date.now();
  const throttle=pulseThrottleMs[kind];
  if(throttle&&now-(lastPulseAt[kind]??0)<throttle)return;
  lastPulseAt[kind]=now;
  store.broadcast({type:"VIEWER_PULSE",kind,name,...(detail?{detail}:{})});
}
function giftEffect(cards:number):string { return cards>=7?"grand-reveal":cards>=5?"constellation-markings":cards>=3?"heart-glow":"golden-plumage"; }
function broadcastIntakeFeedback(event:LiveEvent,result:ReturnType<MemoryStore["ingest"]>):void {
  if("user" in event) {
    lastViewerEventAt=Date.now();
    if(event.type==="FOLLOW"){viewerEventsSinceLastCta++;broadcastViewerPulse("follow",event.user.displayName);}
    else if(event.type==="JOIN"){viewerEventsSinceLastCta++;broadcastViewerPulse("join",event.user.displayName);}
    else if(event.type==="LIKE")broadcastViewerPulse("like",event.user.displayName);
    else if(event.type==="COMMENT") {
      viewerEventsSinceLastCta++;
      const snippet=safeCommentSnippet(event.text,28);
      broadcastViewerPulse("comment",event.user.displayName,snippet?`“${snippet}”`:undefined);
    }
  }
  if(event.type==="ROOM_STATS") {
    store.broadcast({type:"ROOM_STATS",viewerCount:event.viewerCount});
    return;
  }
  if(event.type==="GIFT_COMPLETED"&&"user" in event) {
    const product=result.entitlement?[...store.products.values()].find((item)=>item.id===result.entitlement!.productId):undefined;
    if(!product) {
      broadcastViewerPulse("gift",event.user.displayName,event.quantity>1?`${event.quantity} × ${event.giftName}`:event.giftName);
      store.broadcast({type:"VIEWER_INTERACTION",title:`Gracias, ${event.user.displayName}`,subtitle:`Recibí tu ${event.giftName} · los regalos son opcionales`,characterState:"grateful",effect:"heart-glow",durationMs:5500});
      queueUnmappedGiftThankYou(event.user.displayName,event.giftName,event.quantity);
      store.actions.push({at:Date.now(),action:"UNMAPPED_GIFT",detail:{giftId:event.giftId,giftName:event.giftName,acknowledged:true}});
      return;
    }
    broadcastViewerPulse("gift",event.user.displayName,`${product.cards} carta${product.cards===1?"":"s"}`);
    store.broadcast({
      type:"VIEWER_INTERACTION",
      title:`Gracias, ${event.user.displayName}`,
      subtitle:result.created?`Tu lectura de ${product.cards} carta${product.cards===1?"":"s"} está entrando en la fila`:`Escribe ahora tu pregunta para activar tu lectura de ${product.cards} carta${product.cards===1?"":"s"}`,
      characterState:"grateful",
      effect:giftEffect(product.cards),
      durationMs:6500,
    });
    if(!result.created) void promptForGiftQuestion(event.user.displayName,product.cards);
    return;
  }
  if(result.created&&event.type==="COMMENT"&&"user" in event) {
    const entitlement=result.entitlement;
    const product=entitlement?[...store.products.values()].find((item)=>item.id===entitlement.productId):undefined;
    const snippet=safeCommentSnippet(event.text,64);
    const visual=nextCommentVisual();
    store.broadcast({type:"VIEWER_INTERACTION",title:`Te leo, ${event.user.displayName}`,subtitle:snippet?`“${snippet}”`:product?`Tu lectura de ${product.cards} carta${product.cards===1?"":"s"} está entrando en la fila`:"Tu lectura está entrando en la fila",characterState:visual.characterState,effect:visual.effect,durationMs:5500});
    promptForCommentResponse(event.user.displayName,event.text,visual);
    return;
  }
  if(result.created&&event.type==="LIKE"&&"user" in event) {
    store.broadcast({type:"VIEWER_INTERACTION",title:`Lectura gratuita para ${event.user.displayName}`,subtitle:"Gracias por participar en el LIVE",characterState:"happy",effect:"luminous-feathers",durationMs:5500});
    return;
  }
  if(event.type==="COMMENT"&&Date.now()-lastPassiveInteractionAt>12_000&&!store.currentRequestId) {
    lastPassiveInteractionAt=Date.now();
    const snippet=safeCommentSnippet(event.text,64);
    const visual=nextCommentVisual();
    store.broadcast({type:"VIEWER_INTERACTION",title:`Te leo, ${event.user.displayName}`,subtitle:snippet?`“${snippet}”`:"Mora está escuchando el chat en vivo",characterState:visual.characterState,effect:visual.effect,durationMs:4500});
    promptForCommentResponse(event.user.displayName,event.text,visual);
  }
}
async function dispatchReading(requestId:string,outboxId:string):Promise<void> {
  if(config.QUEUE_PROVIDER==="memory") {
    await engine.process(requestId);
    await persistFulfillment(requestId);
    await durability.audit("REQUEST_READY",requestId,{source:"server"});
    return;
  }
  if(!readingQueue)throw new Error("Redis reading queue is unavailable");
  await readingQueue.add("reading.requested",{requestId},{jobId:outboxId});
  await durability.markOutboxPublished(outboxId);
  await durability.audit("REQUEST_DISPATCHED",requestId,{source:"server",outboxId});
}
async function consume():Promise<void> {
  for await(const event of source.events()) {
    try {
      if(await durability.eventExists(event.id,config.EVENT_SOURCE))continue;
      const result=store.ingest(event);
      if(result.duplicate)continue;
      const user="user" in event?store.users.get(`tiktok:${event.user.platformUserId}`):undefined;
      const comment=event.type==="COMMENT"&&user?{sessionId:event.sessionId,userId:user.id,text:event.text,occurredAt:new Date(event.occurredAt).getTime()}:undefined;
      const giftEvent=event.type==="GIFT_COMPLETED"&&user&&result.entitlement?{id:result.entitlement.giftEventId,sessionId:event.sessionId,userId:user.id,giftId:event.giftId,giftName:event.giftName,quantity:event.quantity,productId:result.entitlement.productId,finalizedAt:new Date(event.occurredAt).getTime()}:undefined;
      const likeTotal=event.type==="LIKE"&&user&&result.likeTotal!==undefined?{sessionId:event.sessionId,userId:user.id,platformUserId:event.user.platformUserId,quantity:result.likeTotal}:undefined;
      const freeGrant=result.freeGrant&&result.created?{...result.freeGrant,requestId:result.created.id}:undefined;
      const outboxId=result.created?crypto.randomUUID():undefined;
      const committed=await durability.ingestAtomically({
        event,
        source:config.EVENT_SOURCE,
        ...(user?{user:toDurableUser(user)}:{}),
        ...(comment?{comment}:{}),
        ...(giftEvent?{giftEvent}:{}),
        ...(likeTotal?{likeTotal}:{}),
        ...(freeGrant?{freeGrant}:{}),
        ...(result.entitlement?{entitlement:toDurableEntitlement(result.entitlement)}:{}),
        ...(result.created&&outboxId?{request:toDurableRequest(result.created),outbox:{id:outboxId,topic:"reading.requested",aggregateId:result.created.id,payload:{requestId:result.created.id}}}:{}),
      });
      if(!committed)continue;
      broadcastIntakeFeedback(event,result);
      if(result.created&&outboxId) {
        try { await dispatchReading(result.created.id,outboxId); }
        catch(error) { app.log.error({error:String(error),eventId:event.id,requestId:result.created.id},"immediate reading dispatch failed; durable outbox will retry"); }
      }
      if(event.type==="CONNECTED")app.log.info({sessionId:event.sessionId},"event source connected");
    } catch(error) {
      app.log.warn({error:String(error),eventId:event.id},"event rejected without stopping ingestion");
    }
  }
}
app.addHook("onClose",async()=>{clearPlaybackWatchdog();clearLeaseRenewal();clearCtaSchedule();clearTarotFocusSchedule();clearInteractionSpeechWatchdog();await releasePlaybackLease();if(playbackLease) await playbackLease.close();if(readingQueue)await readingQueue.close();await durability.close();});
await recoverFromPersistence();
await prepareCtaAssets();
await prepareTarotFocusAssets();
if(source instanceof TikfinityEventSource) { const session=store.createSession(config.DEFAULT_LOCALE,source.sessionId); await durability.createSession({id:session.id,accountKey:session.accountKey,locale:session.locale}); }
await source.connect();
await app.listen({host:"127.0.0.1",port:3001});
startCtaSchedule();
startTarotFocusSchedule();
consume().catch((error)=>app.log.error(error,"event consumer stopped"));
setInterval(async()=>{
  if(store.currentRequestId)return;
  if(pendingGiftInteractions.length>0) {
    void drainGiftInteractionQueue();
    if(pendingGiftInteractions.length>0||interactionSpeechBusy)return;
  }
  if(pendingCommentInteractions.length>0) {
    void drainCommentInteractionQueue();
    if(pendingCommentInteractions.length>0||interactionSpeechBusy)return;
  }
  if(interactionSpeechBusy)return;
  try {
    const next=engine.next();
    if(!next)return;
    const started=await startPlayback(next);
    if(!started)return;
  } catch(error) {
    app.log.error(error,"playback start failed");
  }
},1000);
setInterval(()=>{void (async()=>{for(const entitlement of store.expireAwaitingQuestions()) await durability.saveEntitlement(toDurableEntitlement(entitlement));})().catch((error)=>app.log.error(error,"awaiting-question reconciliation failed"));},30_000);
app.log.info({port:3001},"tarot live engine ready");

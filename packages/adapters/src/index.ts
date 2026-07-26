import crypto from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import path from "node:path";
import { interactionOutputSchema, liveEventSchema, readingOutputSchema, type InteractionOutput, type LiveEvent, type ReadingOutput, type ModerationResult } from "@tarot/contracts";
import { buildSafeFallback, premoderate } from "@tarot/domain";
import { cardName } from "@tarot/tarot";
import WebSocket, { type RawData } from "ws";

const execFileAsync = promisify(execFile);

export interface LiveEventSource { connect(): Promise<void>; disconnect(): Promise<void>; events(): AsyncIterable<LiveEvent>; }
export interface ReadingGenerator { generate(input: { locale:string; question:string; cards:Array<{id:string; orientation:string; meaning:string}>; maxWords:number }): Promise<ReadingOutput>; }
export interface InteractionGenerator { generate(input:{locale:string;viewerName:string;comment:string;maxWords:number}):Promise<InteractionOutput>; }
export type SpeechFormat = "wav" | "mp3";
export interface SpeechProvider { synthesize(input: { locale:string; voice:string; text:string }): Promise<{contentHash:string; localPath:string; durationMs:number; format:SpeechFormat}>; }
export interface SafetyModerator { moderate(input: {question:string}): Promise<ModerationResult>; }

export class SimulatorEventSource implements LiveEventSource {
  private queue: LiveEvent[] = []; private waiter: ((result: IteratorResult<LiveEvent>) => void) | undefined; private closed = false;
  constructor(private readonly seed: LiveEvent[] = []) { this.queue = [...seed]; }
  push(event: LiveEvent): void { if (this.waiter) { const waiter = this.waiter; this.waiter = undefined; waiter({value:event, done:false}); } else this.queue.push(event); }
  async connect(): Promise<void> { this.closed = false; }
  async disconnect(): Promise<void> { this.closed = true; this.waiter?.({value:undefined as never, done:true}); this.waiter = undefined; }
  async *events(): AsyncIterable<LiveEvent> { while (!this.closed) { if (this.queue.length) { yield this.queue.shift()!; continue; } const next = await new Promise<IteratorResult<LiveEvent>>((resolve) => { this.waiter = resolve; }); if (next.done) return; yield next.value; } }
}
type JsonRecord = Record<string, unknown>;
export type TikfinitySocket = { once(event: "open" | "error" | "close", listener: () => void): TikfinitySocket; on(event: "message", listener: (data: RawData) => void): TikfinitySocket; close(): void };
export type TikfinityPayloadDiagnostic = {
  receivedAt: string;
  payload: unknown;
  normalized: boolean;
  eventTypes: LiveEvent["type"][];
  ignoredControl?: boolean;
  error?: string;
};
export type TikfinityEventSourceOptions = {
  sessionId?: string;
  reconnectMinMs?: number;
  reconnectMaxMs?: number;
  onRawPayload?: (payload: unknown) => void;
  onPayloadDiagnostic?: (diagnostic: TikfinityPayloadDiagnostic) => void;
  now?: () => Date;
  webSocketFactory?: (url: string) => TikfinitySocket;
};

function record(value: unknown): JsonRecord | undefined { return typeof value === "object" && value !== null && !Array.isArray(value) ? value as JsonRecord : undefined; }
function candidates(payload: unknown): JsonRecord[] { const root = record(payload); if (!root) return []; return [root, ...["data", "payload", "event", "body"].map((key) => record(root[key])).filter((value): value is JsonRecord => Boolean(value))]; }
function firstValue(objects: JsonRecord[], keys: string[]): unknown { for (const object of objects) for (const key of keys) if (object[key] !== undefined && object[key] !== null) return object[key]; return undefined; }
function textValue(value: unknown): string | undefined { return typeof value === "string" && value.trim() ? value.trim() : typeof value === "number" ? String(value) : undefined; }
function numberValue(value: unknown): number | undefined { const number = typeof value === "number" ? value : typeof value === "string" && value.trim() ? Number(value) : undefined; return number !== undefined && Number.isFinite(number) ? number : undefined; }
function booleanValue(value: unknown): boolean | undefined { if (typeof value === "boolean") return value; if (typeof value === "number") return value !== 0; if (typeof value === "string") { const normalized = value.trim().toLowerCase(); if (["true", "1", "yes"].includes(normalized)) return true; if (["false", "0", "no"].includes(normalized)) return false; } return undefined; }
function isoTimestamp(value: unknown, now: Date): string { const number = numberValue(value); if (number !== undefined) { const milliseconds = number < 1_000_000_000_000 ? number * 1000 : number; const date = new Date(milliseconds); if (!Number.isNaN(date.getTime())) return date.toISOString(); } if (typeof value === "string" && !Number.isNaN(Date.parse(value))) return new Date(value).toISOString(); return now.toISOString(); }
function normalizedType(value: unknown): string { return (textValue(value) ?? "").toLowerCase().replace(/[^a-z]/g, ""); }
function isTikfinityControlPayload(payload:unknown):boolean {
  const objects=candidates(payload);
  const type=normalizedType(firstValue(objects,["type","eventType","event","name","action","command"]));
  // TikFinity emits these informational packets alongside actionable LIVE events.
  // A roomUser packet without a count is only a presence/control packet, and share
  // currently has no domain event. Recording either as a rejected payload makes a
  // healthy stream look broken in diagnostics.
  return type==="config"||type==="livestatuschange"||type==="share"||
    (type==="roomuser"&&numberValue(firstValue(objects,["viewerCount","viewer_count","viewers","count"]))===undefined);
}

export function normalizeTikfinityPayload(payload: unknown, defaultSessionId: string, now = new Date()): LiveEvent | undefined {
  const objects = candidates(payload);
  if (!objects.length) return undefined;
  const type = normalizedType(firstValue(objects, ["type", "eventType", "event", "name", "action", "command"]));
  const sessionId = textValue(firstValue(objects, ["sessionId", "session_id", "roomId", "room_id", "liveId", "live_id"])) ?? defaultSessionId;
  const id = textValue(firstValue(objects, ["id", "eventId", "event_id", "uuid", "activityId"])) ?? `tikfinity-${crypto.createHash("sha256").update(JSON.stringify(payload)).digest("hex")}`;
  const occurredAt = isoTimestamp(firstValue(objects, ["occurredAt", "occurred_at", "timestamp", "createdAt", "time"]), now);
  const userRecord = record(firstValue(objects, ["user", "userInfo", "user_info", "userIdentity", "author", "sender", "from"]));
  const userObjects = userRecord ? [userRecord, ...objects] : objects;
  const userId = textValue(firstValue(userObjects, ["platformUserId", "platform_user_id", "userId", "user_id", "uid", "uniqueId", "unique_id", "id"]));
  const user = userId ? { platformUserId: userId, username: textValue(firstValue(userObjects, ["username", "uniqueId", "unique_id", "handle"])) ?? userId, displayName: textValue(firstValue(userObjects, ["displayName", "display_name", "nickname", "name"])) ?? userId } : undefined;
  const common = { id, sessionId, occurredAt, raw: payload };
  if (type.includes("connected") || type === "connectionopen" || type === "connect") return liveEventSchema.parse({ ...common, type: "CONNECTED" });
  if (type.includes("disconnected") || type === "connectionclose" || type === "disconnect") return liveEventSchema.parse({ ...common, type: "DISCONNECTED" });
  if (type.includes("comment") || type.includes("chat") || type.includes("message")) { const text = textValue(firstValue(objects, ["text", "comment", "message", "content", "body"])); return user && text ? liveEventSchema.parse({ ...common, type: "COMMENT", user, text }) : undefined; }
  if (type.includes("follow")) return user ? liveEventSchema.parse({ ...common, type: "FOLLOW", user }) : undefined;
  if (type === "member" || type.includes("join") || type.includes("enter")) return user ? liveEventSchema.parse({ ...common, type: "JOIN", user }) : undefined;
  if (type === "roomuser" || type === "roomstats") { const viewerCount=numberValue(firstValue(objects,["viewerCount","viewer_count","viewers","count"])); return viewerCount!==undefined&&viewerCount>=0?liveEventSchema.parse({...common,type:"ROOM_STATS",viewerCount:Math.floor(viewerCount)}):undefined; }
  if (type.includes("like") || type.includes("heart")) { const quantity = numberValue(firstValue(objects, ["quantity", "count", "likes", "likeCount", "like_count"])) ?? 1; return user && quantity > 0 ? liveEventSchema.parse({ ...common, type: "LIKE", user, quantity: Math.floor(quantity) }) : undefined; }
  if (type.includes("gift") || type.includes("rose") || type.includes("diamond")) { const giftRecord = record(firstValue(objects, ["gift", "giftInfo", "gift_info"])); const giftId = textValue(giftRecord && firstValue([giftRecord], ["giftId", "gift_id", "id", "code"])) ?? textValue(firstValue(objects, ["giftId", "gift_id", "giftCode", "gift_code"])); const giftName = textValue(giftRecord && firstValue([giftRecord], ["giftName", "gift_name", "name"])) ?? textValue(firstValue(objects, ["giftName", "gift_name", "name"])) ?? giftId; const quantity = numberValue(giftRecord && firstValue([giftRecord], ["quantity", "count", "repeatCount", "repeat_count"])) ?? numberValue(firstValue(objects, ["quantity", "count", "repeatCount", "repeat_count"])) ?? 1; const coins = numberValue(giftRecord && firstValue([giftRecord], ["coins", "coin", "coinCount", "coin_count", "diamondCount", "diamond_count"])) ?? numberValue(firstValue(objects, ["coins", "coin", "coinCount", "coin_count", "diamondCount", "diamond_count"])); const repeatEnd = booleanValue(giftRecord && firstValue([giftRecord], ["repeatEnd", "repeat_end"])) ?? booleanValue(firstValue(objects, ["repeatEnd", "repeat_end"])); const giftType=numberValue(giftRecord&&firstValue([giftRecord],["giftType","gift_type"]))??numberValue(firstValue(objects,["giftType","gift_type"])); if (!user || !giftId || !giftName || quantity <= 0) return undefined; const progress = giftType!==undefined&&giftType!==1?false:repeatEnd !== undefined ? !repeatEnd : type.includes("progress") || type.includes("streak") || type.includes("repeat"); return liveEventSchema.parse({ ...common, type: progress ? "GIFT_PROGRESS" : "GIFT_COMPLETED", user, giftId, giftName, quantity: Math.floor(quantity), ...(coins !== undefined ? { coins } : {}) }); }
  return undefined;
}

export class TikfinityEventSource extends SimulatorEventSource {
  public readonly sessionId: string;
  private connected = false;
  private socket: TikfinitySocket | undefined;
  private reconnectTimer: NodeJS.Timeout | undefined;
  private reconnectAttempt = 0;
  private stopped = true;
  constructor(public readonly wsUrl: string, sessionId:string = crypto.randomUUID(), private readonly options: TikfinityEventSourceOptions = {}) { super(); this.sessionId = sessionId; }
  async connect(): Promise<void> { await super.connect(); this.stopped = false; this.openSocket(); }
  async disconnect(): Promise<void> { this.stopped = true; this.connected=false; if (this.reconnectTimer) clearTimeout(this.reconnectTimer); this.reconnectTimer = undefined; const socket = this.socket; this.socket = undefined; socket?.close(); await super.disconnect(); }
  isConnected():boolean { return this.connected; }
  private openSocket(): void { if (this.stopped || this.socket) return; const factory = this.options.webSocketFactory ?? ((url: string) => new WebSocket(url) as unknown as TikfinitySocket); const socket = factory(this.wsUrl); this.socket = socket; socket.once("open", () => { this.connected=true; this.reconnectAttempt = 0; this.push({ id: crypto.randomUUID(), sessionId: this.sessionId, occurredAt: (this.options.now?.() ?? new Date()).toISOString(), type: "CONNECTED" }); }); socket.on("message", (data: RawData) => this.handleRaw(data)); socket.once("error", () => { socket.close(); }); socket.once("close", () => { this.connected=false; if (this.socket === socket) this.socket = undefined; if (!this.stopped) { this.push({ id: crypto.randomUUID(), sessionId: this.sessionId, occurredAt: (this.options.now?.() ?? new Date()).toISOString(), type: "DISCONNECTED" }); this.scheduleReconnect(); } }); }
  private scheduleReconnect(): void { if (this.stopped || this.reconnectTimer) return; const min = this.options.reconnectMinMs ?? 500; const max = this.options.reconnectMaxMs ?? 10_000; const delay = Math.min(max, min * 2 ** this.reconnectAttempt) + Math.floor(Math.random() * min); this.reconnectAttempt += 1; this.reconnectTimer = setTimeout(() => { this.reconnectTimer = undefined; this.openSocket(); }, delay); }
  private normalizeAndRecord(payload: unknown): void {
    this.options.onRawPayload?.(payload);
    const now = this.options.now?.() ?? new Date();
    const eventTypes: LiveEvent["type"][] = [];
    let error: string | undefined;
    let ignoredControl=false;
    for (const item of Array.isArray(payload) ? payload : [payload]) {
      try {
        const event = normalizeTikfinityPayload(item, this.sessionId, now);
        if (event) {
          eventTypes.push(event.type);
          this.push(event);
        } else if(isTikfinityControlPayload(item))ignoredControl=true;
      } catch (cause) {
        error = cause instanceof Error ? cause.message : String(cause);
      }
    }
    this.options.onPayloadDiagnostic?.({
      receivedAt: now.toISOString(),
      payload,
      normalized: eventTypes.length > 0||ignoredControl,
      eventTypes,
      ...(ignoredControl?{ignoredControl:true}:{}),
      ...(error ? { error } : {}),
    });
  }
  private handleRaw(data: RawData): void {
    let payload: unknown;
    try {
      payload = JSON.parse(data.toString());
    } catch {
      this.options.onPayloadDiagnostic?.({
        receivedAt: (this.options.now?.() ?? new Date()).toISOString(),
        payload: data.toString(),
        normalized: false,
        eventTypes: [],
        error: "invalid_json",
      });
      return;
    }
    this.normalizeAndRecord(payload);
  }
  recordRawEvent(payload: unknown): void { this.normalizeAndRecord(payload); }
}

export class MockModerator implements SafetyModerator { async moderate(input: {question:string}): Promise<ModerationResult> { return premoderate(input.question); } }
export class DeterministicReadingGenerator implements ReadingGenerator { async generate(input: { locale:string; question:string; cards:Array<{id:string; orientation:string; meaning:string}>; maxWords:number }): Promise<ReadingOutput> { const cards = input.cards.map((card) => ({cardId: card.id, interpretation: `${cardName(card.id, input.locale)} sugiere ${card.meaning}; úsalo como una invitación a observar, no como una certeza.`})); const opening = "Gracias por compartir tu pregunta."; const summary = "La lectura apunta a una oportunidad de elegir con calma y cuidar tus límites."; const closing = "Lectura para entretenimiento y reflexión personal. Quédate con lo que te ayude y decide desde tu propio criterio."; const spokenText = `${opening} ${cards.map((card) => card.interpretation).join(" ")} ${summary} ${closing}`.split(/\s+/).slice(0, input.maxWords).join(" "); return {safe:true, category:"general", opening, cards, summary, closing, spokenText, safetyFlags:[]}; } }
export class MockReadingGenerator extends DeterministicReadingGenerator {}

export class DeterministicInteractionGenerator implements InteractionGenerator {
  async generate(input:{locale:string;viewerName:string;comment:string;maxWords:number}):Promise<InteractionOutput> {
    const focus=input.comment.split(/\s+/).slice(0,8).join(" ");
    const variants:Array<{text:string;tone:InteractionOutput["tone"]}>=[
      {text:`${input.viewerName}, te escucho con “${focus}”. Gracias por traer esa intención al LIVE.`,tone:"warm"},
      {text:`${input.viewerName}, lo que dices sobre “${focus}” abre una buena pregunta para mirar con calma.`,tone:"curious"},
      {text:`${input.viewerName}, recibí tu mensaje sobre “${focus}”. Vamos a mantener esa idea presente.`,tone:"grateful"},
      {text:`${input.viewerName}, gracias por poner en palabras “${focus}”. Esa reflexión ya forma parte de la conversación.`,tone:"reflective"},
      {text:`${input.viewerName}, noto la intención detrás de “${focus}”. Tómate un momento y observa qué te resuena.`,tone:"reflective"},
      {text:`${input.viewerName}, tu comentario sobre “${focus}” llegó a Mora. Gracias por participar de verdad.`,tone:"grateful"},
      {text:`${input.viewerName}, “${focus}” merece una mirada tranquila. Gracias por compartirlo en vivo.`,tone:"warm"},
      {text:`${input.viewerName}, me quedo con esa parte: “${focus}”. Vamos a explorarla sin apresurar conclusiones.`,tone:"curious"}
    ];
    const digest=crypto.createHash("sha256").update(`${input.viewerName}:${input.comment}`).digest();
    const variant=variants[digest[0]!%variants.length]!;
    return {safe:true,spokenText:variant.text.split(/\s+/).slice(0,input.maxWords).join(" "),tone:variant.tone};
  }
}

export type GeminiReadingHooks={beforeRequest?:()=>void;onAttempt?:()=>void;onSuccess?:()=>void;onFailure?:(error:unknown)=>void};
export class GeminiReadingGenerator implements ReadingGenerator {
  constructor(private readonly apiKey:string,private readonly model:string,private readonly request:typeof fetch=fetch,private readonly hooks:GeminiReadingHooks={}) {}
  async generate(input:{locale:string;question:string;cards:Array<{id:string;orientation:string;meaning:string}>;maxWords:number}):Promise<ReadingOutput> {
    this.hooks.beforeRequest?.();
    this.hooks.onAttempt?.();
    try {
      const response=await this.request(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(this.model)}:generateContent`,{method:"POST",headers:{"x-goog-api-key":this.apiKey,"content-type":"application/json"},body:JSON.stringify({systemInstruction:{parts:[{text:`Escribe únicamente una lectura de tarot segura en ${input.locale}, para entretenimiento y reflexión personal. Devuelve exclusivamente un objeto JSON con las claves safe, category, opening, cards, summary, closing, spokenText y safetyFlags. Cada elemento de cards debe tener cardId e interpretation. No hagas predicciones ciertas, diagnósticos, consejos médicos, legales o financieros, ni afirmaciones de hechos personales que no estén en la pregunta. Interpreta solamente las cartas proporcionadas, incluye cada cardId exactamente una vez y no excedas ${input.maxWords} palabras en spokenText. El cierre y spokenText deben conservar el aviso de entretenimiento o reflexión.`}]},contents:[{role:"user",parts:[{text:JSON.stringify({question:input.question,cards:input.cards})}]}],generationConfig:{responseMimeType:"application/json"}})});
      const responseText=typeof response.text==="function"?await response.text():JSON.stringify(await response.json());
      if(!response.ok) throw new Error(`Gemini reading request failed (${response.status})${responseText?`: ${responseText.slice(0,800)}`:""}`);
      const body=JSON.parse(responseText) as {candidates?:Array<{content?:{parts?:Array<{text?:string}>}}>};
      const content=body.candidates?.[0]?.content?.parts?.map((part)=>part.text??"").join("").trim();
      if(!content) throw new Error("Gemini reading response was empty");
      const output=readingOutputSchema.parse(JSON.parse(content));
      this.hooks.onSuccess?.();
      return output;
    } catch(error) {
      this.hooks.onFailure?.(error);
      throw error;
    }
  }
}
export class GeminiInteractionGenerator implements InteractionGenerator {
  constructor(private readonly apiKey:string,private readonly model:string,private readonly request:typeof fetch=fetch,private readonly hooks:GeminiReadingHooks={}) {}
  async generate(input:{locale:string;viewerName:string;comment:string;maxWords:number}):Promise<InteractionOutput> {
    this.hooks.beforeRequest?.();
    this.hooks.onAttempt?.();
    try {
      const response=await this.request(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(this.model)}:generateContent`,{method:"POST",headers:{"x-goog-api-key":this.apiKey,"content-type":"application/json"},body:JSON.stringify({systemInstruction:{parts:[{text:`Responde como Mora, una mascota virtual de tarot en un LIVE. Escribe una reacción breve, cálida y claramente conectada con el comentario real del espectador. Máximo ${input.maxWords} palabras, en ${input.locale}. No pidas regalos, likes, follows ni compartidos. No prometas una lectura, no hagas predicciones, diagnósticos o afirmaciones sobrenaturales. No repitas el comentario completo. Devuelve solo JSON con safe=true, spokenText y tone; tone debe ser warm, curious, reflective o grateful.`}]},contents:[{role:"user",parts:[{text:JSON.stringify({viewerName:input.viewerName,comment:input.comment})}]}],generationConfig:{responseMimeType:"application/json"}})});
      const responseText=typeof response.text==="function"?await response.text():JSON.stringify(await response.json());
      if(!response.ok)throw new Error(`Gemini interaction request failed (${response.status})${responseText?`: ${responseText.slice(0,800)}`:""}`);
      const body=JSON.parse(responseText) as {candidates?:Array<{content?:{parts?:Array<{text?:string}>}}>};
      const content=body.candidates?.[0]?.content?.parts?.map((part)=>part.text??"").join("").trim();
      if(!content)throw new Error("Gemini interaction response was empty");
      const output=interactionOutputSchema.parse(JSON.parse(content));
      const wordCount=output.spokenText.trim().split(/\s+/).filter(Boolean).length;
      if(wordCount>input.maxWords)throw new Error("Gemini interaction exceeded the word limit");
      if(/\b(regal|gift|like|follow|sígueme|compart|garantiz|definitivamente|sin duda)\b/i.test(output.spokenText))throw new Error("Gemini interaction contained an engagement request or certainty");
      this.hooks.onSuccess?.();
      return output;
    } catch(error) {
      this.hooks.onFailure?.(error);
      throw error;
    }
  }
}
export class FallbackReadingGenerator implements ReadingGenerator {
  constructor(private readonly primary:ReadingGenerator,private readonly fallback:ReadingGenerator,private readonly primaryAttempts=2) {}
  async generate(input:{locale:string;question:string;cards:Array<{id:string;orientation:string;meaning:string}>;maxWords:number}):Promise<ReadingOutput> { let lastError:unknown; for(let attempt=0;attempt<this.primaryAttempts;attempt++) { try { const output=await this.primary.generate(input); validateProviderReading(input,output); return output; } catch(error) { lastError=error; } } void lastError; return this.fallback.generate(input); }
}
function validateProviderReading(input:{cards:Array<{id:string}>;maxWords:number},output:ReadingOutput):void { const ids=output.cards.map((card)=>card.cardId); if(!output.safe||ids.length!==input.cards.length||new Set(ids).size!==ids.length||input.cards.some((card)=>!ids.includes(card.id))) throw new Error("Reading provider omitted or duplicated selected cards"); if(output.spokenText.trim().split(/\s+/).length>input.maxWords) throw new Error("Reading provider exceeded the word limit"); if(/\b(definitivamente|sin duda|garantiz|va a ocurrir|sé que tú|sé que él|sé que ella)\b/i.test(output.spokenText)) throw new Error("Reading provider returned certainty or unsupported facts"); if(!/\b(entretenimiento|reflexión)\b/i.test(`${output.closing} ${output.spokenText}`)) throw new Error("Reading provider omitted the permanent disclaimer"); }
export type ReadingGeneratorOptions={provider:"deterministic"|"mock"|"gemini";apiKey?:string;model:"gemini-3.5-flash-lite";hooks?:GeminiReadingHooks};
export function createReadingGenerator(options:ReadingGeneratorOptions):ReadingGenerator { if(options.provider==="gemini") { if(!options.apiKey) throw new Error("LLM_PROVIDER=gemini requires GEMINI_API_KEY"); return new GeminiReadingGenerator(options.apiKey,options.model,fetch,options.hooks); } return new DeterministicReadingGenerator(); }
export function createInteractionGenerator(options:ReadingGeneratorOptions):InteractionGenerator { if(options.provider==="gemini") { if(!options.apiKey) throw new Error("LLM_PROVIDER=gemini requires GEMINI_API_KEY"); return new GeminiInteractionGenerator(options.apiKey,options.model,fetch,options.hooks); } return new DeterministicInteractionGenerator(); }
function wavSilence(durationMs:number): Buffer { const sampleRate = 8_000; const channels = 1; const bitsPerSample = 16; const dataSize = Math.max(1, Math.ceil(sampleRate * durationMs / 1_000) * channels * bitsPerSample / 8); const buffer = Buffer.alloc(44 + dataSize); buffer.write("RIFF", 0, "ascii"); buffer.writeUInt32LE(36 + dataSize, 4); buffer.write("WAVE", 8, "ascii"); buffer.write("fmt ", 12, "ascii"); buffer.writeUInt32LE(16, 16); buffer.writeUInt16LE(1, 20); buffer.writeUInt16LE(channels, 22); buffer.writeUInt32LE(sampleRate, 24); buffer.writeUInt32LE(sampleRate * channels * bitsPerSample / 8, 28); buffer.writeUInt16LE(channels * bitsPerSample / 8, 32); buffer.writeUInt16LE(bitsPerSample, 34); buffer.write("data", 36, "ascii"); buffer.writeUInt32LE(dataSize, 40); return buffer; }
async function synthesizeWindowsWave(filePath:string, text:string): Promise<boolean> { if (process.platform !== "win32") return false; const encodedText = Buffer.from(text, "utf16le").toString("base64"); const escapedPath = filePath.replace(/'/g, "''"); const script = `$text=[Text.Encoding]::Unicode.GetString([Convert]::FromBase64String('${encodedText}'));Add-Type -AssemblyName System.Speech;$s=New-Object System.Speech.Synthesis.SpeechSynthesizer;try{$s.SelectVoiceByHints([System.Speech.Synthesis.VoiceGender]::NotSet,[System.Speech.Synthesis.VoiceAge]::NotSet,0,[Globalization.CultureInfo]::GetCultureInfo('es-MX'))}catch{};$s.SetOutputToWaveFile('${escapedPath}');$s.Speak($text);$s.Dispose()`; try { await execFileAsync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", script], { windowsHide: true }); return true; } catch { return false; } }
function wavDurationMs(audio:Buffer):number { if(audio.length<44||audio.subarray(0,4).toString("ascii")!=="RIFF"||audio.subarray(8,12).toString("ascii")!=="WAVE") throw new Error("Invalid WAV audio"); const byteRate=audio.readUInt32LE(28); const dataSize=audio.readUInt32LE(40); if(byteRate<=0) throw new Error("Invalid WAV byte rate"); return Math.max(1,Math.round(dataSize*1000/byteRate)); }
export class LocalSpeechProvider implements SpeechProvider { constructor(private readonly audioDir: string, private readonly useSystemTts = true) {} async synthesize(input: {locale:string; voice:string; text:string}): Promise<{contentHash:string; localPath:string; durationMs:number; format:SpeechFormat}> { const contentHash = crypto.createHash("sha256").update(`${input.locale}:${input.voice}:${input.text}`).digest("hex"); const estimatedDurationMs = Math.max(2500, input.text.split(/\s+/).length * 350); await mkdir(this.audioDir, { recursive: true }); const localPath = path.join(this.audioDir, `${contentHash}.wav`); try { const cached=await readFile(localPath); return {contentHash,localPath,durationMs:wavDurationMs(cached),format:"wav"}; } catch { /* cache miss or invalid partial file */ } let generated = false; if (this.useSystemTts) generated = await synthesizeWindowsWave(localPath, input.text); if (!generated) await writeFile(localPath, wavSilence(estimatedDurationMs)); const audio=await readFile(localPath); return {contentHash, localPath, durationMs:wavDurationMs(audio), format:"wav"}; } }

function escapeXml(value:string): string { return value.replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;").replace(/'/g,"&apos;"); }
function estimateAzureMp3DurationMs(audio:Buffer): number { const id3Size = audio.length >= 10 && audio.subarray(0, 3).toString("ascii") === "ID3" ? 10 + ((audio[6]! & 0x7f) * 0x200000 + (audio[7]! & 0x7f) * 0x4000 + (audio[8]! & 0x7f) * 0x80 + (audio[9]! & 0x7f)) : 0; const payloadBytes = Math.max(1, audio.length - Math.min(id3Size, audio.length)); return Math.max(2500, Math.round(payloadBytes * 8 * 1000 / 48_000)); }
export class AzureSpeechProvider implements SpeechProvider { constructor(private readonly audioDir:string, private readonly apiKey:string, private readonly region:string, private readonly defaultVoice="es-MX-DaliaNeural", private readonly request:typeof fetch=fetch) {} async synthesize(input:{locale:string;voice:string;text:string}):Promise<{contentHash:string;localPath:string;durationMs:number;format:SpeechFormat}> { const voice=input.voice && input.voice !== "es-MX-demo" ? input.voice : this.defaultVoice; const contentHash=crypto.createHash("sha256").update(`azure:${input.locale}:${voice}:${input.text}`).digest("hex"); await mkdir(this.audioDir,{recursive:true}); const localPath=path.join(this.audioDir,`${contentHash}.mp3`); try { const cachedAudio=await readFile(localPath); return {contentHash,localPath,durationMs:estimateAzureMp3DurationMs(cachedAudio),format:"mp3"}; } catch { /* cache miss */ } const ssml=`<speak version="1.0" xml:lang="${escapeXml(input.locale)}" xmlns="http://www.w3.org/2001/10/synthesis"><voice name="${escapeXml(voice)}">${escapeXml(input.text)}</voice></speak>`; const response=await this.request(`https://${this.region}.tts.speech.microsoft.com/cognitiveservices/v1`,{method:"POST",headers:{"Ocp-Apim-Subscription-Key":this.apiKey,"Content-Type":"application/ssml+xml","X-Microsoft-OutputFormat":"audio-24khz-48kbitrate-mono-mp3","User-Agent":"tarot-live-engine"},body:ssml}); if(!response.ok) throw new Error(`Azure Speech request failed (${response.status})`); const audio=Buffer.from(await response.arrayBuffer()); if(audio.length<100) throw new Error("Azure Speech returned an empty audio asset"); await writeFile(localPath,audio); return {contentHash,localPath,durationMs:estimateAzureMp3DurationMs(audio),format:"mp3"}; } }
export class FallbackSpeechProvider implements SpeechProvider { constructor(private readonly primary:SpeechProvider,private readonly fallback:SpeechProvider,private readonly primaryAttempts=2) {} async synthesize(input:{locale:string;voice:string;text:string}):Promise<{contentHash:string;localPath:string;durationMs:number;format:SpeechFormat}> { for(let attempt=0;attempt<this.primaryAttempts;attempt++) { try { return await this.primary.synthesize(input); } catch { /* retry, then use the local Windows provider */ } } return this.fallback.synthesize(input); } }
export type SpeechProviderOptions = { provider:"local"|"azure"; audioDir:string; apiKey?:string; region?:string; voice:string };
export function createSpeechProvider(options:SpeechProviderOptions):SpeechProvider { const local = new LocalSpeechProvider(options.audioDir); if(options.provider==="azure") { if(!options.apiKey||!options.region) throw new Error("TTS_PROVIDER=azure requires TTS_API_KEY and TTS_REGION"); return new FallbackSpeechProvider(new AzureSpeechProvider(options.audioDir,options.apiKey,options.region,options.voice), local,2); } return local; }

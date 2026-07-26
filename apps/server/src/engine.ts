import crypto from "node:crypto";
import { MockModerator, DeterministicReadingGenerator, LocalSpeechProvider, type ReadingGenerator, type SafetyModerator, type SpeechProvider } from "@tarot/adapters";
import type { PlaybackTimeline, ReadingOutput } from "@tarot/contracts";
import { selectCards } from "@tarot/tarot";
import { MemoryStore, type Request } from "./store.js";

/** Keeps public display names useful for a spoken thank-you without letting a
 * username inject punctuation, a sentence, or an overly long phrase into TTS. */
export function safeViewerNameForSpeech(displayName:string):string|undefined {
  const normalized=displayName.normalize("NFKD").replace(/[\u0300-\u036f]/g,"").replace(/[^\p{L}\p{N}\s]/gu," ").trim().replace(/\s+/g," ");
  const words=normalized.split(" ").filter(Boolean).slice(0,2);
  const candidate=words.join(" ");
  return candidate.length>=2&&candidate.length<=24?candidate:undefined;
}

export class ReadingEngine {
  private running = false;
  private activeCommandId?: string;
  private activePlaybackAttemptId?: string;

  constructor(private readonly store: MemoryStore, private readonly secret = "local-development-secret", audioDir = "./data/audio", private readonly speech: SpeechProvider = new LocalSpeechProvider(audioDir), private readonly generator:ReadingGenerator=new DeterministicReadingGenerator(), private readonly moderator:SafetyModerator=new MockModerator()) {}

  async process(requestId: string): Promise<Request> {
    const request = this.store.requests.get(requestId)!;
    if (!["RECEIVED", "FAILED_RETRYABLE", "MODERATION"].includes(request.status)) return request;
    try {
      if (request.status !== "MODERATION") this.store.transitionRequest(request.id, "MODERATION");
      const moderation = await this.moderator.moderate({ question: request.question ?? "" });
      if (moderation.action === "REQUEST_NEW_QUESTION") {
        if(request.source==="free") {
          request.safeQuestion="¿Qué energía puedo observar y cómo puedo cuidarme hoy?";
        } else {
          this.store.transitionRequest(request.id, "MANUAL_REVIEW", moderation);
          if (request.entitlementId) this.store.transitionEntitlement(request.entitlementId, "AWAITING_QUESTION", moderation);
          return request;
        }
      } else if (moderation.action === "MANUAL_REVIEW") {
        this.store.transitionRequest(request.id, "MANUAL_REVIEW", moderation);
        if (request.entitlementId) this.store.transitionEntitlement(request.entitlementId, "MANUAL_REVIEW", moderation);
        return request;
      }
      if (moderation.action === "REFRAME") request.safeQuestion = moderation.safeQuestion;
      else if (moderation.action === "ALLOW" && request.question) request.safeQuestion = request.question;
      this.store.transitionRequest(request.id, "CARD_SELECTION");
      const product = request.entitlementId
        ? [...this.store.products.values()].find((p) => p.id === this.store.entitlements.get(request.entitlementId!)?.productId)
        : undefined;
      const selected = selectCards(request.sessionId, request.id, product?.cards ?? 1, this.secret);
      request.cards = selected.cards;
      request.seedHash = selected.seedHash;
      this.store.transitionRequest(request.id, "GENERATING_TEXT");
      const productMaxWords=product?.maxWords ?? 80;
      const spokenName=safeViewerNameForSpeech(request.displayName);
      const paidThankYou=request.source==="paid" ? (spokenName?`Gracias, ${spokenName}, por tu regalo.`:"Gracias por tu regalo.") : undefined;
      const paidThankYouWords=paidThankYou?.split(/\s+/).length ?? 0;
      // Reserve room before generation so the personalized spoken thank-you cannot
      // push a paid tier over its advertised word cap.
      const generationInput={ locale: this.store.sessions.get(request.sessionId)?.locale ?? "es-MX", question: request.safeQuestion ?? "", cards: selected.cards, maxWords: Math.max(20,productMaxWords-paidThankYouWords) };
      let reading = await this.generator.generate(generationInput);
      this.validateReading(reading,selected.cards.map((card)=>card.id),generationInput.maxWords);
      if(paidThankYou) reading={...reading,opening:`${paidThankYou} ${reading.opening}`.trim(),spokenText:`${paidThankYou} ${reading.spokenText}`.trim()};
      this.validateReading(reading,selected.cards.map((card)=>card.id),productMaxWords);
      request.reading = reading;
      this.store.transitionRequest(request.id, "VALIDATING_TEXT");
      this.store.transitionRequest(request.id, "GENERATING_AUDIO");
      const audio = await this.speech.synthesize({ locale: generationInput.locale, voice: "es-MX-DaliaNeural", text: reading.spokenText });
      request.audio = { url: `/audio/${audio.contentHash}.${audio.format}`, durationMs: audio.durationMs, contentHash:audio.contentHash, localPath:audio.localPath, format: audio.format };
      this.store.transitionRequest(request.id, "READY");
      if (request.entitlementId) this.store.transitionEntitlement(request.entitlementId, "QUEUED");
      this.store.actions.push({ at: Date.now(), action: "REQUEST_READY", requestId });
      return request;
    } catch (error) {
      if (request.status !== "MANUAL_REVIEW") {
        try { this.store.transitionRequest(request.id, "FAILED_RETRYABLE", { error: String(error) }); } catch { /* audit the original error without hiding it */ }
      }
      throw error;
    }
  }

  private validateReading(reading:ReadingOutput,selectedCardIds:string[],maxWords:number):void {
    const outputIds=reading.cards.map((card)=>card.cardId);
    if(!reading.safe||outputIds.length!==selectedCardIds.length||new Set(outputIds).size!==outputIds.length||selectedCardIds.some((id)=>!outputIds.includes(id))) throw new Error("Generated reading does not represent every selected card exactly once");
    if(reading.spokenText.trim().split(/\s+/).filter(Boolean).length>maxWords) throw new Error("Generated reading exceeds the product word limit");
    if(/\b(definitivamente|sin duda|garantiz|va a ocurrir|sé que tú|sé que él|sé que ella)\b/i.test(reading.spokenText)) throw new Error("Generated reading contains certainty or unsupported personal facts");
    if(!/\b(entretenimiento|reflexión)\b/i.test(`${reading.closing} ${reading.spokenText}`)) throw new Error("Generated reading is missing the entertainment/reflection disclaimer");
  }

  next(): Request | undefined { return this.running || this.store.pausedPlayback ? undefined : this.store.queue().find((request) => request.status === "READY"); }
  async playNext(): Promise<PlaybackTimeline | undefined> { const request = this.next(); if (!request) return undefined; return this.play(request); }
  async play(request: Request): Promise<PlaybackTimeline> { if(this.running||this.store.currentRequestId) throw new Error("Another reading is already playing"); if(request.status!=="READY") throw new Error("Only READY requests can play"); this.running = true; this.store.currentRequestId = request.id; if (request.entitlementId) { const entitlement = this.store.entitlements.get(request.entitlementId); if (entitlement?.status === "QUEUED") this.store.transitionEntitlement(entitlement.id, "FULFILLING"); else if(entitlement?.status!=="COMPLETED"||request.completedAt===undefined) { this.running=false; delete this.store.currentRequestId; throw new Error("Paid request entitlement is not QUEUED"); } } this.store.transitionRequest(request.id, "PLAYING"); const timeline = this.timeline(request); this.activeCommandId = timeline.commandId; this.activePlaybackAttemptId = crypto.randomUUID(); this.store.broadcast({ type: "PREPARE_READING", commandId: timeline.commandId, timeline }); this.store.broadcast({ type: "PLAY_READING", commandId: timeline.commandId, timeline }); this.store.actions.push({ at: Date.now(), action: "PLAYBACK_STARTED", requestId: request.id }); return timeline; }
  complete(requestId: string): void { const request = this.store.requests.get(requestId); if (!request || request.status !== "PLAYING") { if (this.store.currentRequestId === requestId) delete this.store.currentRequestId; delete this.activeCommandId; delete this.activePlaybackAttemptId; this.running = false; return; } this.store.transitionRequest(request.id, "COMPLETED"); if (request.entitlementId) { const entitlement=this.store.entitlements.get(request.entitlementId); if(entitlement?.status==="FULFILLING") this.store.transitionEntitlement(request.entitlementId, "COMPLETED"); } this.store.broadcast({ type: "RESET", requestId }); this.store.actions.push({ at: Date.now(), action: "PLAYBACK_COMPLETED", requestId }); delete this.store.currentRequestId; delete this.activeCommandId; delete this.activePlaybackAttemptId; this.running = false; }
  failPlayback(requestId: string, error: string): void { const request = this.store.requests.get(requestId); if (!request || request.status !== "PLAYING") return; this.store.transitionRequest(request.id, "FAILED_RETRYABLE", { error }); if (request.entitlementId) this.store.transitionEntitlement(request.entitlementId, "NEEDS_REPLACEMENT", { error }); delete this.store.currentRequestId; delete this.activeCommandId; delete this.activePlaybackAttemptId; this.running = false; }
  playbackAttempt(): { id: string; commandId: string; requestId: string } | undefined { const requestId = this.store.currentRequestId; if (!requestId || !this.activeCommandId || !this.activePlaybackAttemptId) return undefined; return { id: this.activePlaybackAttemptId, commandId: this.activeCommandId, requestId }; }
  timeline(request: Request): PlaybackTimeline { const cards = request.cards ?? []; return { commandId: crypto.randomUUID(), requestId: request.id, viewer: { displayName: request.displayName }, ...(request.safeQuestion ? { question: request.safeQuestion } : {}), audioUrl: request.audio?.url ?? "", durationMs: request.audio?.durationMs ?? 3000, cards: cards.map((card) => ({ id: card.id, orientation: card.orientation })), cues: [{ atMs: 0, type: "SHOW_VIEWER", payload: { displayName: request.displayName } }, { atMs: 800, type: "SHUFFLE" }, {atMs:2200,type:"DEAL"}, {atMs:2800,type:"AVATAR_STATE",payload:{state:"reading"}}, ...cards.map((card, index) => ({ atMs: 3200 + index * 2500, type: "REVEAL_CARD" as const, payload: { id: card.id, orientation: card.orientation } }))] }; }
}

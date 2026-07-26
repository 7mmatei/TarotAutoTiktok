import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { phaseCopy, pulseCopy, resolvePhaseMessage, resolveRendererLocale, type RendererLocale, type VisualPhase } from "./messages.js";
import { tarotArtworkUrl } from "./tarotAssets.js";
import "./styles.css";

export type CharacterState =
  | "idle" | "listening" | "thinking" | "shuffling" | "speaking" | "happy"
  | "surprised" | "grateful" | "mysterious" | "sleepy" | "error";

export type GiftEffect =
  | "golden-plumage" | "radiant-wings" | "heart-glow" | "luminous-feathers"
  | "card-orbit" | "constellation-markings" | "wing-embrace" | "grand-reveal";

type LegacyGiftEffect = "gold-crown" | "flower-bloom" | "silk-cape" | "ribbon-dance" | "sparkle-burst" | "symbol-storm" | "giant-glow";
type EyeMode = "neutral" | "focused" | "wide" | "squint" | "closed" | "sleepy" | "look-left" | "look-right" | "look-up" | "look-down" | "soft" | "heart" | "spiral";
type BeakMode = "closed" | "slightly-open" | "medium-open" | "wide-open" | "rounded" | "smile-like" | "concerned";
type DeckStage = "stacked" | "gathering" | "shuffling" | "finishing" | "squaring" | "flourish" | "dealing" | "dealt";
type CardOrientation = "upright" | "reversed";
export type PulseKind = "comment" | "like" | "follow" | "join" | "gift" | "share";
interface ViewerPulse { id: number; kind: PulseKind; name: string; detail: string }
interface MascotReaction { id: number; kind: PulseKind; durationMs: number }

export interface VisualController {
  setCharacterState(state: CharacterState): void;
  setViewer(name: string, question?: string): void;
  setStatus(text: string): void;
  setViewerCount(count: number): void;
  showInteraction(title: string, subtitle: string, state?: CharacterState, effect?: GiftEffect, durationMs?: number): void;
  showCards(count: 1 | 3 | 5 | 6 | 7): void;
  revealCard(index: number, cardId?: string, orientation?: CardOrientation): void;
  resetCards(): void;
  triggerGiftEffect(effect: GiftEffect | LegacyGiftEffect): void;
  pushViewerPulse(kind: PulseKind, name: string, detail?: string): void;
  setSpeaking(active: boolean, preserveVisualState?: boolean): void;
  setMouthLevel(level: number): void;
  resetScene(): void;
}

declare global { interface Window { visualController?: VisualController } }

const DESIGN_TOKENS = {
  background: "#100C24", backgroundSecondary: "#211640", plumDark: "#352042", plum: "#5A376D",
  plumLight: "#8B679E", cream: "#F3E4D1", peach: "#EFA98F", gold: "#DFBC67", amberGlow: "#F2C477",
  eyeDark: "#21152E", text: "#F7F1E7", textMuted: "#C6BDD8",
} as const;

const cardNames: Record<string, string> = { "the-fool": "El Loco", "the-magician": "El Mago", "the-star": "La Estrella", "the-hermit": "El Ermitaño", "wheel-of-fortune": "La Rueda", strength: "La Fuerza", justice: "La Justicia", "the-sun": "El Sol", "the-moon": "La Luna", "the-lovers": "Los Enamorados" };
const demoCards = ["the-star", "the-hermit", "strength", "the-sun", "the-lovers", "the-moon", "justice"];
const states: CharacterState[] = ["idle", "listening", "thinking", "shuffling", "speaking", "happy", "surprised", "grateful", "mysterious", "sleepy", "error"];
const gifts: GiftEffect[] = ["golden-plumage", "radiant-wings", "heart-glow", "luminous-feathers", "card-orbit", "constellation-markings", "wing-embrace", "grand-reveal"];
const eyeModes: EyeMode[] = ["neutral", "focused", "wide", "squint", "closed", "sleepy", "look-left", "look-right", "look-up", "look-down", "soft", "heart", "spiral"];
const stateLabels: Record<CharacterState, string> = { idle: "En calma", listening: "Escuchando", thinking: "Pensando", shuffling: "Barajando", speaking: "Hablando", happy: "Contenta", surprised: "Sorprendida", grateful: "Agradecida", mysterious: "Misteriosa", sleepy: "Soñolienta", error: "Un poquito perdida" };
const giftLabels: Record<GiftEffect, string> = { "golden-plumage": "Plumaje dorado", "radiant-wings": "Alas radiantes", "heart-glow": "Corazón de luz", "luminous-feathers": "Plumas luminosas", "card-orbit": "Órbita de cartas", "constellation-markings": "Constelación", "wing-embrace": "Abrazo de alas", "grand-reveal": "Gran revelación" };
const legacyGiftMap: Record<LegacyGiftEffect, GiftEffect> = { "gold-crown": "golden-plumage", "flower-bloom": "luminous-feathers", "silk-cape": "radiant-wings", "ribbon-dance": "card-orbit", "sparkle-burst": "luminous-feathers", "symbol-storm": "constellation-markings", "giant-glow": "grand-reveal" };
const visualPhases: VisualPhase[] = ["waiting", "preparing", "shuffling", "reading", "revealing", "complete"];
// "share" has no LIVE event behind it yet (liveEventSchema has no SHARE member), so it is
// reachable only from the test panel. It stays here so the rail is ready if one is added.
const pulseKinds: PulseKind[] = ["comment", "like", "follow", "join", "gift", "share"];
const samplePulseNames = ["Luna", "Carlitos", "Rosa M.", "Andrea", "Beto", "Mariana"];
/** Matches the pulse-chip animation in styles.css. */
const PULSE_LIFETIME_MS = 5200;
const phaseLabels: Record<VisualPhase, string> = { waiting: "En espera", preparing: "Preparando", shuffling: "Mezclando", reading: "Leyendo", revealing: "Revelando", complete: "Completa" };

function LogoMark({ compact = false }: { compact?: boolean }) {
  return <div className={`logo-lockup ${compact ? "is-compact" : ""}`} aria-label={compact ? "Mora" : "Mora — mensajes para reflexionar"}>
    <svg className="logo-mark" viewBox="0 0 64 64" aria-hidden="true">
      <path d="M13 20 21 9l11 9 11-9 8 11-8 27-11 8-11-8Z" fill="var(--plum)" stroke="var(--gold)" strokeWidth="1.5" />
      <path d="M13 20c10-8 28-8 38 0-8 3-13 9-19 20-6-11-11-17-19-20Z" fill="var(--cream)" stroke="var(--gold)" strokeWidth="1.3" />
      <path d="M32 16v24M15 20c7 2 12 6 17 14 5-8 10-12 17-14" fill="none" stroke="var(--gold)" strokeWidth="1.4" />
      <circle cx="25" cy="27" r="3" fill="var(--eye-dark)" /><circle cx="39" cy="27" r="3" fill="var(--eye-dark)" />
      <path d="m32 30 4 6-4 3-4-3Z" fill="var(--peach)" stroke="var(--gold)" strokeWidth="1" />
    </svg>
    <span className="logo-type"><strong>MORA</strong>{!compact && <em>mensajes para reflexionar</em>}</span>
  </div>;
}

interface SceneCard { id: string; orientation: CardOrientation; revealed: boolean; selected: boolean }
interface SceneState { characterState: CharacterState; phase: VisualPhase; deckStage: DeckStage; locale: RendererLocale; viewer: string; question: string; status: string; customTitle: string; customSubtitle: string; viewerCount:number; cards: SceneCard[]; speaking: boolean; mouthLevel: number; gift: GiftEffect | null; safe: boolean; eyeOverride: EyeMode | null; speed: number; faceHidden: boolean; preview360: boolean; pulses: ViewerPulse[]; reaction: MascotReaction | null }
const initialCards = (count = 3): SceneCard[] => demoCards.slice(0, count).map((id) => ({ id, orientation: "upright", revealed: false, selected: false }));

const backgroundScenes = ["velvet-cosmos", "moon-phases", "candle-altar", "crystal-chamber", "zodiac-wheel", "arcane-library"] as const;
type BackgroundScene = typeof backgroundScenes[number];
const personaLooks = ["velvet-cosmos", "moon-phases", "candle-altar", "crystal-chamber", "zodiac-wheel", "arcane-library"] as const;
type PersonaLook = typeof personaLooks[number];
const idleMotions = ["serene", "curious", "wing-wave", "shuffle", "cast", "mystic", "sleepy-sway"] as const;
type IdleMotion = typeof idleMotions[number];

const randomBetween = (min: number, max: number) => min + Math.random() * (max - min);

function shuffled<T>(items: readonly T[]): T[] {
  const list = [...items];
  for (let index = list.length - 1; index > 0; index -= 1) {
    const swap = Math.floor(Math.random() * (index + 1));
    [list[index], list[swap]] = [list[swap]!, list[index]!];
  }
  return list;
}

/**
 * Draws without replacement so a stream never repeats the same room order twice.
 * `pinned` freezes the rotation, for tuning a single room or locking one for a broadcast.
 */
function useShuffledRotation<T>(items: readonly T[], minMs: number, maxMs: number, pinned?: T | null): T {
  const bag = useRef<T[]>([]);
  const draw = useCallback((avoid?: T): T => {
    if (!bag.current.length) {
      const next = shuffled(items);
      if (avoid !== undefined && next[0] === avoid && next.length > 1) [next[0], next[1]] = [next[1]!, next[0]!];
      bag.current = next;
    }
    return bag.current.shift()!;
  }, [items]);
  const [value, setValue] = useState<T>(() => draw());
  const valueRef = useRef(value);
  useEffect(() => { valueRef.current = value; }, [value]);
  useEffect(() => {
    if (pinned) return;
    let timer: number | undefined;
    const rotate = () => {
      setValue(draw(valueRef.current));
      timer = window.setTimeout(rotate, randomBetween(minMs, maxMs));
    };
    timer = window.setTimeout(rotate, randomBetween(minMs, maxMs));
    return () => { if (timer !== undefined) window.clearTimeout(timer); };
  }, [draw, maxMs, minMs, pinned]);
  return pinned ?? value;
}

function pinnedFromQuery<T extends string>(key: string, allowed: readonly T[]): T | null {
  const value = new URLSearchParams(location.search).get(key);
  return value && (allowed as readonly string[]).includes(value) ? value as T : null;
}

/**
 * Where Mora is standing. `x` is a percentage of the frame width; `lift` and `hop` are
 * in scene-height units (see --roam-unit in styles.css). Her vertical budget is tiny —
 * the drawn owl already spans 0.5%-39% and the phase message is fixed at 39% — so the
 * travel that reads on camera comes from x, scale, lean, and the room sliding the
 * other way behind her.
 */
const ENVELOPE_HZ = 60;

let decodeContext: AudioContext | null = null;
function sharedDecodeContext(): AudioContext | null {
  if (decodeContext) return decodeContext;
  const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Ctor) return null;
  decodeContext = new Ctor();
  return decodeContext;
}

/**
 * Amplitude envelope for a TTS clip, measured ahead of playback.
 *
 * The clip is fetched and decoded separately from the <audio> element that actually
 * broadcasts it. Routing that element through createMediaElementSource would put a
 * WebAudio graph in the output path of the stream, where a suspended context or a
 * missed destination connection is a silent broadcast - and this renderer already has
 * an autoplay-unlock dance that would then need a second gate on the same audio.
 * Decoding a copy costs one fetch and leaves the audio path untouched.
 */
async function loadMouthEnvelope(url: string): Promise<Float32Array | null> {
  try {
    const response = await fetch(url);
    if (!response.ok) return null;
    const context = sharedDecodeContext();
    if (!context) return null;
    const buffer = await context.decodeAudioData(await response.arrayBuffer());
    const step = Math.max(1, Math.floor(buffer.sampleRate / ENVELOPE_HZ));
    const channel = buffer.getChannelData(0);
    const envelope = new Float32Array(Math.max(1, Math.ceil(channel.length / step)));
    let peak = 0;
    for (let frame = 0; frame < envelope.length; frame += 1) {
      const start = frame * step;
      const end = Math.min(channel.length, start + step);
      let sum = 0;
      for (let index = start; index < end; index += 1) sum += channel[index]! * channel[index]!;
      const rms = end > start ? Math.sqrt(sum / (end - start)) : 0;
      envelope[frame] = rms;
      if (rms > peak) peak = rms;
    }
    // A clip that decodes is not automatically a clip worth following: the bundled
    // local speech provider writes correctly formed but entirely silent wavs, so
    // trusting the decode alone would leave Mora mute-faced through a whole reading.
    // A flat clip hands the mouth back to the synthetic drive below.
    if (peak < 1e-4) return null;
    // Gamma under 1 lifts the quiet consonants; raw RMS reads as a mouth that only
    // opens on vowels and hangs slack the rest of the time.
    for (let frame = 0; frame < envelope.length; frame += 1) envelope[frame] = Math.min(1, (envelope[frame]! / peak) ** .7);
    return envelope;
  } catch {
    return null;
  }
}

/** Syllable rate, phrase gating and a jitter on top. No two share a period, so the
 *  fallback mouth never visibly repeats either. */
function syntheticAperture(seconds: number): number {
  const syllable = .5 + .5 * Math.sin(seconds * 11.37);
  const phrase = .5 + .5 * Math.sin(seconds * 2.71 + 1.1);
  const jitter = .5 + .5 * Math.sin(seconds * 19.73 + .4);
  return Math.max(0, Math.min(1, syllable * (.28 + .72 * phrase) * (.72 + .28 * jitter)));
}

/**
 * Single owner of the beak aperture. The value lands on a CSS custom property rather
 * than in React state: it changes every frame, and routing that through setState would
 * re-render the background, the roam and the deck sixty times a second.
 */
const mouthDriver = (() => {
  let raf = 0;
  let value = 0;
  let audio: HTMLAudioElement | null = null;
  let envelope: Float32Array | null = null;
  let speaking = false;

  const sample = (): number => {
    // A bound clip owns the mouth outright. Falling back to the synthetic drive while
    // it is paused would have Mora mime through a stall, which is the same divergence
    // in the other direction.
    if (audio) {
      if (audio.paused || audio.ended) return 0;
      if (!envelope) return syntheticAperture(audio.currentTime);
      // A frame of look-ahead so the beak opens on the attack rather than behind it.
      const index = Math.round((audio.currentTime + 1 / ENVELOPE_HZ) * ENVELOPE_HZ);
      return envelope[Math.min(envelope.length - 1, Math.max(0, index))] ?? 0;
    }
    return speaking ? syntheticAperture(performance.now() / 1000) : 0;
  };

  const tick = () => {
    // One-pole smoothing rather than a CSS transition: the target moves every frame,
    // and a transition would simply lag it.
    value += (sample() - value) * .38;
    if (value < .002) value = 0;
    document.documentElement.style.setProperty("--mouth", value.toFixed(3));
    // Idle Mora costs no frame budget in OBS.
    if (!speaking && !audio && value === 0) { raf = 0; return; }
    raf = requestAnimationFrame(tick);
  };
  const wake = () => { if (!raf) raf = requestAnimationFrame(tick); };

  return {
    follow(element: HTMLAudioElement, clip: Promise<Float32Array | null>) {
      audio = element;
      envelope = null;
      void clip.then((loaded) => { if (audio === element) envelope = loaded; });
      wake();
    },
    release(element: HTMLAudioElement) {
      if (audio !== element) return;
      audio = null;
      envelope = null;
      wake();
    },
    /** Speech with no clip to follow - the lab toggle, or a reading whose audio died. */
    setSpeaking(active: boolean) { speaking = active; wake(); },
  };
})();

/**
 * Ties the speaking flag and the mouth to what the element is actually doing.
 * `playing` rather than `play`: `play` fires on the request, `playing` when sound
 * actually starts, and the window between the two is exactly the autoplay-blocked case
 * where Mora used to mouth at an empty room.
 */
function bindSpeech(audio: HTMLAudioElement, url: string, onSpeaking: (active: boolean) => void): void {
  const clip = loadMouthEnvelope(url);
  audio.addEventListener("playing", () => { onSpeaking(true); mouthDriver.follow(audio, clip); });
  // `waiting` and `stalled` are deliberately not wired: they fire on every buffering
  // blip and would snap the beak shut and open again. currentTime stops advancing
  // during a stall, so the envelope closes the mouth on its own without state churn.
  const stop = () => { mouthDriver.release(audio); onSpeaking(false); };
  audio.addEventListener("pause", stop);
  audio.addEventListener("ended", stop);
}

interface Perch { x: number; lift: number; tilt: number; scale: number; side: "left" | "center" | "right"; move: number; hop: number; step: number }

// Measured at true 1080x1920 layout, not at preview size - the two do not scale alike.
// Her vertical budget is about two points in each direction: the witch hat cone already
// reaches ~1.8% of the frame and the phase message is frozen at 39%, four points under
// her talons. So the lift and the hop stay small and the travel that actually reads on
// camera comes from x, scale and lean, which cost nothing against those edges.
const perchSpots = [
  { x: 0, lift: 0, tilt: 0, scale: 1, hop: 1 },
  { x: -6, lift: .15, tilt: -1.7, scale: .985, hop: 1 },
  { x: -10, lift: .35, tilt: -3.1, scale: .95, hop: 1 },
  { x: 6, lift: .15, tilt: 1.7, scale: .985, hop: 1 },
  { x: 10, lift: .35, tilt: 3.1, scale: .95, hop: 1 },
  // Scaling up pivots near her talons, so it drives her head straight at the top edge -
  // verified clipping the witch hat cone at 1.05. Stepping toward camera is therefore
  // kept slight, and the scale range that reads on camera comes from the back anchor
  // below, which moves her away from every edge instead of into one.
  { x: .5, lift: .8, tilt: .4, scale: 1.015, hop: .3 },
  // Stepping back leaves the most room overhead, so it gets the biggest hop.
  { x: 1.5, lift: -.5, tilt: -.9, scale: .9, hop: 1.25 },
] as const;

/**
 * Draws anchors from a shuffled bag and re-targets at random intervals, so the motion
 * is a chain of aperiodic transitions rather than a keyframe loop. Nothing here repeats
 * on a fixed period, which is the whole point.
 */
function useRoam(): Perch {
  const bag = useRef<Array<typeof perchSpots[number]>>([]);
  // A ref rather than state: it only ever feeds the animation-name swap below, and
  // re-rendering on it would be wasted work.
  const stepRef = useRef(0);
  const [perch, setPerch] = useState<Perch>(() => ({ ...perchSpots[0], side: "center", move: 1800, hop: 0, step: 0 }));
  useEffect(() => {
    let timer: number | undefined;
    const go = () => {
      if (!bag.current.length) bag.current = shuffled(perchSpots);
      const spot = bag.current.shift()!;
      const move = Math.round(randomBetween(1500, 2600));
      const x = spot.x + randomBetween(-1.4, 1.4);
      stepRef.current += 1;
      setPerch({
        x, lift: spot.lift + randomBetween(-.2, .2), tilt: spot.tilt + randomBetween(-.7, .7),
        scale: spot.scale + randomBetween(-.015, .015),
        side: x < -2.5 ? "left" : x > 2.5 ? "right" : "center",
        move, hop: spot.hop * randomBetween(.5, 1.2), step: stepRef.current,
      });
      timer = window.setTimeout(go, move + randomBetween(5200, 11_000));
    };
    timer = window.setTimeout(go, randomBetween(2400, 5200));
    return () => { if (timer !== undefined) window.clearTimeout(timer); };
  }, []);
  return perch;
}

const starGlyphs = ["✦", "✧", "·", "✦", "⋆", "✧", "·"];
const runeGlyphs = ["ᛗ", "ᚨ", "ᛟ"];
const zodiacGlyphs = ["♈", "♋", "♎", "♑", "♒", "♓"];

interface Mote { x: number; size: number; duration: number; delay: number; drift: number; tint: number }

/** Randomized once per mount, so the ambient field is different on every stream. */
function useMotes(count: number): Mote[] {
  return useMemo(() => Array.from({ length: count }, () => ({
    x: randomBetween(2, 98),
    size: randomBetween(2.2, 6.5),
    duration: randomBetween(13, 27),
    delay: -randomBetween(0, 27),
    drift: randomBetween(-7, 7),
    tint: Math.random(),
  })), [count]);
}

function AmbientMotes({ count = 22 }: { count?: number }) {
  const motes = useMotes(count);
  return <div className="motes" aria-hidden="true">
    {motes.map((mote, index) => <i key={index} className={mote.tint > .68 ? "mote-peach" : ""} style={{
      "--mote-x": `${mote.x}%`,
      "--mote-size": `${mote.size}px`,
      "--mote-duration": `${mote.duration}s`,
      "--mote-delay": `${mote.delay}s`,
      "--mote-drift": `${mote.drift}%`,
    } as React.CSSProperties} />)}
  </div>;
}

/**
 * Star field and light shafts are placed here rather than in CSS on purpose: a fixed
 * set of nth-child coordinates and durations is the same frame on every stream, which
 * is exactly the signature that reads as reproduced content.
 */
function CelestialSymbols() {
  const stars = useMemo(() => starGlyphs.map(() => ({
    x: randomBetween(3, 95), y: randomBetween(2, 42), size: randomBetween(9, 17),
    delay: -randomBetween(0, 6), duration: randomBetween(3.4, 7.8),
  })), []);
  const rays = useMemo(() => Array.from({ length: 4 }, (_, index) => ({
    x: randomBetween(6 + index * 22, 20 + index * 22),
    width: randomBetween(4, 13),
    turn: randomBetween(-14, 14),
    duration: randomBetween(11, 23),
    delay: -randomBetween(0, 12),
  })), []);
  const flames = useMemo(() => [randomBetween(.82, 1.24), randomBetween(.82, 1.24)], []);
  return <div className="bg-symbols" aria-hidden="true">
    <div className="bg-moon" />
    <div className="bg-sun" />
    <div className="bg-zodiac-ring">{zodiacGlyphs.map((glyph) => <span key={glyph}>{glyph}</span>)}</div>
    <div className="bg-orbit" />
    <div className="bg-orbit bg-orbit-two" />
    <div className="bg-stars">{starGlyphs.map((glyph, index) => <i key={index} style={{
      "--star-x": `${stars[index]!.x}%`, "--star-y": `${stars[index]!.y}%`, "--star-size": `${stars[index]!.size}px`,
      "--twinkle-delay": `${stars[index]!.delay}s`, "--twinkle-duration": `${stars[index]!.duration}s`,
    } as React.CSSProperties}>{glyph}</i>)}</div>
    <div className="bg-rays">{rays.map((ray, index) => <i key={index} style={{
      "--ray-x": `${ray.x}%`, "--ray-w": `${ray.width}%`, "--ray-turn": `${ray.turn}deg`,
      "--ray-duration": `${ray.duration}s`, "--ray-delay": `${ray.delay}s`,
    } as React.CSSProperties} />)}</div>
    <div className="bg-candle bg-candle-left" style={{ "--flame-jitter": flames[0] } as React.CSSProperties}><b /></div>
    <div className="bg-candle bg-candle-right" style={{ "--flame-jitter": flames[1] } as React.CSSProperties}><b /></div>
    <div className="bg-crystal bg-crystal-left" />
    <div className="bg-crystal bg-crystal-right" />
    <div className="bg-crystal bg-crystal-center" />
    <div className="bg-runes">{runeGlyphs.map((glyph) => <span key={glyph}>{glyph}</span>)}</div>
    <div className="bg-book"><span>✦</span></div>
    <div className="bg-mist bg-mist-one" />
    <div className="bg-mist bg-mist-two" />
  </div>;
}

function Background({ scene, roam }: { scene: BackgroundScene; roam: Perch }) {
  const drift = useMemo(() => ({ one: randomBetween(19, 31), two: randomBetween(15, 26) }), []);
  // Counter-parallax: the room slides against Mora, which doubles how far she reads
  // as having moved without spending any of her own (very small) travel budget.
  return <div className={`background background-${scene}`} data-background-scene={scene} data-roam={roam.side} aria-hidden="true"
    style={{ "--aurora-one-duration": `${drift.one}s`, "--aurora-two-duration": `${drift.two}s`, "--parallax-x": `${roam.x * -0.2}%` } as React.CSSProperties}>
    <div className="bg-washes">{backgroundScenes.map((item) => <div key={item} className={`bg-wash bg-wash-${item} ${item === scene ? "is-active" : ""}`} />)}</div>
    <div className="aurora aurora-one" />
    <div className="aurora aurora-two" />
    <div className="bg-scenery">
      <div className="scenery-backwall" />
      <div className="scenery-drape" />
      <div className="scenery-arch"><span /></div>
      <div className="scenery-window"><span /><i /></div>
      <div className="scenery-cabinet"><i /><i /><i /><i /><i /><i /></div>
      <div className="scenery-shelf scenery-shelf-left"><i /><i /><i /><i /></div>
      <div className="scenery-shelf scenery-shelf-right"><i /><i /><i /><i /></div>
      <div className="scenery-vines"><i /><i /><i /></div>
      <div className="scenery-cauldron"><span /></div>
      <div className="scenery-crystal-ball"><span /></div>
    </div>
    <CelestialSymbols />
    <AmbientMotes />
    <div className="bg-quiet-band" />
    <div className="grain" /><div className="vignette" />
  </div>;
}

function EyePart({ side, mode, blinking }: { side: "left" | "right"; mode: EyeMode; blinking: boolean }) {
  const x = side === "left" ? 171 : 249;
  const lookX = mode === "look-left" ? -7 : mode === "look-right" ? 7 : 0;
  const lookY = mode === "look-up" ? -5 : mode === "look-down" ? 5 : 0;
  const shape = mode === "wide" ? "wide" : mode === "sleepy" ? "sleepy" : mode === "squint" ? "squint" : blinking || mode === "closed" ? "closed" : mode;
  return <g className={`eye-part eye-${side} eye-shape-${shape}`}>
    <ellipse className="eye-white" cx={x} cy="187" rx={mode === "wide" ? 30 : 27} ry={mode === "sleepy" ? 13 : 28} />
    <circle className="pupil" cx={x + lookX} cy={187 + lookY} r={mode === "wide" ? 12 : 10} />
    <circle className="eye-glint" cx={x - 4 + lookX} cy={182 + lookY} r="4" />
    <path className="eyelid" d={`M${x - 27} 187 Q${x} 190 ${x + 27} 187`} />
  </g>;
}

function PersonaProps({ look }: { look: PersonaLook }) {
  return <div className={`persona-props persona-${look}`} aria-hidden="true">
    <div className="persona-witch-hat"><i /></div>
    <div className="persona-top-hat"><i /></div>
    <div className="persona-suit"><i /></div>
    <div className="persona-crown"><i /><i /><i /></div>
    <div className="persona-glasses"><i /><i /><b /></div>
    <div className="persona-bowtie"><i /><i /></div>
    {/* Replaces the old scarf, which sat across the beak. Hangs below the facial disk,
        clear of the eyes and of the deck that flies between her wings while shuffling. */}
    <div className="persona-pendant"><i /></div>
  </div>;
}

const featherGlyphs = ["✦", "⌁", "✧", "·", "✦", "⋆", "✧", "✦", "·"];

function OwlCharacter({ state, speaking, mouthLevel, gift, eyeOverride, faceHidden, speed, persona = "velvet-cosmos", reaction = null }: { state: CharacterState; speaking: boolean; mouthLevel: number; gift: GiftEffect | null; eyeOverride: EyeMode | null; faceHidden: boolean; speed: number; persona?: PersonaLook; reaction?: MascotReaction | null }) {
  const [blinking, setBlinking] = useState(false);
  const [idleMotion, setIdleMotion] = useState<IdleMotion>("serene");
  const [idleGaze, setIdleGaze] = useState<EyeMode | null>(null);
  const [activeReaction, setActiveReaction] = useState<MascotReaction | null>(null);
  const blinkTimer = useRef<number | undefined>(undefined);
  // Jittered once per mount so two instances of the stream never breathe in lockstep.
  const rig = useMemo(() => ({ bob: randomBetween(.86, 1.18), wing: randomBetween(.9, 1.12), aura: randomBetween(.88, 1.15) }), []);
  const feathers = useMemo(() => featherGlyphs.map((glyph) => ({ glyph, x: randomBetween(12, 88), delay: randomBetween(0, 2.4), duration: randomBetween(1.9, 3.4), drift: randomBetween(-16, 16) })), []);
  useEffect(() => { const schedule = () => { blinkTimer.current = window.setTimeout(() => { setBlinking(true); window.setTimeout(() => setBlinking(false), 130 / speed); schedule(); }, 2000 + Math.random() * 4000); }; schedule(); return () => window.clearTimeout(blinkTimer.current); }, [speed]);
  // The mouth is owned by mouthDriver, which writes it per frame off the real TTS
  // waveform. This only tells the driver whether speech is happening at all, for the
  // cases with no clip to follow.
  useEffect(() => { mouthDriver.setSpeaking(speaking); return () => mouthDriver.setSpeaking(false); }, [speaking]);
  useEffect(() => {
    if(state !== "idle") return;
    let timer:number|undefined;
    const rotate=()=>{setIdleMotion((current)=>{const choices=idleMotions.filter((motion)=>motion!==current);return choices[Math.floor(Math.random()*choices.length)]!;});timer=window.setTimeout(rotate,10_000+Math.round(Math.random()*8_000));};
    timer=window.setTimeout(rotate,6_000+Math.round(Math.random()*5_000));
    return ()=>{if(timer!==undefined)window.clearTimeout(timer);};
  },[state]);
  // Wandering gaze keeps the face alive between scripted states.
  useEffect(() => {
    if (state !== "idle" && state !== "listening" && state !== "mysterious") { setIdleGaze(null); return; }
    let timer: number | undefined;
    const wander = () => {
      const targets: Array<EyeMode | null> = ["look-left", "look-right", "look-down", null, "look-up", null];
      setIdleGaze(targets[Math.floor(Math.random() * targets.length)] ?? null);
      timer = window.setTimeout(wander, randomBetween(2400, 6200));
    };
    timer = window.setTimeout(wander, randomBetween(1800, 4200));
    return () => { if (timer !== undefined) window.clearTimeout(timer); };
  }, [state]);
  // A viewer event nudges Mora toward the activity rail without disturbing the scripted state.
  useEffect(() => {
    if (!reaction) return;
    setActiveReaction(reaction);
    const timer = window.setTimeout(() => setActiveReaction(null), reaction.durationMs);
    return () => window.clearTimeout(timer);
  }, [reaction]);
  // Speaking is one continuous shape driven by --mouth; the rest are expressions, which
  // are discrete on purpose.
  const beak = speaking ? "speaking" : state === "happy" ? "smile-like" : state === "surprised" ? "rounded" : state === "error" ? "concerned" : "closed";
  const baseEyes: EyeMode = blinking ? "closed" : state === "surprised" ? "wide" : state === "mysterious" ? "squint" : state === "sleepy" ? "sleepy" : state === "thinking" ? "look-up" : state === "listening" ? "focused" : state === "grateful" ? "soft" : "neutral";
  const reactionEyes: EyeMode | null = activeReaction && !blinking ? (activeReaction.kind === "gift" ? "wide" : "look-right") : null;
  const eyes: EyeMode = eyeOverride ?? reactionEyes ?? (state === "idle" && !blinking && idleGaze ? idleGaze : baseEyes);
  return <div className={`owl-wrap state-${state} idle-motion-${idleMotion} gift-${gift ?? "none"} ${faceHidden ? "face-hidden" : ""} ${activeReaction ? `is-reacting reacting-${activeReaction.kind}` : ""}`} data-idle-motion={state === "idle" ? idleMotion : undefined} style={{ "--speed": speed, "--bob-jitter": rig.bob, "--wing-jitter": rig.wing, "--aura-jitter": rig.aura, ...(!speaking && mouthLevel > 0 ? { "--mouth": mouthLevel } : {}) } as React.CSSProperties}>
    <div className="owl-aura" />
    <PersonaProps look={persona} />
    <svg className="owl" viewBox="0 0 420 430" role="img" aria-label={`Mora está ${stateLabels[state].toLowerCase()}`}>
      <g className="rig-layer layer-shadow"><ellipse cx="210" cy="398" rx="96" ry="10" /></g>
      <g className="rig-layer layer-ambient-glow"><ellipse cx="210" cy="238" rx="126" ry="148" /></g>
      <g className="rig-layer layer-tail"><path d="M181 358 210 407l29-49Z" /></g>
      <g className="rig-layer layer-rear-body layer-rear-body-feathers"><path d="M145 304c15 53 37 80 65 91 28-11 50-38 65-91Z" /><path d="M171 349q39 29 78 0-11 34-39 46-28-12-39-46Z" /></g>
      <g className="rig-layer layer-left-rear-wing"><path d="M139 214c-48 20-68 59-59 111 7 32 30 45 53 31 18-17 24-48 15-86Z" /><path className="feather-line" d="M112 258q-13 39 8 70" /></g>
      <g className="rig-layer layer-right-rear-wing"><path d="M281 214c48 20 68 59 59 111-7 32-30 45-53 31-18-17-24-48-15-86Z" /><path className="feather-line" d="M308 258q13 39-8 70" /></g>
      <g className="rig-layer layer-main-body"><path d="M210 75c-68 0-105 54-105 146v91c0 48 25 78 55 82l20-20 30 22 30-22 20 20c30-4 55-34 55-82v-91c0-92-37-146-105-146Z" /><path className="body-velvet" d="M130 286c20 37 46 57 80 61 34-4 60-24 80-61v37c-13 42-39 66-80 73-41-7-67-31-80-73Z" /></g>
      <g className="rig-layer layer-chest-glow"><ellipse cx="210" cy="306" rx="50" ry="64" /></g>
      <g className="rig-layer layer-chest-feathers"><path d="M210 252c-28 25-40 51-34 77 8 25 19 42 34 52 15-10 26-27 34-52 6-26-6-52-34-77Z" /><path d="M190 321q20 17 40 0" /></g>
      <g className="rig-layer layer-facial-disk"><path d="M210 116c-29-31-78-29-94 10-22 54 19 101 94 137 75-36 116-83 94-137-16-39-65-41-94-10Z" /><path className="disk-inner" d="M210 130c-24-25-62-23-75 8-17 42 15 78 75 108 60-30 92-66 75-108-13-31-51-33-75-8Z" /></g>
      <g className="rig-layer layer-left-eye"><EyePart side="left" mode={eyes} blinking={blinking} /></g><g className="rig-layer layer-right-eye"><EyePart side="right" mode={eyes} blinking={blinking} /></g>
      <g className="rig-layer layer-left-brow"><path d={`M146 151 Q174 ${state === "thinking" ? 132 : state === "error" ? 162 : 142} 198 151`} /></g><g className="rig-layer layer-right-brow"><path d={`M222 151 Q246 ${state === "thinking" ? 143 : state === "error" ? 162 : 142} 274 151`} /></g>
      <g className="rig-layer layer-beak-upper"><path d="M194 211 210 192l16 19-16 13Z" /></g><g className="rig-layer layer-mouth-inner"><path d="M194 211h32l-16 22Z" /></g><g className={`rig-layer layer-beak-lower beak-${beak}`}><path d="M194 211h32l-16 22Z" /></g>
      <g className="rig-layer layer-left-front-wing"><path d="M125 231c-39 7-58 34-48 59 8 21 35 20 59-4 16-17 20-37 12-50-5-7-13-8-23-5Z" /><path className="wing-fold" d="M103 263q17 3 29-12" /></g>
      <g className="rig-layer layer-right-front-wing"><path d="M295 231c39 7 58 34 48 59-8 21-35 20-59-4-16-17-20-37-12-50 5-7 13-8 23-5Z" /><path className="wing-fold" d="M317 263q-17 3-29-12" /></g>
      <g className="rig-layer layer-left-feather-tips"><path d="M92 278q18 9 36-10-14 27-36 10Z" /></g><g className="rig-layer layer-right-feather-tips"><path d="M328 278q-18 9-36-10 14 27 36 10Z" /></g>
      <g className="rig-layer layer-left-talon"><path d="M177 388q-10 11-20 12M184 390q-2 8-1 13" /></g><g className="rig-layer layer-right-talon"><path d="M243 388q10 11 20 12M236 390q2 8 1 13" /></g>
      <g className="rig-layer layer-crest"><path d="M188 91q22-27 44 0-22-10-44 0Z" /></g>
      <g className="rig-layer layer-gold-markings"><path d="M210 88v15M194 102q16 11 32 0M187 348q23 13 46 0" /><circle cx="210" cy="124" r="3" /></g>
      <g className="rig-layer layer-foreground-effects"><path className="heart-glow-shape" d="M210 274c-24-28-53 6 0 49 53-43 24-77 0-49Z" /><path className="radial-lines" d="M210 210v-45M210 210l30-36M210 210l-30-36M210 210h-44M210 210h44" /><circle className="orbit-card orbit-card-a" cx="210" cy="210" r="120" /><circle className="orbit-card orbit-card-b" cx="210" cy="210" r="120" /><circle className="orbit-card orbit-card-c" cx="210" cy="210" r="120" /></g>
    </svg>
    <div className="gift-feathers" aria-hidden="true">{feathers.map((feather, index) => <i key={index} style={{ "--feather-x": `${feather.x}%`, "--feather-delay": `${feather.delay}s`, "--feather-duration": `${feather.duration}s`, "--feather-drift": `${feather.drift}px` } as React.CSSProperties}>{feather.glyph}</i>)}</div>
  </div>;
}

function TarotCard({ card, index, total = 1 }: { card: SceneCard; index: number; total?: number }) {
  const dealBias = total === 1 ? 220 : total === 3 ? 60 : total === 5 ? -20 : -80;
  const dealOffset = (total - index - 1) * 110 + dealBias;
  const artworkUrl = tarotArtworkUrl(card.id);
  const orientationLabel = card.orientation === "reversed" ? "invertida" : "derecha";
  return <div className={`tarot-card ${card.revealed ? "is-revealed" : ""} ${card.orientation === "reversed" ? "is-reversed" : ""}`} style={{ "--card-index": index, "--deal-x": `${dealOffset}%` } as React.CSSProperties} aria-label={`${card.revealed ? cardNames[card.id] ?? card.id : `Carta ${index + 1}`}. ${card.revealed ? `Revelada ${orientationLabel}` : "Boca abajo"}`}>
    <div className="card-flip"><div className="card-face card-back"><span className="card-back-symbol" /></div><div className="card-face card-front">{artworkUrl ? <img className="card-art" src={artworkUrl} alt="" /> : <span className="card-art-fallback" aria-hidden="true">✦</span>}</div></div>
  </div>;
}

function FullDeck() {
  return <div className="full-deck" aria-hidden="true">{Array.from({ length: 24 }, (_, index) => <i key={index} className={`deck-card-sprite ${index < 12 ? "deck-half-left" : "deck-half-right"}`} style={{ "--deck-index": index, "--half-index": index % 12 } as React.CSSProperties}><span /></i>)}</div>;
}

function TarotTable({ state }: { state: SceneState }) {
  return <section className={`tarot-table deck-${state.deckStage} cards-${state.cards.length}`} data-deck-stage={state.deckStage} aria-label="Mesa de tarot"><div className="table-surface" /><div className="cards-row">{state.cards.map((card, index) => <TarotCard key={`${card.id}-${index}`} card={card} index={index} total={state.cards.length} />)}</div></section>;
}

function ActivityRail({ pulses, locale }: { pulses: ViewerPulse[]; locale: RendererLocale }) {
  if (!pulses.length) return null;
  return <div className="activity-rail" aria-hidden="true">
    {pulses.map((pulse) => {
      const label = pulseCopy[locale][pulse.kind];
      return <span key={pulse.id} className={`pulse-chip pulse-${pulse.kind}`}>
        <i>{label.glyph}</i>
        <strong>{pulse.name}</strong>
        <em>{pulse.detail || label.action}</em>
      </span>;
    })}
  </div>;
}

function LiveActivityPanel({ state }: { state: SceneState }) {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 1000);
    return () => window.clearInterval(timer);
  }, []);
  const latest = state.pulses.slice(-2).reverse();
  const isReading = state.cards.length > 0 || state.phase !== "waiting";
  return <section className={`live-activity-panel ${isReading ? "is-reading" : "is-waiting"}`} aria-label="Actividad real del LIVE">
    <header><span><i /> EN DIRECTO</span><time>{now.toLocaleTimeString(state.locale, { hour: "2-digit", minute: "2-digit", second: "2-digit" })}</time></header>
    {!isReading && <div className="live-activity-body">
      {latest.length ? latest.map((pulse) => <div className={`live-event live-event-${pulse.kind}`} key={pulse.id}>
        <b>{pulseCopy[state.locale][pulse.kind].glyph}</b>
        <span><strong>{pulse.name}</strong><em>{pulse.detail || pulseCopy[state.locale][pulse.kind].action}</em></span>
      </div>) : <div className="live-listening">
        <span className="listening-orbit"><i /><i /><i /></span>
        <span><strong>Mora está observando el chat ahora</strong><em>Escribe una pregunta; cada lectura parte de una interacción real.</em></span>
      </div>}
    </div>}
  </section>;
}

function SafeZone() {
  return <><div className="safe-zone"><span>SAFE ZONE · MORA LIVE</span><i /><i /><i /><i /></div><div className="chat-zone"><span>TIKTOK CHAT ZONE · NON-CRITICAL UI ONLY</span></div></>;
}

function PhaseMessage({ state }: { state: SceneState }) {
  const message = resolvePhaseMessage(state.locale, state.phase, state.viewer, state.question);
  if(state.customTitle)return <section className="phase-message is-interaction" data-visual-phase="interaction"><h1>{state.customTitle}</h1>{state.customSubtitle&&<p>{state.customSubtitle}</p>}</section>;
  const template = phaseCopy[state.locale][state.phase].title;
  const hasName = template.includes("{name}");
  const [beforeName, afterName] = template.split("{name}");
  const nameClass = state.viewer.length > 28 ? "name-extra-long" : state.viewer.length > 18 ? "name-long" : "";
  return <section className="phase-message" data-visual-phase={state.phase}><h1 className={hasName ? nameClass : ""}>{hasName ? <>{beforeName}<strong className={nameClass}>{state.viewer || (state.locale === "pt-BR" ? "você" : "ti")}</strong>{afterName}</> : message.title}</h1>{message.subtitle && <p>{message.subtitle}</p>}</section>;
}

function Scene({ state, isLive }: { state: SceneState; isLive: boolean }) {
  const backgroundScene = useShuffledRotation(backgroundScenes, 34_000, 68_000, pinnedFromQuery("room", backgroundScenes));
  const persona = useShuffledRotation(personaLooks, 52_000, 104_000, pinnedFromQuery("persona", personaLooks));
  const roam = useRoam();
  const roamStyle = {
    "--roam-x": `${roam.x}%`, "--roam-y": roam.lift, "--roam-turn": `${roam.tilt}deg`,
    "--roam-scale": roam.scale, "--roam-move": `${roam.move}ms`, "--roam-hop": roam.hop,
  } as React.CSSProperties;
  // Alternating the animation name is what restarts the hop arc on each move; a key
  // change would restart it too but would remount the owl and drop her blink timers.
  const hopStyle = { animationName: roam.step ? (roam.step % 2 ? "roam-hop-a" : "roam-hop-b") : "none", animationDuration: `${roam.move}ms` } as React.CSSProperties;
  return <div id={isLive ? "live-scene" : "test-scene"} className={`scene phase-${state.phase} ${state.cards.length ? "has-cards" : "no-cards"} ${state.customTitle ? "has-interaction" : ""} ${isLive ? "production-scene" : ""}`}><Background scene={backgroundScene} roam={roam} /><header className="scene-header"><LogoMark compact />{state.viewerCount>0&&<span className="live-count">● {state.viewerCount} EN VIVO</span>}</header><ActivityRail pulses={state.pulses} locale={state.locale} /><section className="mora-stage"><div className="mora-roam" data-roam-side={roam.side} style={roamStyle}><div className="mora-hop" style={hopStyle}><OwlCharacter state={state.characterState} speaking={state.speaking} mouthLevel={state.mouthLevel} gift={state.gift} eyeOverride={state.eyeOverride} faceHidden={state.faceHidden} speed={state.speed} persona={persona} reaction={state.reaction} /></div>{/* The deck lives here rather than in the table: it is Mora's, so it rides the
      roam wrapper and stays at her wing wherever she walks. The table below is left
      to the cards of the reading alone. */}
<div className={`mora-deck deck-${state.deckStage}`}><FullDeck /></div></div></section><PhaseMessage state={state} /><LiveActivityPanel state={state} /><TarotTable state={state} /><div className="scene-footer"><div className="tier-strip" aria-label="Tipos de lectura"><span>Perfume · 1</span><span>Hand Heart · 3</span><span>Fairy Hide · 5</span><span>Face-pulling · 7</span></div><div className="cta"><span className="cta-glyph">✦</span><strong>Escribe una pregunta para participar en el LIVE</strong><span className="cta-glyph">✦</span></div><p>Entretenimiento y reflexión personal · regalos opcionales{state.viewerCount>0?` · ${state.viewerCount} en vivo`:""}</p></div>{state.safe && <SafeZone />}</div>;
}

function TestPanel({ state, update, controller }: { state: SceneState; update: (patch: Partial<SceneState>) => void; controller: VisualController }) {
  const [tab, setTab] = useState<"character" | "cards" | "brand">("character");
  return <aside className="test-panel"><div className="panel-head"><div><span className="panel-kicker">MORA / LAB</span><h2>Simple owl controls</h2></div><span className="panel-dot" /></div><div className="panel-tabs">{(["character", "cards", "brand"] as const).map((item) => <button key={item} className={tab === item ? "is-active" : ""} onClick={() => setTab(item)}>{item}</button>)}</div>{tab === "character" && <div className="panel-content"><label className="control-label">Character state</label><div className="state-grid">{states.map((item) => <button key={item} className={state.characterState === item ? "is-active" : ""} onClick={() => controller.setCharacterState(item)}>{stateLabels[item]}</button>)}</div><label className="control-label">Eye expression</label><div className="eye-grid">{eyeModes.map((item) => <button key={item} className={state.eyeOverride === item ? "is-active" : ""} onClick={() => update({ eyeOverride: state.eyeOverride === item ? null : item })}>{item}</button>)}</div><label className="toggle"><input type="checkbox" checked={state.speaking} onChange={(e) => controller.setSpeaking(e.target.checked)} /><span /> Speaking loop</label><label className="control-label">Beak level <output>{Math.round(state.mouthLevel * 100)}%</output></label><input className="range" type="range" min="0" max="1" step=".01" value={state.mouthLevel} onChange={(e) => controller.setMouthLevel(Number(e.target.value))} /><label className="control-label">Animation speed <output>{state.speed.toFixed(1)}×</output></label><input className="range" type="range" min=".4" max="1.6" step=".1" value={state.speed} onChange={(e) => update({ speed: Number(e.target.value) })} /><label className="control-label gift-label">Gift reaction</label><div className="gift-grid">{gifts.map((item) => <button key={item} onClick={() => controller.triggerGiftEffect(item)}>{giftLabels[item]}</button>)}</div></div>}{tab === "cards" && <div className="panel-content"><label className="control-label">Spread</label><div className="spread-grid">{([1, 3, 5, 6, 7] as const).map((count) => <button key={count} className={state.cards.length === count ? "is-active" : ""} onClick={() => controller.showCards(count)}>{count} carta{count === 1 ? "" : "s"}</button>)}</div><label className="control-label">Reveal sequence</label><div className="reveal-grid">{state.cards.map((card, index) => <button key={index} className={card.revealed ? "is-active" : ""} onClick={() => controller.revealCard(index)}>{index + 1}</button>)}</div><button className="wide-button" onClick={() => controller.resetCards()}>Reset spread</button><div className="divider-glyph panel-divider">⌁　✦　⌁</div></div>}{tab === "brand" && <div className="panel-content brand-preview"><LogoMark /><div className="brand-lockup-preview"><span>LEYENDO PARA</span><strong>María</strong><em>Escribe tu pregunta</em></div><div className="brand-card-back"><TarotCard card={{ id: "the-star", orientation: "upright", revealed: false, selected: false }} index={0} /></div><p>Heart face · teardrop body · two paddle wings</p></div>}<div className="panel-bottom"><label className="toggle"><input type="checkbox" checked={state.safe} onChange={(e) => update({ safe: e.target.checked })} /><span /> Safe-zone overlay</label><label className="toggle"><input type="checkbox" checked={state.faceHidden} onChange={(e) => update({ faceHidden: e.target.checked })} /><span /> Face hidden</label><button className="reset-button" onClick={() => controller.resetScene()}>Reset</button></div></aside>;
}

function RendererTestPanel({ state, update, controller }: { state: SceneState; update: (patch: Partial<SceneState>) => void; controller: VisualController }) {
  const [tab, setTab] = useState<"scene" | "character" | "cards">("scene");
  const setPhase = (phase: VisualPhase) => {
    const characterState: CharacterState = phase === "shuffling" ? "shuffling" : phase === "reading" || phase === "revealing" ? "speaking" : phase === "complete" ? "grateful" : "idle";
    update({ phase, characterState, speaking: phase === "reading" || phase === "revealing", deckStage: phase === "shuffling" ? "shuffling" : phase === "waiting" || phase === "preparing" ? "stacked" : state.cards.length ? "dealt" : "stacked" });
  };
  return <aside className="test-panel"><div className="panel-head"><div><span className="panel-kicker">MORA / RENDERER TEST</span><h2>Live canvas controls</h2></div><span className="panel-dot" /></div><div className="panel-tabs">{(["scene", "character", "cards"] as const).map((item) => <button key={item} className={tab === item ? "is-active" : ""} onClick={() => setTab(item)}>{item}</button>)}</div>{tab === "scene" && <div className="panel-content"><label className="control-label">Visual phase</label><div className="phase-grid">{visualPhases.map((phase) => <button key={phase} className={state.phase === phase ? "is-active" : ""} onClick={() => setPhase(phase)}>{phaseLabels[phase]}</button>)}</div><label className="control-label">Viewer samples</label><div className="sample-grid"><button onClick={() => update({ viewer: "Luna" })}>Nombre corto</button><button onClick={() => update({ viewer: "María Fernanda de los Ángeles" })}>Nombre largo</button><button onClick={() => update({ question: "¿Qué necesito ver hoy?" })}>Pregunta corta</button><button onClick={() => update({ question: "¿Qué necesito comprender sobre los cambios que estoy atravesando para tomar una decisión con más calma y claridad?" })}>Pregunta larga</button></div><label className="control-label">Locale</label><div className="sample-grid"><button className={state.locale === "es-MX" ? "is-active" : ""} onClick={() => update({ locale: "es-MX" })}>es-MX</button><button className={state.locale === "pt-BR" ? "is-active" : ""} onClick={() => update({ locale: "pt-BR" })}>pt-BR</button></div><label className="toggle"><input type="checkbox" checked={state.preview360} onChange={(event) => update({ preview360: event.target.checked })} /><span /> 360 × 640 preview</label><label className="toggle"><input type="checkbox" checked={state.safe} onChange={(event) => update({ safe: event.target.checked })} /><span /> Safe-zone overlay</label></div>}{tab === "character" && <div className="panel-content"><label className="control-label">Character state</label><div className="state-grid">{states.map((item) => <button key={item} className={state.characterState === item ? "is-active" : ""} onClick={() => controller.setCharacterState(item)}>{stateLabels[item]}</button>)}</div><label className="control-label">Eye expression</label><div className="eye-grid">{eyeModes.map((item) => <button key={item} className={state.eyeOverride === item ? "is-active" : ""} onClick={() => update({ eyeOverride: state.eyeOverride === item ? null : item })}>{item}</button>)}</div><label className="toggle"><input type="checkbox" checked={state.speaking} onChange={(event) => controller.setSpeaking(event.target.checked)} /><span /> Speaking loop</label><label className="control-label">Beak level <output>{Math.round(state.mouthLevel * 100)}%</output></label><input className="range" type="range" min="0" max="1" step=".01" value={state.mouthLevel} onChange={(event) => controller.setMouthLevel(Number(event.target.value))} /><label className="control-label">Animation speed <output>{state.speed.toFixed(1)}×</output></label><input className="range" type="range" min=".4" max="1.6" step=".1" value={state.speed} onChange={(event) => update({ speed: Number(event.target.value) })} /><label className="control-label gift-label">Gift reaction</label><div className="gift-grid">{gifts.map((item) => <button key={item} onClick={() => controller.triggerGiftEffect(item)}>{giftLabels[item]}</button>)}</div><label className="control-label">Viewer pulse</label><div className="gift-grid">{pulseKinds.map((kind) => <button key={kind} onClick={() => controller.pushViewerPulse(kind, samplePulseNames[Math.floor(Math.random() * samplePulseNames.length)]!)}>{kind}</button>)}</div><button className="wide-button" onClick={() => { samplePulseNames.slice(0, 3).forEach((name, index) => window.setTimeout(() => controller.pushViewerPulse(pulseKinds[index % pulseKinds.length]!, name), index * 700)); }}>Burst of 3</button><label className="toggle"><input type="checkbox" checked={state.faceHidden} onChange={(event) => update({ faceHidden: event.target.checked })} /><span /> Face hidden</label></div>}{tab === "cards" && <div className="panel-content"><button className="wide-button" onClick={() => controller.setCharacterState("shuffling")}>Start full-deck shuffle</button><label className="control-label">Deal from top</label><div className="spread-grid">{([1, 3, 5, 6] as const).map((count) => <button key={count} className={state.cards.length === count ? "is-active" : ""} onClick={() => controller.showCards(count)}>{count} carta{count === 1 ? "" : "s"}</button>)}</div><label className="control-label">Reveal one card</label><div className="reveal-grid">{state.cards.length ? state.cards.map((card, index) => <button key={index} className={card.revealed ? "is-active" : ""} onClick={() => controller.revealCard(index)}>{index + 1}</button>) : <span className="panel-hint">Deal cards first</span>}</div><button className="wide-button" onClick={() => controller.resetCards()}>Reset into complete deck</button></div>}<div className="panel-bottom"><button className="reset-button" onClick={() => controller.resetScene()}>Reset scene</button></div></aside>;
}

function StyleGuide({ state, update }: { state: SceneState; update: (patch: Partial<SceneState>) => void }) {
  const poseStates: CharacterState[] = ["idle", "thinking", "surprised", "grateful", "mysterious", "sleepy"];
  return <main className="style-page"><header className="style-header"><LogoMark /><div><span className="panel-kicker">VISUAL SYSTEM / 02</span><h1>Mora · simple barn-owl oracle</h1><p>One clear silhouette, two expressive wings, quick facial swaps, and capture-safe scene tokens.</p></div></header><section className="style-section"><div className="section-title"><span>01</span><h2>Design tokens</h2></div><div className="token-grid">{Object.entries(DESIGN_TOKENS).map(([key, value]) => <div className="token" key={key}><i style={{ background: value }} /><strong>{key}</strong><small>{value}</small></div>)}</div></section><section className="style-section"><div className="section-title"><span>02</span><h2>Full-body poses</h2><label className="toggle"><input type="checkbox" checked={state.faceHidden} onChange={(e) => update({ faceHidden: e.target.checked })} /><span /> Face hidden</label></div><div className="pose-grid">{poseStates.map((pose) => <div className="pose-card" key={pose}><div className="pose-preview"><OwlCharacter state={pose} speaking={false} mouthLevel={.2} gift={null} eyeOverride={null} faceHidden={state.faceHidden} speed={1} /></div><strong>{stateLabels[pose]}</strong></div>)}</div></section><section className="style-section"><div className="section-title"><span>03</span><h2>Eyes · wing gestures · gifts</h2></div><div className="expression-row"><div className="expression-card"><label>Eye modes</label><div className="eye-swatches">{eyeModes.map((eye) => <span key={eye}>{eye}</span>)}</div></div><div className="expression-card"><label>Wing gestures</label><div className="wing-swatches">{[0, 1, 2, 3, 4].map((gesture) => <i key={gesture} className={`wing-mini wing-mini-${gesture}`} />)}</div></div><div className="expression-card"><label>Gift effects</label><div className="gift-swatches">{gifts.map((gift) => <span key={gift}>{giftLabels[gift]}</span>)}</div></div></div></section><section className="style-section"><div className="section-title"><span>04</span><h2>Layout previews</h2></div><div className="layout-previews"><div className="mini-preview preview-360"><Scene state={{ ...state, safe: false, preview360: true }} isLive /></div><div className="contrast-preview"><span>Grayscale contrast</span><div className="contrast-swatch contrast-dark" /><div className="contrast-swatch contrast-mid" /><div className="contrast-swatch contrast-light" /></div></div></section></main>;
}

interface RendererTimeline {
  commandId: string;
  requestId: string;
  viewer: { displayName: string };
  question?: string;
  audioUrl: string;
  durationMs: number;
  cards: Array<{ id: string; orientation: "upright" | "reversed" }>;
  cues: Array<{ atMs: number; type: string; payload?: unknown }>;
}

interface RendererServerMessage {
  type: string;
  sequence?: number;
  commandId?: string;
  requestId?: string;
  timeline?: RendererTimeline;
  audioUrl?: string;
  durationMs?: number;
  title?: string;
  subtitle?: string;
  characterState?: string;
  effect?: string;
  status?: { current?: Record<string, unknown> | null; queue?: unknown[] };
  kind?: string;
  name?: string;
  detail?: string;
  viewerCount?: number;
  cardId?: string;
}

function rendererSocketUrl(): string {
  const protocol = location.protocol === "https:" ? "wss" : "ws";
  return `${protocol}://${location.hostname}:3001/ws/renderer`;
}

function useLiveRenderer(enabled: boolean, controller: VisualController): void {
  const socketRef = useRef<WebSocket | null>(null);
  const commandRef = useRef<string | undefined>(undefined);
  const timerRefs = useRef<number[]>([]);
  const heartbeatRef = useRef<number | undefined>(undefined);
  const progressRef = useRef<number | undefined>(undefined);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const ctaAudioRef = useRef<HTMLAudioElement | null>(null);
  const interactionAudioRef = useRef<HTMLAudioElement | null>(null);
  const audioUnlockRef = useRef<(() => void) | undefined>(undefined);

  useEffect(() => {
    if (!enabled) return;
    let disposed = false;
    let reconnectRef: number | undefined;

    const send = (message: Record<string, unknown>) => {
      const socket = socketRef.current;
      if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify(message));
    };

    const stopCta = () => {
      if (ctaAudioRef.current) {
        ctaAudioRef.current.pause();
        ctaAudioRef.current.removeAttribute("src");
        ctaAudioRef.current.load();
        ctaAudioRef.current = null;
      }
      if (!commandRef.current) {
        controller.setSpeaking(false);
        controller.setCharacterState("idle");
        controller.setStatus("phase:waiting");
      }
    };

    const stopInteractionSpeech = (notify = true) => {
      const interactionAudio = interactionAudioRef.current;
      if (interactionAudio) {
        interactionAudio.pause();
        interactionAudio.removeAttribute("src");
        interactionAudio.load();
        interactionAudioRef.current = null;
        if (notify) send({ type: "INTERACTION_ERROR", error: "interrupted" });
      }
      if (!commandRef.current) {
        controller.setSpeaking(false);
        controller.setCharacterState("idle");
        controller.setStatus("phase:waiting");
      }
    };

    const clearPlayback = () => {
      stopCta();
      stopInteractionSpeech();
      for (const timer of timerRefs.current) window.clearTimeout(timer);
      timerRefs.current = [];
      if (heartbeatRef.current !== undefined) window.clearInterval(heartbeatRef.current);
      if (progressRef.current !== undefined) window.clearInterval(progressRef.current);
      heartbeatRef.current = undefined;
      progressRef.current = undefined;
      if (audioUnlockRef.current) {
        document.removeEventListener("pointerdown", audioUnlockRef.current);
        audioUnlockRef.current = undefined;
      }
      if (audioRef.current) {
        audioRef.current.pause();
        audioRef.current.removeAttribute("src");
        audioRef.current.load();
      }
      audioRef.current = null;
      commandRef.current = undefined;
    };

    const showTimeline = (timeline: RendererTimeline) => {
      controller.resetCards();
      controller.setViewer(timeline.viewer.displayName, timeline.question ?? "");
      controller.setSpeaking(false);
      controller.setCharacterState("listening");
      controller.setStatus("phase:preparing");
      const prepareTimer = window.setTimeout(() => controller.setCharacterState("shuffling"), 600);
      timerRefs.current.push(prepareTimer);
    };

    const playTimeline = (timeline: RendererTimeline) => {
      clearPlayback();
      commandRef.current = timeline.commandId;
      showTimeline(timeline);
      const count = timeline.cards.length;
      const spread = count === 1 || count === 3 || count === 5 || count === 6 || count === 7 ? count : Math.max(1, Math.min(7, count)) as 1 | 3 | 5 | 6 | 7;
      send({ type: "STARTED", commandId: timeline.commandId });
      const playbackStartedAt = performance.now();

      const finishAt = Math.max(timeline.durationMs, ...timeline.cues.map((cue) => cue.atMs + 1200), 10000);
      const finish = () => {
        if (commandRef.current !== timeline.commandId) return;
        clearPlayback();
        send({ type: "COMPLETED", commandId: timeline.commandId });
        controller.setSpeaking(false);
        controller.setCharacterState("grateful");
        controller.setStatus("phase:complete");
      };

      for (const cue of [...timeline.cues].sort((left, right) => left.atMs - right.atMs)) {
        const timer = window.setTimeout(() => {
          if (commandRef.current !== timeline.commandId) return;
          const payload = cue.payload && typeof cue.payload === "object" ? cue.payload as Record<string, unknown> : {};
          if (cue.type === "SHOW_VIEWER") {
            controller.setViewer(String(payload.displayName ?? timeline.viewer.displayName), timeline.question ?? "");
          } else if (cue.type === "SHUFFLE") {
            controller.setSpeaking(false);
            controller.setCharacterState("shuffling");
            controller.setStatus("phase:shuffling");
            const dealTimer = window.setTimeout(() => controller.showCards(spread), 550);
            timerRefs.current.push(dealTimer);
          } else if (cue.type === "DEAL") {
            controller.showCards(spread);
          } else if (cue.type === "REVEAL_CARD") {
            const cardId = typeof payload.id === "string" ? payload.id : undefined;
            const orientation = payload.orientation === "reversed" ? "reversed" : "upright";
            const index = timeline.cards.findIndex((card) => card.id === cardId);
            if (index >= 0) {
              controller.setStatus("phase:revealing");
              controller.revealCard(index, cardId, orientation);
            }
          } else if (cue.type === "AVATAR_STATE") {
            const state = String(payload.state ?? "speaking");
            const nextState = state === "reading" ? "speaking" : states.includes(state as CharacterState) ? state as CharacterState : "speaking";
            // Deliberately does not call setSpeaking(true): the cue fires on a timer,
            // and audio may be buffering or blocked behind an autoplay gate. The
            // element's own `playing` event owns the flag now.
            if (nextState === "speaking") controller.setStatus("phase:reading");
            else {
              controller.setSpeaking(false);
              controller.setCharacterState(nextState);
            }
          }
        }, Math.max(0, cue.atMs));
        timerRefs.current.push(timer);
      }

      if (!timeline.cues.some((cue) => cue.type === "SHUFFLE" || cue.type === "DEAL")) {
        const fallbackDealTimer = window.setTimeout(() => controller.showCards(spread), 900);
        timerRefs.current.push(fallbackDealTimer);
      }

      heartbeatRef.current = window.setInterval(() => send({ type: "HEARTBEAT", commandId: timeline.commandId }), 5000);
      progressRef.current = window.setInterval(() => send({ type: "PROGRESS", commandId: timeline.commandId, atMs: Math.min(finishAt, Math.round(performance.now() - playbackStartedAt)) }), 1000);

      if (timeline.audioUrl) {
        const apiProtocol = location.protocol === "https:" ? "https" : "http";
        const audioUrl = timeline.audioUrl.startsWith("http") ? timeline.audioUrl : `${apiProtocol}://${location.hostname}:3001${timeline.audioUrl}`;
        const audio = new Audio(audioUrl);
        audio.preload = "auto";
        audio.volume = 1;
        audio.onplaying = () => controller.setStatus("phase:reading");
        audio.onended = finish;
        audio.onerror = () => {
          if (commandRef.current !== timeline.commandId) return;
          controller.setStatus("No se pudo cargar el audio de la lectura");
          send({ type: "ERROR", commandId: timeline.commandId, error: "audio_load_failed" });
          clearPlayback();
          console.error("Reading audio failed to load", audioUrl);
        };
        audioRef.current = audio;
        bindSpeech(audio, audioUrl, (active) => { if (commandRef.current === timeline.commandId) controller.setSpeaking(active); });
        const readingStartAt = timeline.cues.find((cue) => cue.type === "AVATAR_STATE" && typeof cue.payload === "object" && cue.payload !== null && (cue.payload as Record<string, unknown>).state === "reading")?.atMs ?? 0;
        const retryAfterUserGesture = () => {
          void audio.play().then(() => {
            if (audioUnlockRef.current === retryAfterUserGesture) {
              document.removeEventListener("pointerdown", retryAfterUserGesture);
              audioUnlockRef.current = undefined;
            }
          }).catch(() => {
            controller.setStatus("Haz clic otra vez para activar el audio");
          });
        };
        const startAudio=()=>{if(commandRef.current!==timeline.commandId)return;void audio.play().catch(() => {
            audioUnlockRef.current = retryAfterUserGesture;
            document.addEventListener("pointerdown", retryAfterUserGesture);
            controller.setStatus("Haz clic en la pantalla para activar el audio");
            console.warn("Reading audio autoplay was blocked", audioUrl);
            const autoplayFailureTimer=window.setTimeout(()=>{
              if(commandRef.current!==timeline.commandId||!audio.paused)return;
              send({type:"ERROR",commandId:timeline.commandId,error:"audio_autoplay_blocked"});
              clearPlayback();
            },5000);
            timerRefs.current.push(autoplayFailureTimer);
          });};
        const audioStartTimer=window.setTimeout(startAudio,Math.max(0,readingStartAt));
        timerRefs.current.push(audioStartTimer);
      } else {
        send({ type: "ERROR", commandId: timeline.commandId, error: "missing_audio_url" });
        clearPlayback();
      }
    };

    const applySnapshot = (message: RendererServerMessage) => {
      const current = message.status?.current;
      if (!current || current.status !== "PLAYING") {
        controller.resetScene();
        return;
      }
      const displayName = typeof current.displayName === "string" ? current.displayName : "";
      const question = typeof current.safeQuestion === "string" ? current.safeQuestion : typeof current.question === "string" ? current.question : "";
      if (displayName) controller.setViewer(displayName, question);
      const cards = Array.isArray(current.cards) ? current.cards as Array<{ id?: unknown; orientation?: unknown }> : [];
      if (cards.length) {
        const count = cards.length === 1 || cards.length === 3 || cards.length === 5 || cards.length === 6 || cards.length === 7 ? cards.length : Math.max(1, Math.min(7, cards.length)) as 1 | 3 | 5 | 6 | 7;
        controller.showCards(count);
        cards.forEach((card, index) => { if (typeof card.id === "string") controller.revealCard(index, card.id, card.orientation === "reversed" ? "reversed" : "upright"); });
      }
      if (current.status === "PLAYING") {
        controller.setCharacterState("speaking");
        controller.setSpeaking(true);
      }
    };

    const connect = () => {
      if (disposed) return;
      const socket = new WebSocket(rendererSocketUrl());
      socketRef.current = socket;
      socket.onopen = () => send({ type: "READY", sequence: 0 });
      socket.onmessage = (event) => {
        if (typeof event.data !== "string") return;
        let message: RendererServerMessage;
        try { message = JSON.parse(event.data) as RendererServerMessage; } catch { return; }
        if (message.type === "SNAPSHOT") applySnapshot(message);
        if ((message.type === "PREPARE_READING" || message.type === "PLAY_READING") && message.timeline) {
          if (message.type === "PREPARE_READING") {
            stopCta();
            stopInteractionSpeech();
            showTimeline(message.timeline);
          }
          else playTimeline(message.timeline);
        }
        if (message.type === "PLAY_CTA" && message.audioUrl && !commandRef.current && !interactionAudioRef.current) {
          stopCta();
          const characterState=states.includes(message.characterState as CharacterState)?message.characterState as CharacterState:"listening";
          const effect=gifts.includes(message.effect as GiftEffect)?message.effect as GiftEffect:undefined;
          const apiProtocol = location.protocol === "https:" ? "https" : "http";
          const ctaUrl = message.audioUrl.startsWith("http") ? message.audioUrl : `${apiProtocol}://${location.hostname}:3001${message.audioUrl}`;
          const ctaAudio = new Audio(ctaUrl);
          ctaAudio.preload = "auto";
          ctaAudio.volume = 1;
          bindSpeech(ctaAudio, ctaUrl, (active) => { if (ctaAudioRef.current === ctaAudio) controller.setSpeaking(active, true); });
          ctaAudio.onplaying = () => {
            if (ctaAudioRef.current !== ctaAudio || commandRef.current) return;
            controller.setCharacterState(characterState);
            if(effect) controller.triggerGiftEffect(effect);
          };
          ctaAudio.onended = () => {
            if (ctaAudioRef.current !== ctaAudio) return;
            ctaAudioRef.current = null;
            controller.setSpeaking(false);
            controller.setCharacterState("idle");
            controller.setStatus("phase:waiting");
          };
          ctaAudio.onerror = () => {
            if (ctaAudioRef.current === ctaAudio) ctaAudioRef.current = null;
            controller.setSpeaking(false);
            controller.setCharacterState("idle");
            console.error("CTA audio failed to load", ctaUrl);
          };
          ctaAudioRef.current = ctaAudio;
          void ctaAudio.play().catch(() => {
            if (ctaAudioRef.current === ctaAudio) ctaAudioRef.current = null;
            controller.setSpeaking(false);
            controller.setCharacterState("idle");
            console.warn("CTA audio autoplay was blocked", ctaUrl);
          });
        }
        if (message.type === "PLAY_TAROT_FOCUS" && message.audioUrl && message.cardId && !commandRef.current && !interactionAudioRef.current) {
          stopCta();
          controller.showInteraction(
            message.title ?? "Carta en foco",
            message.subtitle ?? "Un símbolo del tarot para observar juntos",
            "mysterious",
            gifts.includes(message.effect as GiftEffect) ? message.effect as GiftEffect : "card-orbit",
            Math.max(8_000, (message.durationMs ?? 8_000) + 4_000),
          );
          controller.showCards(1);
          const revealTimer = window.setTimeout(() => controller.revealCard(0, message.cardId, "upright"), 1_950);
          timerRefs.current.push(revealTimer);
          const apiProtocol = location.protocol === "https:" ? "https" : "http";
          const focusUrl = message.audioUrl.startsWith("http") ? message.audioUrl : `${apiProtocol}://${location.hostname}:3001${message.audioUrl}`;
          const focusAudio = new Audio(focusUrl);
          focusAudio.preload = "auto";
          focusAudio.volume = 1;
          bindSpeech(focusAudio, focusUrl, (active) => { if (ctaAudioRef.current === focusAudio) controller.setSpeaking(active, true); });
          focusAudio.onended = () => {
            if (ctaAudioRef.current !== focusAudio) return;
            ctaAudioRef.current = null;
            controller.setSpeaking(false);
            controller.setCharacterState("grateful");
            const resetTimer = window.setTimeout(() => controller.resetCards(), 1_600);
            timerRefs.current.push(resetTimer);
          };
          focusAudio.onerror = () => {
            if (ctaAudioRef.current === focusAudio) ctaAudioRef.current = null;
            controller.setSpeaking(false);
            controller.resetCards();
            console.error("Tarot focus audio failed to load", focusUrl);
          };
          ctaAudioRef.current = focusAudio;
          const playTimer = window.setTimeout(() => {
            if (ctaAudioRef.current !== focusAudio || commandRef.current) return;
            void focusAudio.play().catch(() => {
              if (ctaAudioRef.current === focusAudio) ctaAudioRef.current = null;
              controller.setSpeaking(false);
              controller.resetCards();
              console.warn("Tarot focus audio autoplay was blocked", focusUrl);
            });
          }, 1_650);
          timerRefs.current.push(playTimer);
        }
        if (message.type === "PLAY_INTERACTION_TTS" && message.audioUrl && !commandRef.current) {
          stopCta();
          stopInteractionSpeech(false);
          const interactionCharacterState = states.includes(message.characterState as CharacterState) ? message.characterState as CharacterState : "grateful";
          const interactionEffect = gifts.includes(message.effect as GiftEffect) ? message.effect as GiftEffect : undefined;
          const apiProtocol = location.protocol === "https:" ? "https" : "http";
          const interactionUrl = message.audioUrl.startsWith("http") ? message.audioUrl : `${apiProtocol}://${location.hostname}:3001${message.audioUrl}`;
          const interactionAudio = new Audio(interactionUrl);
          interactionAudio.preload = "auto";
          interactionAudio.volume = 1;
          bindSpeech(interactionAudio, interactionUrl, (active) => { if (interactionAudioRef.current === interactionAudio) controller.setSpeaking(active); });
          interactionAudio.onplaying = () => {
            if (interactionAudioRef.current !== interactionAudio || commandRef.current) return;
            controller.setCharacterState(interactionCharacterState);
            if (interactionEffect) controller.triggerGiftEffect(interactionEffect);
          };
          interactionAudio.onended = () => {
            if (interactionAudioRef.current !== interactionAudio) return;
            interactionAudioRef.current = null;
            controller.setSpeaking(false);
            controller.setCharacterState("idle");
            controller.setStatus("phase:waiting");
            send({ type: "INTERACTION_COMPLETED" });
          };
          interactionAudio.onerror = () => {
            if (interactionAudioRef.current !== interactionAudio) return;
            interactionAudioRef.current = null;
            controller.setSpeaking(false);
            controller.setCharacterState("idle");
            send({ type: "INTERACTION_ERROR", error: "audio_load_failed" });
            console.error("Interaction audio failed to load", interactionUrl);
          };
          interactionAudioRef.current = interactionAudio;
          void interactionAudio.play().catch(() => {
            if (interactionAudioRef.current !== interactionAudio) return;
            interactionAudioRef.current = null;
            controller.setSpeaking(false);
            controller.setCharacterState("idle");
            send({ type: "INTERACTION_ERROR", error: "audio_autoplay_blocked" });
            console.warn("Interaction audio autoplay was blocked", interactionUrl);
          });
        }
        if(message.type==="VIEWER_INTERACTION"&&message.title&&!commandRef.current) {
          stopCta();
          const characterState=states.includes(message.characterState as CharacterState)?message.characterState as CharacterState:"listening";
          const effect=gifts.includes(message.effect as GiftEffect)?message.effect as GiftEffect:undefined;
          controller.showInteraction(message.title,message.subtitle??"",characterState,effect,message.durationMs);
        }
        // Ambient audience feedback. Deliberately independent of playback so it keeps
        // running underneath a reading — that continuous, name-bearing motion is what
        // separates a live scene from a looping one.
        if (message.type === "VIEWER_PULSE" && pulseKinds.includes(message.kind as PulseKind)) {
          const name = typeof message.name === "string" ? message.name.trim().slice(0, 22) : "";
          if (name) controller.pushViewerPulse(message.kind as PulseKind, name, typeof message.detail === "string" ? message.detail.slice(0, 28) : "");
        }
        if(message.type==="ROOM_STATS"&&Number.isFinite(Number(message.viewerCount)))controller.setViewerCount(Math.max(0,Math.floor(Number(message.viewerCount))));
        if (message.type === "RESET") {
          clearPlayback();
          controller.resetScene();
        }
        if (message.type === "PAUSE") {
          stopCta();
          stopInteractionSpeech();
          audioRef.current?.pause();
          controller.setSpeaking(false);
          controller.setStatus("Lectura en pausa");
        }
      };
      socket.onclose = () => {
        if (socketRef.current === socket) socketRef.current = null;
        clearPlayback();
        controller.resetScene();
        if (!disposed) reconnectRef = window.setTimeout(connect, 1500);
      };
      socket.onerror = () => socket.close();
    };

    connect();
    return () => {
      disposed = true;
      if (reconnectRef !== undefined) window.clearTimeout(reconnectRef);
      clearPlayback();
      socketRef.current?.close();
      socketRef.current = null;
    };
  }, [controller, enabled]);
}

function initialSceneState(): SceneState {
  const locale = resolveRendererLocale(new URLSearchParams(location.search).get("locale") ?? document.documentElement.lang);
  return { characterState: "idle", phase: "waiting", deckStage: "stacked", locale, viewer: "", question: "", status: "", customTitle: "", customSubtitle: "", viewerCount:0, cards: [], speaking: false, mouthLevel: 0, gift: null, safe: false, eyeOverride: null, speed: 1, faceHidden: false, preview360: false, pulses: [], reaction: null };
}

function App() {
  const route = location.pathname;
  const isLive = route === "/live" || route === "/";
  const isStyleGuide = route === "/style-guide";
  const [state, setState] = useState<SceneState>(initialSceneState);
  const stateRef = useRef(state);
  const giftTimer = useRef<number | undefined>(undefined);
  const interactionTimer = useRef<number | undefined>(undefined);
  const deckTimers = useRef<number[]>([]);
  const dealStartedAt = useRef(0);
  const pulseTimers = useRef<number[]>([]);
  const pulseId = useRef(0);
  const clearPulseTimers = useCallback(() => { for (const timer of pulseTimers.current) window.clearTimeout(timer); pulseTimers.current = []; }, []);
  const update = useCallback((patch: Partial<SceneState>) => setState((current) => { const next = { ...current, ...patch }; stateRef.current = next; return next; }), []);
  const clearDeckTimers = useCallback(() => { for (const timer of deckTimers.current) window.clearTimeout(timer); deckTimers.current = []; }, []);
  const scheduleDeck = useCallback((delay: number, patch: Partial<SceneState>) => {
    const timer = window.setTimeout(() => update(patch), delay);
    deckTimers.current.push(timer);
  }, [update]);
  const startShuffle = useCallback(() => {
    clearDeckTimers();
    dealStartedAt.current = 0;
    const hasDealtCards = stateRef.current.cards.length > 0;
    update({ characterState: "shuffling", speaking: false, phase: "shuffling", deckStage: hasDealtCards ? "gathering" : "shuffling" });
    if (hasDealtCards) scheduleDeck(380, { cards: [], deckStage: "shuffling" });
  }, [clearDeckTimers, scheduleDeck, update]);
  const dealCards = useCallback((count: 1 | 3 | 5 | 6 | 7) => {
    clearDeckTimers();
    dealStartedAt.current = performance.now();
    update({ cards: initialCards(count), phase: "shuffling", characterState: "shuffling", deckStage: "finishing" });
    scheduleDeck(650, { deckStage: "squaring" });
    scheduleDeck(900, { deckStage: "flourish" });
    scheduleDeck(1500, { deckStage: "dealing" });
    const finishAt = 1500 + count * 260 + 280;
    const timer = window.setTimeout(() => setState((current) => {
      const next: SceneState = { ...current, deckStage: "dealt", phase: current.phase === "revealing" ? "revealing" : "reading", characterState: current.speaking ? "speaking" : "idle" };
      stateRef.current = next;
      return next;
    }), finishAt);
    deckTimers.current.push(timer);
  }, [clearDeckTimers, scheduleDeck, update]);
  const revealCard = useCallback((index: number, cardId?: string, orientation: CardOrientation = "upright") => {
    const applyReveal = () => setState((current) => {
      const next: SceneState = { ...current, phase: "revealing", cards: current.cards.map((card, i) => i === index ? { ...card, id: cardId ?? card.id, orientation, revealed: true, selected: true } : { ...card, selected: false }) };
      stateRef.current = next;
      return next;
    });
    if (stateRef.current.deckStage !== "dealt" && dealStartedAt.current) {
      const cardLandingAt = 1500 + index * 260 + 430;
      const remaining = cardLandingAt - (performance.now() - dealStartedAt.current);
      if (remaining > 0) {
        const timer = window.setTimeout(applyReveal, remaining);
        deckTimers.current.push(timer);
        return;
      }
    }
    applyReveal();
  }, []);
  const resetCards = useCallback(() => {
    clearDeckTimers();
    dealStartedAt.current = 0;
    update({ deckStage: "gathering", phase: "waiting", characterState: "idle", speaking: false });
    scheduleDeck(380, { cards: [], deckStage: "stacked" });
  }, [clearDeckTimers, scheduleDeck, update]);
  const resetScene = useCallback(() => {
    clearDeckTimers();
    clearPulseTimers();
    window.clearTimeout(interactionTimer.current);
    dealStartedAt.current = 0;
    const next = initialSceneState();
    next.locale = stateRef.current.locale;
    stateRef.current = next;
    setState(next);
  }, [clearDeckTimers, clearPulseTimers]);
  const controller = useMemo<VisualController>(() => ({
    setCharacterState: (characterState) => {
      if (characterState === "shuffling") startShuffle();
      else update({ characterState, ...(characterState === "speaking" && stateRef.current.deckStage === "dealt" ? { phase: "reading" as const } : {}) });
    },
    setViewer: (viewer, question = "") => { window.clearTimeout(interactionTimer.current); update({ viewer, question, phase: "preparing", customTitle: "", customSubtitle: "" }); },
    setStatus: (status) => {
      const requestedPhase = status.startsWith("phase:") ? status.slice(6) as VisualPhase : null;
      update({ status, ...(requestedPhase && visualPhases.includes(requestedPhase) ? { phase: requestedPhase, customTitle: "", customSubtitle: "" } : {}) });
    },
    setViewerCount:(viewerCount)=>update({viewerCount}),
    showInteraction: (customTitle, customSubtitle, characterState="listening", effect, durationMs=4500) => {
      window.clearTimeout(interactionTimer.current);
      update({customTitle,customSubtitle,characterState,speaking:false,...(effect?{gift:effect}:{})});
      interactionTimer.current=window.setTimeout(()=>update({customTitle:"",customSubtitle:"",characterState:"idle",gift:null,phase:"waiting"}),Math.max(1500,Math.min(10_000,durationMs)));
    },
    showCards: dealCards,
    revealCard,
    resetCards,
    triggerGiftEffect: (effect) => { const gift = effect in legacyGiftMap ? legacyGiftMap[effect as LegacyGiftEffect] : effect as GiftEffect; update({ gift }); window.clearTimeout(giftTimer.current); giftTimer.current = window.setTimeout(() => update({ gift: null }), 3600); },
    pushViewerPulse: (kind, name, detail = "") => {
      const id = (pulseId.current += 1);
      setState((current) => {
        // Only the newest few chips stay on screen; the rail must not grow into the mascot.
        const next: SceneState = { ...current, pulses: [...current.pulses, { id, kind, name, detail }].slice(-3), reaction: { id, kind, durationMs: kind === "gift" ? 1500 : 950 } };
        stateRef.current = next;
        return next;
      });
      const timer = window.setTimeout(() => setState((current) => {
        const next: SceneState = { ...current, pulses: current.pulses.filter((pulse) => pulse.id !== id), reaction: current.reaction?.id === id ? null : current.reaction };
        stateRef.current = next;
        return next;
      }), PULSE_LIFETIME_MS);
      pulseTimers.current.push(timer);
      if (pulseTimers.current.length > 24) pulseTimers.current.splice(0, pulseTimers.current.length - 24);
    },
    setSpeaking: (speaking, preserveVisualState=false) => setState((current) => {
      const next: SceneState = { ...current, speaking, characterState: speaking ? (preserveVisualState ? current.characterState : current.phase === "shuffling" ? "shuffling" : "speaking") : current.characterState === "speaking" ? "idle" : current.characterState, ...(speaking && current.deckStage === "dealt" ? { phase: "reading" as const } : {}) };
      stateRef.current = next;
      return next;
    }),
    setMouthLevel: (mouthLevel) => update({ mouthLevel: Math.max(0, Math.min(1, mouthLevel)) }),
    resetScene,
  }), [dealCards, resetCards, resetScene, revealCard, startShuffle, update]);
  useEffect(() => { stateRef.current = state; }, [state]);
  useEffect(() => { window.visualController = controller; return () => { delete window.visualController; window.clearTimeout(giftTimer.current); window.clearTimeout(interactionTimer.current); clearDeckTimers(); clearPulseTimers(); }; }, [clearDeckTimers, clearPulseTimers, controller]);
  useLiveRenderer(isLive, controller);
  if (isStyleGuide) return <StyleGuide state={state} update={update} />;
  return <div className={`app-shell ${isLive ? "is-live" : "is-test"} ${state.preview360 ? "preview-360" : ""}`}><Scene state={state} isLive={isLive} />{!isLive && <RendererTestPanel state={state} update={update} controller={controller} />}</div>;
}

createRoot(document.getElementById("root")!).render(<App />);

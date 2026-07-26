import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const renderer = readFileSync(resolve("apps/renderer/src/main.tsx"), "utf8");
const server = readFileSync(resolve("apps/server/src/index.ts"), "utf8");
const styles = readFileSync(resolve("apps/renderer/src/styles.css"), "utf8");
const messages = readFileSync(resolve("apps/renderer/src/messages.ts"), "utf8");

describe("renderer visual contract", () => {
  it("contains the replaceable barn-owl rig layers", () => {
    const requiredLayers = [
      "layer-shadow", "layer-ambient-glow", "layer-tail", "layer-rear-body-feathers", "layer-left-rear-wing",
      "layer-right-rear-wing", "layer-main-body", "layer-chest-glow", "layer-chest-feathers", "layer-facial-disk",
      "layer-left-eye", "layer-right-eye", "layer-left-brow", "layer-right-brow", "layer-beak-upper", "layer-beak-lower",
      "layer-left-front-wing", "layer-right-front-wing", "layer-left-feather-tips", "layer-right-feather-tips",
      "layer-left-talon", "layer-right-talon", "layer-crest", "layer-gold-markings", "layer-foreground-effects",
    ];
    // The source keeps the rig groups explicit so assets can be replaced independently.
    for (const layer of requiredLayers) expect(renderer).toContain(layer);
  });

  it("keeps all controller states and current/new gift names", () => {
    for (const state of ["idle", "listening", "thinking", "shuffling", "speaking", "happy", "surprised", "grateful", "mysterious", "sleepy", "error"]) expect(renderer).toContain(`"${state}"`);
    for (const gift of ["golden-plumage", "radiant-wings", "heart-glow", "luminous-feathers", "card-orbit", "constellation-markings", "wing-embrace", "grand-reveal"]) expect(renderer).toContain(`"${gift}"`);
    expect(renderer).toContain("legacyGiftMap");
    expect(renderer).toContain("window.visualController");
  });

  it("keeps the simplified owl motion language wired to real rig parts", () => {
    expect(styles).toContain("@keyframes mascot-bob");
    expect(styles).toContain("@keyframes wing-paddle-left");
    expect(styles).toContain("@keyframes wing-paddle-right");
    expect(styles).toContain("@keyframes talk-bob");
    expect(styles).toContain("@keyframes talk-wing-left");
    // The owl-local shuffle-card rig was superseded by the full-deck riffle below; both
    // drew into the same box, so only the deck version survives.
    expect(styles).not.toContain("shuffle-card");
    expect(styles).toContain("@keyframes deck-cycle-left");
    expect(styles).toContain("@keyframes deck-cycle-right");
    expect(styles).toContain("@keyframes deck-overhand");
    expect(styles).toContain("@keyframes deal-card");
    expect(styles).toContain("@keyframes gather-card");
    expect(renderer).toContain('className={`rig-layer layer-beak-lower beak-${beak}`}');
    expect(renderer).toContain("2000 + Math.random() * 4000");
    expect(renderer).toContain("className=\"full-deck\"");
    expect(renderer).toContain('data-deck-stage={state.deckStage}');
  });

  it("drives the beak continuously from the real TTS waveform",()=>{
    // The clunkiness was quantisation: the beak snapped between three fixed positions.
    // It is one continuous shape now, so the bucket classes must be gone.
    for(const bucket of ["beak-slightly-open","beak-medium-open","beak-wide-open"]) {
      expect(styles).not.toContain(bucket);
      expect(renderer).not.toContain(bucket);
    }
    expect(renderer).not.toContain("setViseme");
    expect(styles).toMatch(/\.beak-speaking path\{transition:none;[^}]*translateY\(calc\(var\(--mouth,0\)/);
    // Upper mandible and throat move too, or an open beak reads as a detached chin.
    expect(styles).toMatch(/\.layer-beak-upper path\{[^}]*var\(--mouth,0\)/);
    expect(styles).toContain(".layer-mouth-inner path");
    expect(renderer).toContain('className="rig-layer layer-mouth-inner"');
    // Per-frame value goes to a CSS property, never through setState - React would
    // re-render the background, roam and deck sixty times a second.
    expect(renderer).toContain('document.documentElement.style.setProperty("--mouth"');
    expect(renderer).toContain("requestAnimationFrame(tick)");
  });

  it("hangs the speaking flag off audio that is actually playing",()=>{
    // `play` fires on the request, `playing` when sound starts; the gap between them is
    // the autoplay-blocked case where Mora used to mouth at an empty room.
    expect(renderer).toContain('audio.addEventListener("playing"');
    expect(renderer).toContain('audio.addEventListener("pause", stop)');
    expect(renderer).toContain('audio.addEventListener("ended", stop)');
    expect(renderer).not.toMatch(/\.onplay =/);
    // Buffering blips must not toggle the flag - they would snap the beak shut and open.
    expect(renderer).not.toContain('addEventListener("waiting"');
    expect(renderer).not.toContain('addEventListener("stalled"');
    // All three TTS routes bind it: the reading, the CTA and the interaction reply.
    expect(renderer.match(/bindSpeech\(/g)?.length).toBe(4);
    // The AVATAR_STATE cue fires on a timer, so it must no longer assert speech.
    const cue = renderer.slice(renderer.indexOf('cue.type === "AVATAR_STATE"'), renderer.indexOf("}, Math.max(0, cue.atMs));"));
    expect(cue).not.toContain("controller.setSpeaking(true)");
    expect(cue).toContain('controller.setStatus("phase:reading")');
  });

  it("keeps the decoded envelope out of the broadcast audio path",()=>{
    // Routing the <audio> element through WebAudio would put a graph in the stream's
    // output, where a suspended context or a missed destination connection is silence.
    expect(renderer).not.toMatch(/\.createMediaElementSource\(/);
    expect(renderer).not.toMatch(/crossOrigin\s*=/);
    expect(renderer).toContain("decodeAudioData");
    // The bundled local speech provider emits correctly formed but silent wavs, so a
    // successful decode is not proof of a usable envelope.
    expect(renderer).toContain("if (peak < 1e-4) return null;");
    expect(renderer).toContain("syntheticAperture");
  });

  it("starts shuffling as soon as a reading is prepared", () => {
    const preparation = renderer.slice(renderer.indexOf("const showTimeline"), renderer.indexOf("const playTimeline"));
    expect(preparation).toContain('setCharacterState("listening")');
    expect(preparation).toContain('setCharacterState("shuffling")');
    expect(preparation).toContain("setSpeaking(false)");
    expect(preparation).toContain('setStatus("phase:preparing")');
  });

  it("plays paid CTA speech only on the idle lane and stops it before reading audio",()=>{
    expect(renderer).toContain('message.type === "PLAY_CTA"');
    expect(renderer).toContain("const stopCta");
    const preparation=renderer.slice(renderer.indexOf('message.type === "PREPARE_READING"'),renderer.indexOf('message.type === "PLAY_CTA"'));
    expect(preparation).toContain("stopCta()");
    expect(renderer).toContain("!commandRef.current");
    expect(renderer).toContain("preserveVisualState");
    expect(renderer).toContain("controller.triggerGiftEffect(effect)");
  });

  it("plays short interaction TTS on the idle lane and acknowledges completion",()=>{
    expect(renderer).toContain('message.type === "PLAY_INTERACTION_TTS"');
    expect(renderer).toContain('type: "INTERACTION_COMPLETED"');
    expect(renderer).toContain('type: "INTERACTION_ERROR"');
    expect(renderer).toContain("const stopInteractionSpeech");
  });

  it("makes the production scene capture-only and cards controller-only", () => {
    expect(styles).toContain("#live-scene,#live-scene *{pointer-events:none");
    const cardComponent = renderer.slice(renderer.indexOf("function TarotCard"), renderer.indexOf("function TarotTable"));
    expect(cardComponent).not.toContain("onClick");
    expect(styles).toContain(".tarot-card{position:relative");
    expect(styles).toContain("flex:0 0 auto");
    expect(styles).toContain("height:auto;aspect-ratio:30/53");
    expect(styles).toContain("pointer-events:none");
  });

  it("renders the real bundled tarot artwork and honors reversed orientation",()=>{
    expect(renderer).toContain('import { tarotArtworkUrl } from "./tarotAssets.js"');
    expect(renderer).toContain('<img className="card-art"');
    expect(renderer).toContain('card.orientation === "reversed"');
    expect(styles).toContain(".tarot-card.is-reversed .card-art{transform:rotate(180deg)}");
  });

  it("uses the compact live hierarchy without legacy operational chrome", () => {
    const scene = renderer.slice(renderer.indexOf("function Scene"), renderer.indexOf("function TestPanel"));
    expect(scene).toContain("<LogoMark compact />");
    expect(scene).toContain("<PhaseMessage state={state} />");
    expect(scene).toContain("<TarotTable state={state} />");
    expect(scene).toContain("Escribe una pregunta para participar en el LIVE");
    expect(scene).toContain("Perfume · 1");
    expect(scene).toContain("Face-pulling · 7");
    expect(scene).toContain("Entretenimiento y reflexión personal");
    for (const legacy of ["live-pill", "LECTURA ABIERTA AHORA", "MAZO MORA", "table-caption", "reading-prompt", "card-number"]) {
      expect(scene).not.toContain(legacy);
    }
    expect(renderer).not.toContain("ambient-symbol");
    expect(styles).toContain(".background:before");
    expect(styles).toContain(".background:after");
  });

  it("rotates capture-safe mystical background scenes",()=>{
    for(const scene of ["velvet-cosmos","moon-phases","candle-altar","crystal-chamber","zodiac-wheel","arcane-library"]) expect(renderer).toContain(`"${scene}"`);
    // Rooms must be drawn from a shuffled bag, never a fixed (i+1) cycle: an identical
    // room order on every stream is exactly what reads as reproduced content.
    expect(renderer).toContain("function shuffled");
    expect(renderer).toContain("useShuffledRotation");
    expect(renderer).not.toContain("% backgroundScenes.length");
    // Room look and mascot persona rotate on independent schedules.
    expect(renderer).toContain("useShuffledRotation(backgroundScenes");
    expect(renderer).toContain("useShuffledRotation(personaLooks");
    for(const element of ["scenery-window","scenery-shelf","scenery-cauldron","scenery-crystal-ball","scenery-cabinet","persona-witch-hat","persona-crown","persona-glasses"]) expect(renderer).toContain(element);
    // The crown is a silhouette, a banded rim and set gems rather than one flat
    // sawtooth; the band is its own element so its underside can round onto the skull.
    expect(styles).toContain(".persona-crown:before");
    expect(styles).toContain(".persona-crown:after");
    expect(styles).not.toContain("background:#dfb864");
    expect(styles).toMatch(/\.persona-crown i\{[^}]*z-index:1/);
    expect(styles).toContain(".background-moon-phases");
    expect(styles).toContain(".background-candle-altar");
    expect(styles).toContain(".bg-quiet-band");
    expect(styles).toContain(".phase-message:before");
    expect(styles).toContain("@keyframes flame-flicker");
  });

  it("renders the atmosphere layer it styles",()=>{
    // Every one of these had full CSS, including animations, and no DOM node at all.
    for(const element of ["bg-moon","bg-sun","bg-zodiac-ring","bg-orbit","bg-stars","bg-candle","bg-crystal","bg-runes","bg-book","bg-mist","aurora-one","aurora-two"]) {
      expect(renderer).toContain(element);
      expect(styles).toContain(`.${element}`);
    }
    // Rooms cross-dissolve on stacked layers; a gradient stack cannot be transitioned.
    expect(renderer).toContain("bg-wash");
    expect(styles).toContain(".bg-wash{");
    expect(styles).not.toContain("transition:background 1600ms");
  });

  it("dresses every room from one wall, floor and key light",()=>{
    // A gradient stack cannot be transitioned, so the room band used to hard-cut while
    // the wash below it cross-faded. Registering the palette as <color> is what lets the
    // whole band dissolve; without @property these are inert and the cut comes back.
    for(const token of ["--wall-mid","--wall-low","--floor-far","--floor-near","--room-key","--room-rim","--room-accent"]){
      expect(styles).toContain(`@property ${token}{syntax:"<color>"`);
      expect(styles).toContain(`transition:--wall-mid 2200ms ease`);
    }
    for(const room of ["velvet-cosmos","moon-phases","candle-altar","crystal-chamber","zodiac-wheel","arcane-library"]){
      expect(styles).toMatch(new RegExp(`\\.background-${room}\\{--wall-mid:`));
    }
    expect(styles).toContain(".scenery-backwall");
    expect(styles).toContain(".scenery-drape");
    // Props live in the side gutters; Mora's wings span 31%-69% across the whole band.
    expect(styles).toContain(".scenery-shelf-left{left:1.5%");
    expect(styles).toContain(".scenery-shelf-right{right:1.5%");
  });

  it("removes the persona scarf without leaving a look empty",()=>{
    // The scarf sat across Mora's beak, and crystal-chamber wore nothing else, so the
    // replacement has to land in the same edit or that look renders bare.
    expect(renderer).not.toContain("persona-scarf");
    expect(styles).not.toContain("persona-scarf");
    expect(renderer).toContain("persona-pendant");
    expect(styles).toContain(".persona-crystal-chamber .persona-pendant");
  });

  it("randomises the atmosphere per mount instead of pinning it in CSS",()=>{
    // Fixed nth-child coordinates and fixed durations are the same frame on every
    // stream, which is the signature that reads as reproduced content.
    expect(renderer).toContain('"--star-x"');
    expect(renderer).toContain('"--ray-turn"');
    expect(renderer).toContain('"--aurora-one-duration"');
    expect(styles).toContain("@keyframes ray-breathe");
    expect(styles).not.toMatch(/\.bg-stars i:nth-child/);
  });

  it("walks Mora between anchors on an aperiodic schedule",()=>{
    expect(renderer).toContain("function useRoam");
    expect(renderer).toContain("perchSpots");
    expect(renderer).toContain("bag.current = shuffled(perchSpots)");
    expect(renderer).toContain('className="mora-roam"');
    expect(styles).toContain(".mora-roam");
    // Two identical arcs: re-setting the same animation-name would not retrigger it.
    expect(styles).toContain("@keyframes roam-hop-a");
    expect(styles).toContain("@keyframes roam-hop-b");
    // The room slides the other way, which doubles the apparent travel for free.
    expect(styles).toContain("var(--parallax-x,0%)");
    // ...and props answer which side she stepped toward.
    expect(styles).toContain('.background[data-roam="left"]');
    expect(styles).toContain('.background[data-roam="right"]');
  });

  it("hangs the deck off Mora rather than off the table",()=>{
    // The deck is hers: it renders inside .mora-roam, so it travels with her and the
    // roam never has to park for a shuffle. The table below carries the spread only.
    const roamBlock = renderer.slice(renderer.indexOf('<div className="mora-roam"'), renderer.indexOf("</section><PhaseMessage"));
    expect(roamBlock).toContain("mora-deck");
    expect(roamBlock).toContain("<FullDeck />");
    expect(renderer).toContain("useRoam()");
    expect(renderer).not.toContain("deckInWingStages");
    const table = renderer.slice(renderer.indexOf('className={`tarot-table'), renderer.indexOf("function ActivityRail"));
    expect(table).not.toContain("<FullDeck />");
    expect(styles).toContain(".mora-deck{position:absolute;right:20%;top:44%;width:9%");
  });

  it("keeps ambient motion above the TikTok chat zone",()=>{
    // .chat-zone starts at 66.6%; anything below it is covered by TikTok's own UI.
    const bandStarts=[...styles.matchAll(/\.bg-(?:candle|crystal|runes|book|mist)[a-z-]*\{[^}]*?top:(\d+(?:\.\d+)?)%/g)];
    expect(bandStarts.length).toBeGreaterThan(0);
    for(const match of bandStarts) expect(Number(match[1])).toBeLessThan(64);
  });

  it("emits named viewer pulses so the frame reacts to the audience",()=>{
    expect(renderer).toContain("pushViewerPulse");
    expect(renderer).toContain('message.type === "VIEWER_PULSE"');
    expect(renderer).toContain("activity-rail");
    for(const kind of ["comment","like","follow","gift","share"]) expect(renderer).toContain(`"${kind}"`);
    expect(styles).toContain(".pulse-chip");
    expect(styles).toContain("@keyframes pulse-chip-in");
    // A pulse nudges the mascot without replacing her scripted state animation.
    expect(styles).toContain(".owl-wrap.is-reacting .owl{animation:reaction-perk");
  });

  it("broadcasts a viewer pulse for every audience event kind",()=>{
    // FOLLOW previously had no branch at all, and LIKE only surfaced at the free-reading
    // grant threshold, so neither was ever visible on screen.
    expect(server).toContain('broadcastViewerPulse("follow"');
    expect(server).toContain('broadcastViewerPulse("like"');
    expect(server).toContain('broadcastViewerPulse("comment"');
    expect(server).toContain('broadcastViewerPulse("gift"');
    expect(server).toContain('type:"VIEWER_PULSE"');
    // Likes arrive in bursts, so each kind is rate-limited before it reaches the renderer.
    expect(server).toContain("pulseThrottleMs");
    expect(server).toMatch(/like:\s*2_600/);
  });

  it("cycles distinct idle Mora motions while preserving live-state priority",()=>{
    for(const motion of ["serene","curious","wing-wave","shuffle","cast","mystic","sleepy-sway"]) expect(renderer).toContain(`"${motion}"`);
    expect(renderer).toContain("data-idle-motion");
    expect(styles).toContain("@keyframes idle-curious");
    expect(styles).toContain("@keyframes idle-wave-left");
    expect(styles).toContain("@keyframes idle-shuffle-left");
    expect(styles).toContain("@keyframes idle-cast-left");
    expect(styles).toContain("@keyframes idle-mystic");
    expect(styles).toContain("@keyframes idle-sleepy-sway");
  });

  it("defines every visual phase in es-MX and pt-BR", () => {
    for (const phase of ["waiting", "preparing", "shuffling", "reading", "revealing", "complete"]) {
      expect(messages.match(new RegExp(`${phase}: \\{`, "g")) ?? []).toHaveLength(2);
    }
    for (const copy of [
      "Escribe tu pregunta",
      "Mora elegirá a alguien del chat",
      "Preparando la lectura de {name}",
      "Mezclando el mazo",
      "Leyendo para {name}",
      "Las cartas están revelando tu mensaje",
      "Lectura completada",
      "Gracias por compartir este momento",
    ]) expect(messages).toContain(copy);
  });

  it("renders a complete layered deck and controller-driven deal sequence", () => {
    expect(renderer).toContain("Array.from({ length: 24 }");
    expect(renderer).toContain('"gathering" | "shuffling" | "finishing" | "squaring" | "flourish" | "dealing" | "dealt"');
    expect(renderer).toContain('scheduleDeck(650, { deckStage: "squaring" })');
    expect(renderer).toContain('scheduleDeck(900, { deckStage: "flourish" })');
    expect(renderer).toContain('scheduleDeck(1500, { deckStage: "dealing" })');
    expect(renderer).toContain('scheduleDeck(380, { cards: [], deckStage: "stacked" })');
  });

  it("keeps critical reading content above the TikTok chat zone", () => {
    expect(renderer).toContain("TIKTOK CHAT ZONE · NON-CRITICAL UI ONLY");
    expect(styles).toContain(".phase-message{position:absolute;top:39%");
    expect(styles).toContain(".tarot-table{position:absolute;top:48%");
    expect(styles).toContain("height:16.5%");
    expect(styles).toContain(".chat-zone{position:absolute;top:66.666%");
    expect(styles).toContain(".scene-footer{position:absolute;top:84%");
  });

  it("moves the active full deck between Mora's front wings", () => {
    // The riffle is transform-only now that the deck already hangs at her wing, and the
    // deck walks in to centre for it so the shuffle happens in her hands, not at her side.
    expect(styles).toContain(".deck-shuffling .full-deck{animation:deck-overhand");
    expect(styles).toContain(".deck-finishing .full-deck{animation:deck-final-riffle");
    expect(styles).toContain(".mora-deck.deck-shuffling,.mora-deck.deck-finishing,.mora-deck.deck-squaring,.mora-deck.deck-flourish{right:45.5%;top:62%}");
    // Dealing and gathering stay at the wing, where --deal-x aims the card flight path.
    expect(styles).not.toContain(".mora-deck.deck-dealing");
    expect(styles).not.toContain(".mora-deck.deck-gathering");
    expect(styles).toContain(".state-shuffling .layer-left-front-wing");
    expect(styles).toContain(".state-shuffling .layer-right-front-wing");
  });

  it("keeps the remaining deck with Mora and gives every spread the full table", () => {
    expect(styles).toContain(".deck-dealing .full-deck,.deck-dealt .full-deck{transform:translate(-50%,-50%) scale(.86) rotate(6deg)}");
    expect(styles).toContain(".cards-row{position:absolute;left:1%;right:1%");
    expect(styles).toContain("width:min(15%,105px);height:auto;aspect-ratio:30/53");
    expect(styles).not.toContain(".cards-1 .tarot-card");
    expect(renderer).toContain('"--deal-x": `${dealOffset}%`');
    expect(styles).toContain("translate(var(--deal-x),-280%)");
  });

  it("supports the seven-card Face-pulling spread",()=>{
    expect(renderer).toContain("1 | 3 | 5 | 6 | 7");
    expect(renderer).toContain("Math.min(7, count)");
    expect(renderer).toContain('"justice"');
    expect(styles).toContain(".cards-7 .tarot-card{width:min(11.5%,80px)}");
  });

  it("preserves the established public visual-controller surface", () => {
    const controllerInterface = renderer.slice(renderer.indexOf("export interface VisualController"), renderer.indexOf("declare global"));
    for (const method of ["setCharacterState", "setViewer", "setStatus", "showCards", "revealCard", "resetCards", "triggerGiftEffect", "setSpeaking", "setMouthLevel", "resetScene"]) {
      expect(controllerInterface).toContain(method);
    }
    expect(controllerInterface).not.toContain("setPhase");
    expect(controllerInterface).not.toContain("setDeckStage");
  });

  it("keeps renderer test controls outside the live canvas", () => {
    expect(renderer).toContain("!isLive && <RendererTestPanel");
    for (const control of ["Visual phase", "Nombre corto", "Nombre largo", "Pregunta corta", "Pregunta larga", "360 × 640 preview", "Start full-deck shuffle", "Reset into complete deck"]) {
      expect(renderer).toContain(control);
    }
    expect(styles).toContain(".test-panel{position:sticky");
  });

  it("keeps the requested routes and style-guide previews", () => {
    expect(renderer).toContain('route === "/live"');
    expect(renderer).toContain('route === "/style-guide"');
    expect(renderer).toContain("Face hidden");
    expect(renderer).toContain("Grayscale contrast");
  });
});

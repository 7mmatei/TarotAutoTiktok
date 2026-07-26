import crypto from "node:crypto";
import { cards, type Card } from "./deck.js";

export type { Card } from "./deck.js";
export function allCards(): readonly Card[] { return cards; }
export function selectCards(sessionId: string, requestId: string, count: number, secret: string): { cards: Array<{id:string; orientation:"upright"|"reversed"; meaning:string}>; seedHash: string } {
  const seed = crypto.createHmac("sha256", secret).update(`${sessionId}\0${requestId}`).digest("hex");
  const pool = allCards(); const available = [...pool]; const selected: Array<{id:string; orientation:"upright"|"reversed"; meaning:string}> = []; const selectionCount=Math.min(count,available.length);
  for (let i = 0; i < selectionCount; i++) { const n = parseInt(seed.slice((i * 8) % seed.length, ((i * 8) % seed.length) + 8), 16); const card = available.splice(n % available.length, 1)[0]!; const orientation = (n >>> 1) % 2 === 0 ? "upright" : "reversed"; const meanings = card[orientation] ?? card.upright; selected.push({ id: card.id, orientation, meaning: meanings.general }); }
  return { cards: selected, seedHash: crypto.createHash("sha256").update(seed).digest("hex") };
}
export function cardName(id: string, locale: string): string { const card = allCards().find((candidate) => candidate.id === id); return card?.names[locale as "es-MX"|"pt-BR"] ?? card?.names["es-MX"] ?? id; }

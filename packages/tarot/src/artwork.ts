const majorArtwork = {
  "the-fool": "fool.jpg",
  "the-magician": "magician.jpg",
  "the-high-priestess": "highpriestess.jpg",
  "the-empress": "empress.jpg",
  "the-emperor": "emperor.jpg",
  "the-hierophant": "hierophant.jpg",
  "the-lovers": "lovers.jpg",
  "the-chariot": "chariot.jpg",
  strength: "strength.jpg",
  "the-hermit": "hermit.jpg",
  "wheel-of-fortune": "wheeloffortune.jpg",
  justice: "justice.jpg",
  "the-hanged-man": "hangedman.jpg",
  death: "death.jpg",
  temperance: "temperance.jpg",
  "the-devil": "devil.jpg",
  "the-tower": "tower.jpg",
  "the-star": "star.jpg",
  "the-moon": "moon.jpg",
  "the-sun": "sun.jpg",
  judgement: "judgement.jpg",
  "the-world": "world.jpg",
} as const;

const suitArtwork = {
  cups: "cu",
  pentacles: "pe",
  swords: "sw",
  wands: "wa",
} as const;

const rankArtwork = {
  ace: "ac",
  two: "02",
  three: "03",
  four: "04",
  five: "05",
  six: "06",
  seven: "07",
  eight: "08",
  nine: "09",
  ten: "10",
  page: "pa",
  knight: "kn",
  queen: "qu",
  king: "ki",
} as const;

export function tarotArtworkFilename(cardId: string): string | undefined {
  if (cardId in majorArtwork) return majorArtwork[cardId as keyof typeof majorArtwork];
  const match = /^(ace|two|three|four|five|six|seven|eight|nine|ten|page|knight|queen|king)-of-(cups|pentacles|swords|wands)$/.exec(cardId);
  if (!match) return undefined;
  const rank = match[1] as keyof typeof rankArtwork;
  const suit = match[2] as keyof typeof suitArtwork;
  return `${suitArtwork[suit]}${rankArtwork[rank]}.jpg`;
}

export const tarotArtworkCardIds = [
  ...Object.keys(majorArtwork),
  ...Object.keys(suitArtwork).flatMap((suit) =>
    Object.keys(rankArtwork).map((rank) => `${rank}-of-${suit}`),
  ),
] as readonly string[];

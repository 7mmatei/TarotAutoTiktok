import { tarotArtworkFilename } from "../../../packages/tarot/src/artwork.js";

const artworkUrls = import.meta.glob("../../../tarot/*.jpg", {
  eager: true,
  query: "?url",
  import: "default",
}) as Record<string, string>;

export function tarotArtworkUrl(cardId: string): string | undefined {
  const filename = tarotArtworkFilename(cardId);
  return filename ? artworkUrls[`../../../tarot/${filename}`] : undefined;
}

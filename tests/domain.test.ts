import { describe,expect,it } from "vitest";
import { assertTransition, compareQueue, premoderate } from "@tarot/domain";
import { allCards, selectCards } from "@tarot/tarot";
import { tarotArtworkCardIds, tarotArtworkFilename } from "../packages/tarot/src/artwork.js";
import { existsSync } from "node:fs";
import path from "node:path";
import { loadConfig } from "@tarot/config";

describe("domain rules",()=>{
  it("accepts only explicit lifecycle transitions",()=>{expect(()=>assertTransition("request","RECEIVED","MODERATION")).not.toThrow();expect(()=>assertTransition("request","COMPLETED","PLAYING")).toThrow();});
  it("orders premium ahead of free and keeps FIFO within priority",()=>{expect(compareQueue({priority:300,queuedAt:2},{priority:0,queuedAt:1})).toBeLessThan(0);expect(compareQueue({priority:100,queuedAt:1},{priority:100,queuedAt:2})).toBeLessThan(0);});
  it("blocks dangerous questions",()=>{expect(premoderate("¿Cuándo voy a morir?")).toEqual({action:"REQUEST_NEW_QUESTION",reasonCode:"death_prediction"});expect(premoderate("¿Qué puedo observar esta semana?")).toEqual({action:"ALLOW"});});
  it("selects auditable repeatable cards",()=>{expect(selectCards("s","r",3,"secret")).toEqual(selectCards("s","r",3,"secret"));});
  it("does not repeat cards within a seven-card spread",()=>{const selected=selectCards("s","r",7,"secret").cards;expect(new Set(selected.map((card)=>card.id)).size).toBe(selected.length);});
  it("selects from a complete 78-card deck with matching artwork",()=>{
    const cards=allCards();
    expect(cards).toHaveLength(78);
    expect(new Set(cards.map((card)=>card.id)).size).toBe(78);
    expect(new Set(tarotArtworkCardIds)).toEqual(new Set(cards.map((card)=>card.id)));
    for(const card of cards) {
      const filename=tarotArtworkFilename(card.id);
      expect(filename,card.id).toBeTruthy();
      expect(existsSync(path.resolve("tarot",filename!)),`${card.id}: ${filename}`).toBe(true);
    }
  });
  it("defaults the free-likes threshold to 2,000 and validates overrides",()=>{expect(loadConfig({} as NodeJS.ProcessEnv).FREE_LIKES_THRESHOLD).toBe(2_000);expect(loadConfig({FREE_LIKES_THRESHOLD:"1500"} as NodeJS.ProcessEnv).FREE_LIKES_THRESHOLD).toBe(1_500);expect(()=>loadConfig({FREE_LIKES_THRESHOLD:"0"} as NodeJS.ProcessEnv)).toThrow();});
});

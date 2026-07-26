import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe,expect,it } from "vitest";
import { GeminiDailyBudget,pacificDayKey } from "../apps/server/src/geminiBudget.js";

describe("Gemini daily request budget",()=>{
  it("uses the Gemini midnight-Pacific day boundary",()=>{
    expect(pacificDayKey(new Date("2026-07-27T06:59:59Z"))).toBe("2026-07-26");
    expect(pacificDayKey(new Date("2026-07-27T07:00:00Z"))).toBe("2026-07-27");
  });

  it("persists usage across restarts and reserves the interaction allowance",()=>{
    const directory=mkdtempSync(path.join(tmpdir(),"tarot-gemini-budget-"));
    const file=path.join(directory,"budget.json");
    const now=()=>new Date("2026-07-27T12:00:00Z");
    const first=new GeminiDailyBudget(file,4,1,now);
    first.acquire("interaction");
    first.acquire("reading");

    const restarted=new GeminiDailyBudget(file,4,1,now);
    expect(restarted.snapshot()).toMatchObject({total:2,readings:1,interactions:1,remaining:2,interactionRemaining:0});
    expect(()=>restarted.acquire("interaction")).toThrow("interaction daily budget exhausted");
    restarted.acquire("reading");
    restarted.acquire("reading");
    expect(()=>restarted.acquire("reading")).toThrow("daily request budget exhausted");
    expect(JSON.parse(readFileSync(file,"utf8"))).toMatchObject({total:4,readings:3,interactions:1});
  });

  it("starts a fresh counter after the Pacific day changes",()=>{
    const directory=mkdtempSync(path.join(tmpdir(),"tarot-gemini-reset-"));
    const file=path.join(directory,"budget.json");
    let instant=new Date("2026-07-27T06:59:59Z");
    const budget=new GeminiDailyBudget(file,2,1,()=>instant);
    budget.acquire("reading");
    instant=new Date("2026-07-27T07:00:00Z");
    expect(budget.snapshot()).toMatchObject({day:"2026-07-27",total:0,remaining:2});
  });
});

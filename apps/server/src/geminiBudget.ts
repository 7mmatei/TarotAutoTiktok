import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import path from "node:path";

export type GeminiRequestKind="reading"|"interaction";
type BudgetState={day:string;total:number;readings:number;interactions:number;skippedInteractions:number};

export type GeminiBudgetSnapshot=BudgetState&{
  limit:number;
  remaining:number;
  interactionLimit:number;
  interactionRemaining:number;
  resetTimeZone:"America/Los_Angeles";
};

export function pacificDayKey(date:Date):string {
  const parts=new Intl.DateTimeFormat("en-US",{
    timeZone:"America/Los_Angeles",
    year:"numeric",
    month:"2-digit",
    day:"2-digit"
  }).formatToParts(date);
  const value=(type:string)=>parts.find((part)=>part.type===type)?.value;
  return `${value("year")}-${value("month")}-${value("day")}`;
}

export class GeminiDailyBudget {
  private state:BudgetState;

  constructor(
    private readonly filePath:string,
    private readonly limit:number,
    private readonly interactionLimit:number,
    private readonly now:()=>Date=()=>new Date()
  ) {
    this.state=this.load();
    this.refreshDay();
  }

  acquire(kind:GeminiRequestKind):GeminiBudgetSnapshot {
    this.refreshDay();
    if(this.state.total>=this.limit)throw new Error(`Gemini daily request budget exhausted (${this.limit}); resets at midnight Pacific`);
    if(kind==="interaction"&&this.state.interactions>=this.interactionLimit)throw new Error(`Gemini interaction daily budget exhausted (${this.interactionLimit}); reading capacity is reserved`);
    const next:BudgetState={
      ...this.state,
      total:this.state.total+1,
      readings:this.state.readings+(kind==="reading"?1:0),
      interactions:this.state.interactions+(kind==="interaction"?1:0)
    };
    this.persist(next);
    this.state=next;
    return this.snapshot();
  }

  skipInteraction():GeminiBudgetSnapshot {
    this.refreshDay();
    this.state={...this.state,skippedInteractions:this.state.skippedInteractions+1};
    return this.snapshot();
  }

  canUseInteraction():boolean {
    this.refreshDay();
    return this.state.total<this.limit&&this.state.interactions<this.interactionLimit;
  }

  snapshot():GeminiBudgetSnapshot {
    this.refreshDay();
    return {
      ...this.state,
      limit:this.limit,
      remaining:Math.max(0,this.limit-this.state.total),
      interactionLimit:this.interactionLimit,
      interactionRemaining:Math.max(0,this.interactionLimit-this.state.interactions),
      resetTimeZone:"America/Los_Angeles"
    };
  }

  private empty():BudgetState {
    return {day:pacificDayKey(this.now()),total:0,readings:0,interactions:0,skippedInteractions:0};
  }

  private load():BudgetState {
    try {
      const parsed=JSON.parse(readFileSync(this.filePath,"utf8")) as Partial<BudgetState>;
      if(typeof parsed.day!=="string"||![parsed.total,parsed.readings,parsed.interactions,parsed.skippedInteractions].every((value)=>Number.isInteger(value)&&Number(value)>=0))return this.empty();
      return parsed as BudgetState;
    } catch {
      return this.empty();
    }
  }

  private refreshDay():void {
    const day=pacificDayKey(this.now());
    if(this.state.day===day)return;
    const next=this.empty();
    this.persist(next);
    this.state=next;
  }

  private persist(state:BudgetState):void {
    mkdirSync(path.dirname(this.filePath),{recursive:true});
    const temporary=`${this.filePath}.${process.pid}.tmp`;
    writeFileSync(temporary,JSON.stringify(state),"utf8");
    renameSync(temporary,this.filePath);
  }
}

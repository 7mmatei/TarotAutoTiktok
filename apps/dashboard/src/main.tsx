import React, { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { messages, type Locale } from "./i18n.js";
import "./styles.css";

type Status = { session?: { id: string; status: string; locale: string }; current?: any; queue: any[]; awaiting: any[]; metrics: any };
type Readiness = { liveReady?:boolean;blockers?:string[];worker?:{ready?:boolean};renderer?:{ready?:boolean};eventSource?:{receivedPayloads?:number;rejectedPayloads?:number};preflight?:{status?:string} };
const API = "http://127.0.0.1:3001";

function App() {
  const locale: Locale = "en-US";
  const t = messages[locale];
  const [status, setStatus] = useState<Status>({ queue: [], awaiting: [], metrics: {} });
  const [events, setEvents] = useState<any>({ events: [], actions: [] });
  const [providerEvents, setProviderEvents] = useState<any>({ events: [], received: 0, rejected: 0 });
  const [readiness,setReadiness]=useState<Readiness>({});

  async function refresh() {
    try {
      const [statusResponse, eventsResponse,readyResponse,providerResponse] = await Promise.all([fetch(`${API}/api/status`), fetch(`${API}/api/events`),fetch(`${API}/ready`),fetch(`${API}/api/provider-events`)]);
      setStatus(await statusResponse.json());
      setEvents(await eventsResponse.json());
      setReadiness(await readyResponse.json());
      setProviderEvents(await providerResponse.json());
    } catch {
      setReadiness({liveReady:false,blockers:[`Cannot reach the Tarot server at ${API}`]});
    }
  }

  useEffect(() => { refresh(); const timer = setInterval(refresh, 1500); return () => clearInterval(timer); }, []);
  async function session() { await fetch(`${API}/api/sessions`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ locale: "es-MX" }) }); refresh(); }
  async function call(path: string) { await fetch(`${API}${path}`, { method: "POST" }); refresh(); }

  const paidQueue=(status.queue ?? []).filter((item:any)=>item.source==="paid");
  const freeQueue=(status.queue ?? []).filter((item:any)=>item.source==="free");
  const gateHint=readiness.liveReady?"All local checks passed":readiness.blockers?.length?readiness.blockers.join(" · "):"Checking server readiness…";
  const detailText=(detail:any):string=>detail && typeof detail === "object" ? Object.entries(detail).map(([key,value])=>`${key}=${typeof value === "string" ? value : JSON.stringify(value)}`).join(" · ") : "";
  const diagnosticText=(diagnostic:any):string=>{ if(diagnostic.error)return diagnostic.error; if(diagnostic.ignoredControl)return "TikFinity control packet"; if(diagnostic.eventTypes?.length)return diagnostic.eventTypes.join(", "); const payload=diagnostic.payload && typeof diagnostic.payload === "object" ? diagnostic.payload : undefined; if(payload){const kind=["type","eventType","event","name","action","command"].map((key)=>payload[key]).find((value)=>value!==undefined); if(kind!==undefined)return `unsupported event=${String(kind)}`; const keys=Object.keys(payload).slice(0,8); if(keys.length)return `unsupported payload (keys: ${keys.join(", ")})`;} return "unsupported payload"; };
  return <main><header><div><div className="eyebrow">TAROT / LIVE OPS</div><h1>{t.title}</h1><p>{t.subtitle}</p></div><div className="toolbar"><button onClick={session}>{t.start}</button></div></header><section className="metric-grid"><Metric label="LIVE gate" value={readiness.liveReady?"READY":"BLOCKED"} hint={gateHint}/><Metric label="Worker / renderer" value={`${readiness.worker?.ready?"✓":"×"} / ${readiness.renderer?.ready?"✓":"×"}`} hint={`Preflight: ${readiness.preflight?.status??"unknown"}`}/><Metric label={t.status} value={status.session?.status ?? "OFFLINE"} hint={status.session?.id?.slice(0, 8) ?? "—"}/><Metric label={t.queue} value={paidQueue.length} hint={`${status.metrics?.completed ?? 0} ${t.completed}`}/><Metric label="Free readings" value={status.metrics?.freeGranted ?? 0} hint={`${freeQueue.length} queued · ${status.metrics?.freeCompleted ?? 0} completed`}/><Metric label="Provider payloads" value={readiness.eventSource?.receivedPayloads??0} hint={`${readiness.eventSource?.rejectedPayloads??0} rejected`}/></section><div className="content-grid"><Panel title={t.current}><div className="reading-card">{status.current ? <><span className="pill">PLAYING</span><h2>{status.current.displayName}</h2><p>{status.current.safeQuestion}</p><div className="cards">{(status.current.cards ?? []).map((card: any) => <div className="mini-card" key={card.id}>{card.id}<small>{card.orientation}</small></div>)}</div></> : <p className="muted">{t.empty}</p>}</div><div className="actions"><button onClick={() => call("/api/playback/pause")}>{t.pause}</button><button className="secondary" onClick={() => call("/api/playback/resume")}>{t.resume}</button><button className="danger" onClick={() => call("/api/playback/reset")}>Reset</button></div></Panel><Panel title={t.queue}><Queue items={paidQueue} empty={t.empty}/></Panel><Panel title="Free queue"><Queue items={freeQueue} empty={t.empty}/></Panel><Panel title={t.awaiting}><Queue items={status.awaiting.map((entitlement: any) => ({ id: entitlement.id, displayName: entitlement.userId, status: entitlement.status, question: t.viewerQuestion }))} empty={t.empty}/></Panel><Panel title={t.events}><div className="event-list">{(events.actions ?? []).slice(-10).reverse().map((event: any, index: number) => <div className="event" key={index}><span>{new Date(event.at).toLocaleTimeString()}</span><strong>{event.action}</strong><small>{detailText(event.detail) || event.requestId?.slice(0, 8) || "system"}</small></div>)}</div></Panel><Panel title="Provider diagnostics"><div className="event-list">{(providerEvents.events ?? []).slice(-8).reverse().map((diagnostic: any, index: number) => <div className="event" key={index}><span>{new Date(diagnostic.receivedAt).toLocaleTimeString()}</span><strong>{diagnostic.normalized ? "ACCEPTED" : "REJECTED"}</strong><small>{diagnosticText(diagnostic)}{diagnostic.payload?.type ? ` · type=${diagnostic.payload.type}` : ""}</small></div>)}</div></Panel></div><footer>{t.safe}</footer></main>;
}

function Metric({ label, value, hint }: { label: string; value: any; hint: string }) { return <div className="metric"><span>{label}</span><strong>{value}</strong><small>{hint}</small></div>; }
function Panel({ title, children }: { title: string; children: React.ReactNode }) { return <section className="panel"><div className="panel-title"><h3>{title}</h3><span>LIVE</span></div>{children}</section>; }
function Queue({ items, empty }: { items: any[]; empty: string }) { return <div className="queue">{items.length ? items.map((item: any) => <div className="queue-row" key={item.id}><div><strong>{item.displayName ?? item.userId}</strong><small>{item.safeQuestion ?? item.question ?? item.status}</small></div><span className="pill">{item.priority ?? item.status}</span></div>) : <p className="muted">{empty}</p>}</div>; }

createRoot(document.getElementById("root")!).render(<App/>);

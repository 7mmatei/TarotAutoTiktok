import { describe,expect,it,vi } from "vitest";
import { GeminiInteractionGenerator,GeminiReadingGenerator,createReadingGenerator } from "@tarot/adapters";

describe("Gemini reading provider",()=>{
  it("uses Gemini 3.5 Flash-Lite structured output without deprecated sampling parameters",async()=>{
    const output={safe:true as const,category:"general",opening:"Gracias.",cards:[{cardId:"the-star",interpretation:"La Estrella invita a recuperar esperanza con calma."}],summary:"Observa lo que te devuelve claridad.",closing:"Lectura para entretenimiento y reflexión personal.",spokenText:"Gracias. La Estrella invita a recuperar esperanza con calma. Observa lo que te devuelve claridad. Lectura para entretenimiento y reflexión personal.",safetyFlags:[]};
    const request=vi.fn(async()=>({ok:true,status:200,json:async()=>({candidates:[{content:{parts:[{text:JSON.stringify(output)}]}}]})}) as Response);
    const generator=new GeminiReadingGenerator("secret-key","gemini-3.5-flash-lite",request as unknown as typeof fetch);
    await expect(generator.generate({locale:"es-MX",question:"¿Qué puedo observar?",cards:[{id:"the-star",orientation:"upright",meaning:"esperanza"}],maxWords:80})).resolves.toEqual(output);
    expect(String(request.mock.calls[0]?.[0])).toContain("/gemini-3.5-flash-lite:generateContent");
    const init=request.mock.calls[0]?.[1] as RequestInit;
    expect((init.headers as Record<string,string>)["x-goog-api-key"]).toBe("secret-key");
    const body=JSON.parse(String(init.body)) as Record<string,unknown>;
    expect(JSON.stringify(body)).toContain("responseMimeType");
    expect(JSON.stringify(body)).not.toContain("responseSchema");
    expect(JSON.stringify(body)).not.toContain("temperature");
    expect(JSON.stringify(body)).not.toContain("top_p");
    expect(JSON.stringify(body)).not.toContain("top_k");
  });

  it("requires a Gemini key when Gemini is selected",()=>{
    expect(()=>createReadingGenerator({provider:"gemini",model:"gemini-3.5-flash-lite"})).toThrow("GEMINI_API_KEY");
  });

  it("checks the shared budget before sending a provider request",async()=>{
    const request=vi.fn();
    const beforeRequest=vi.fn(()=>{throw new Error("daily request budget exhausted");});
    const generator=new GeminiReadingGenerator("secret-key","gemini-3.5-flash-lite",request as unknown as typeof fetch,{beforeRequest});
    await expect(generator.generate({locale:"es-MX",question:"¿Qué puedo observar?",cards:[{id:"the-star",orientation:"upright",meaning:"esperanza"}],maxWords:80})).rejects.toThrow("daily request budget exhausted");
    expect(beforeRequest).toHaveBeenCalledOnce();
    expect(request).not.toHaveBeenCalled();
  });

  it("generates a short viewer-specific interaction without engagement solicitation",async()=>{
    const output={safe:true as const,spokenText:"Luna, ese cambio que mencionas suena importante. ¿Qué parte te gustaría mirar con más calma hoy?",tone:"curious" as const};
    const request=vi.fn(async()=>({ok:true,status:200,json:async()=>({candidates:[{content:{parts:[{text:JSON.stringify(output)}]}}]})}) as Response);
    const generator=new GeminiInteractionGenerator("secret-key","gemini-3.5-flash-lite",request as unknown as typeof fetch);

    await expect(generator.generate({locale:"es-MX",viewerName:"Luna",comment:"Estoy atravesando un cambio",maxWords:32})).resolves.toEqual(output);
    expect(String((request.mock.calls[0]?.[1] as RequestInit).body)).toContain("No pidas regalos");
  });
});

import { describe,expect,it,vi } from "vitest";
import { GeminiReadingGenerator,createReadingGenerator } from "@tarot/adapters";

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
});

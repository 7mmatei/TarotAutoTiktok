import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { AzureSpeechProvider, FallbackSpeechProvider, LocalSpeechProvider, type SpeechProvider } from "@tarot/adapters";

describe("local speech audio assets", () => {
  it("writes a playable WAV fallback with a deterministic duration", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "tarot-audio-"));
    try {
      const result = await new LocalSpeechProvider(directory, false).synthesize({ locale: "es-MX", voice: "es-MX-demo", text: "Gracias por compartir tu pregunta." });
      const file = await readFile(result.localPath);

      expect(result.localPath.endsWith(".wav")).toBe(true);
      expect(file.subarray(0, 4).toString("ascii")).toBe("RIFF");
      expect(file.subarray(8, 12).toString("ascii")).toBe("WAVE");
      expect(file.readUInt32LE(24)).toBe(8_000);
      expect(file.length).toBeGreaterThan(44);
      expect(result.durationMs).toBe(Math.round(file.readUInt32LE(40) * 1000 / file.readUInt32LE(28)));
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("writes Azure Speech MP3 output behind the same provider contract", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "tarot-azure-audio-"));
    const request = vi.fn(async () => ({ ok: true, status: 200, arrayBuffer: async () => new TextEncoder().encode("audio".repeat(40)).buffer }) as Response);
    try {
      const result = await new AzureSpeechProvider(directory, "test-key", "eastus", "es-MX-DaliaNeural", request as unknown as typeof fetch).synthesize({ locale: "es-MX", voice: "es-MX-DaliaNeural", text: "Gracias por compartir tu pregunta." });
      const file = await readFile(result.localPath);

      expect(result.format).toBe("mp3");
      expect(result.localPath.endsWith(".mp3")).toBe(true);
      expect(file.length).toBeGreaterThan(100);
      expect(request).toHaveBeenCalledOnce();
      expect(String(request.mock.calls[0]?.[0])).toContain("eastus.tts.speech.microsoft.com");
      expect(String(request.mock.calls[0]?.[1]?.body)).toContain("es-MX-DaliaNeural");
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("retries Azure-style primary speech once before using the local fallback",async()=>{
    const primary:SpeechProvider={synthesize:vi.fn(async()=>{throw new Error("provider unavailable");})};
    const fallback:SpeechProvider={synthesize:vi.fn(async()=>({contentHash:"fallback",localPath:"fallback.wav",durationMs:3210,format:"wav" as const}))};
    const provider=new FallbackSpeechProvider(primary,fallback,2);
    const result=await provider.synthesize({locale:"es-MX",voice:"es-MX-DaliaNeural",text:"Lectura segura"});
    expect(primary.synthesize).toHaveBeenCalledTimes(2);
    expect(fallback.synthesize).toHaveBeenCalledOnce();
    expect(result.durationMs).toBe(3210);
  });
});

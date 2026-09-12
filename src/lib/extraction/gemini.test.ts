import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { extractTenderWithGemini, isGeminiConfigured, buildTenderRequest, geminiModel } from "@/lib/extraction/gemini";

/**
 * The fetch layer, with the network replaced.
 *
 * server-only is stubbed by vitest.config.ts, so this module loads. Every
 * branch of the failure handling is exercised here rather than by hand with
 * a real key, which is the only way the rare ones ever get exercised at all.
 */

const TEXT = "REQUEST FOR PROPOSAL RFP 03/2026\nProvision of business analysis services\nClosing date: 15 October 2026";

function answer(body: unknown, status = 200) {
  return new Response(typeof body === "string" ? body : JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function completion(fields: unknown, finishReason = "STOP") {
  return answer({
    candidates: [{ content: { parts: [{ text: JSON.stringify(fields) }] }, finishReason }],
    usageMetadata: { promptTokenCount: 1200, candidatesTokenCount: 300 },
  });
}

let calls: { url: string; init: RequestInit }[] = [];

beforeEach(() => {
  calls = [];
  vi.stubEnv("GEMINI_API_KEY", "test-key");
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

function stubFetch(respond: () => Response | Promise<Response>) {
  vi.stubGlobal("fetch", async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    return respond();
  });
}

describe("isGeminiConfigured", () => {
  it("is the presence of the key and nothing else", () => {
    expect(isGeminiConfigured()).toBe(true);
    vi.stubEnv("GEMINI_API_KEY", "");
    expect(isGeminiConfigured()).toBe(false);
  });
});

describe("buildTenderRequest", () => {
  it("sends a PDF as itself and a docx as text", () => {
    const pdf = buildTenderRequest({ text: TEXT, pdf: Buffer.from("%PDF-1.4 fake") });
    expect(pdf.asPdf).toBe(true);
    const parts = (pdf.body.contents as { parts: Record<string, unknown>[] }[])[0].parts;
    expect(parts[1]).toHaveProperty("inlineData.mimeType", "application/pdf");
    expect(JSON.stringify(parts)).not.toContain("Closing date");

    const text = buildTenderRequest({ text: TEXT, pdf: null });
    expect(text.asPdf).toBe(false);
    const textParts = (text.body.contents as { parts: { text?: string }[] }[])[0].parts;
    expect(textParts[1].text).toContain("Closing date: 15 October 2026");
  });

  it("asks for JSON against the schema, deterministically, without reasoning", () => {
    const { body } = buildTenderRequest({ text: TEXT });
    const config = body.generationConfig as Record<string, unknown>;
    expect(config.responseMimeType).toBe("application/json");
    expect(config.temperature).toBe(0);
    expect(config.responseSchema).toBeDefined();
    expect(config.thinkingConfig).toEqual({ thinkingLevel: "low" });
    expect(buildTenderRequest({ text: TEXT }, { thinking: false }).body).not.toHaveProperty("generationConfig.thinkingConfig");
  });
});

describe("extractTenderWithGemini", () => {
  it("does not touch the network without a key", async () => {
    vi.stubEnv("GEMINI_API_KEY", "");
    stubFetch(() => completion({}));
    const out = await extractTenderWithGemini({ text: TEXT });
    expect(out).toEqual({ ok: false, reason: "GEMINI_API_KEY is not set" });
    expect(calls).toHaveLength(0);
  });

  it("sends the key in a header, never in the URL", async () => {
    stubFetch(() => completion({ title: "x" }));
    await extractTenderWithGemini({ text: TEXT });
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe(`https://generativelanguage.googleapis.com/v1beta/models/${geminiModel()}:generateContent`);
    expect(calls[0].url).not.toContain("test-key");
    expect((calls[0].init.headers as Record<string, string>)["x-goog-api-key"]).toBe("test-key");
  });

  it("uses the model named in the environment", async () => {
    vi.stubEnv("GEMINI_MODEL", "gemini-2.5-flash-lite");
    stubFetch(() => completion({}));
    await extractTenderWithGemini({ text: TEXT });
    expect(calls[0].url).toContain("gemini-2.5-flash-lite:generateContent");
  });

  it("returns coerced fields on a good answer, with the usage", async () => {
    stubFetch(() =>
      completion({
        title: "Provision of business analysis services",
        reference_number: "RFP 03/2026",
        submission_deadline: "2026-10-15",
        positions: [{ role: "business analyst", quantity: 2, min_experience_years: 5, required_skills: [], required_certifications: [], required_qualifications: [], notes: null }],
      }),
    );
    const out = await extractTenderWithGemini({ text: TEXT });
    expect(out.ok).toBe(true);
    if (out.ok) {
      expect(out.fields.title).toBe("Provision of business analysis services");
      expect(out.fields.positions[0].role).toBe("Business Analyst");
      expect(out.usage).toEqual({ promptTokens: 1200, outputTokens: 300 });
      expect(out.note).toBeUndefined();
    }
  });

  it("uses an answer cut off at the output limit as far as it goes, and says so", async () => {
    stubFetch(() =>
      answer({
        candidates: [
          {
            content: { parts: [{ text: '{"title": "Provision of services", "reference_number": "RFP 1", "positions": [{"role": "Business Analyst", "quantity": 2, "required_skills": ["BPM' }] },
            finishReason: "MAX_TOKENS",
          },
        ],
      }),
    );
    const out = await extractTenderWithGemini({ text: TEXT });
    expect(out.ok).toBe(true);
    if (out.ok) {
      expect(out.fields.title).toBe("Provision of services");
      expect(out.fields.reference_number).toBe("RFP 1");
      expect(out.note).toMatch(/length limit/);
    }
  });

  it("reports a rate limit with the retry hint", async () => {
    stubFetch(() =>
      answer(
        { error: { code: 429, message: "quota", status: "RESOURCE_EXHAUSTED", details: [{ "@type": "type.googleapis.com/google.rpc.RetryInfo", retryDelay: "17s" }] } },
        429,
      ),
    );
    const out = await extractTenderWithGemini({ text: TEXT });
    expect(out).toEqual({ ok: false, reason: "Gemini rate limit reached, try again in 17s" });
  });

  it("tries once more without the thinking setting when a model refuses it", async () => {
    let n = 0;
    stubFetch(() =>
      n++ === 0
        ? answer({ error: { code: 400, message: "Request contains an invalid argument.", status: "INVALID_ARGUMENT" } }, 400)
        : completion({ title: "Read on the second try" }),
    );
    const out = await extractTenderWithGemini({ text: TEXT });
    expect(out.ok).toBe(true);
    if (out.ok) expect(out.fields.title).toBe("Read on the second try");
    expect(calls).toHaveLength(2);
    expect(JSON.parse(calls[0].init.body as string).generationConfig.thinkingConfig).toBeDefined();
    expect(JSON.parse(calls[1].init.body as string).generationConfig.thinkingConfig).toBeUndefined();
  });

  it("reports any other failure with the status and the message", async () => {
    stubFetch(() => answer({ error: { code: 400, message: "API key not valid. Please pass a valid API key.", status: "INVALID_ARGUMENT" } }, 400));
    const out = await extractTenderWithGemini({ text: TEXT });
    expect(out).toEqual({ ok: false, reason: "Gemini 400: API key not valid. Please pass a valid API key." });
  });

  it("reports a document the model declined", async () => {
    stubFetch(() => answer({ promptFeedback: { blockReason: "PROHIBITED_CONTENT" }, candidates: [] }));
    const out = await extractTenderWithGemini({ text: TEXT });
    expect(out).toEqual({ ok: false, reason: "Gemini declined the document: PROHIBITED_CONTENT" });
  });

  it("reports an answer with no content, and content that is not JSON", async () => {
    stubFetch(() => answer({ candidates: [{ content: { parts: [] } }] }));
    expect(await extractTenderWithGemini({ text: TEXT })).toEqual({ ok: false, reason: "Gemini returned no content" });

    stubFetch(() => answer({ candidates: [{ content: { parts: [{ text: "Sorry, I cannot" }] } }] }));
    expect(await extractTenderWithGemini({ text: TEXT })).toEqual({ ok: false, reason: "Gemini returned something that was not JSON" });
  });

  it("reports a network failure as data, never as a throw", async () => {
    stubFetch(() => {
      throw new Error("getaddrinfo ENOTFOUND");
    });
    const out = await extractTenderWithGemini({ text: TEXT });
    expect(out).toEqual({ ok: false, reason: "getaddrinfo ENOTFOUND" });
  });

  it("reports a timeout in words", async () => {
    vi.useFakeTimers();
    stubFetch(
      () =>
        new Promise((_, reject) => {
          const err = new Error("aborted");
          err.name = "AbortError";
          setTimeout(() => reject(err), 60_000);
        }),
    );
    const pending = extractTenderWithGemini({ text: TEXT });
    await vi.advanceTimersByTimeAsync(60_000);
    const out = await pending;
    vi.useRealTimers();
    expect(out).toEqual({ ok: false, reason: "Gemini did not answer within 50s" });
  });
});

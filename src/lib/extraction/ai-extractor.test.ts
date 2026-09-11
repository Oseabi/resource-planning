import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { extractWithAi, isAiExtractionConfigured, GROQ_ENDPOINT } from "@/lib/extraction/ai-extractor";
import { AI_MODEL } from "@/lib/extraction/ai-fields";

/**
 * The fetch layer, with the network replaced.
 *
 * server-only is stubbed by vitest.config.ts, so this module loads. Every
 * branch of the failure handling is exercised here rather than by hand with
 * a real key, which is the only way the rare ones ever get exercised at all.
 */

const CV = "Nomsa Khumalo\nSenior Business Analyst\nnomsa@example.com\n082 123 4567\nSQL, Power BI";

function answer(body: unknown, status = 200, headers: Record<string, string> = {}) {
  return new Response(typeof body === "string" ? body : JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...headers },
  });
}

function completion(fields: unknown) {
  return answer({ choices: [{ message: { content: JSON.stringify(fields) } }] });
}

let calls: { url: string; init: RequestInit }[] = [];

beforeEach(() => {
  calls = [];
  vi.stubEnv("GROQ_API_KEY", "test-key");
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

describe("isAiExtractionConfigured", () => {
  it("is the presence of the key and nothing else", () => {
    expect(isAiExtractionConfigured()).toBe(true);
    vi.stubEnv("GROQ_API_KEY", "");
    expect(isAiExtractionConfigured()).toBe(false);
  });
});

describe("extractWithAi", () => {
  it("does not touch the network without a key", async () => {
    vi.stubEnv("GROQ_API_KEY", "");
    stubFetch(() => completion({}));
    const out = await extractWithAi(CV);
    expect(out).toEqual({ ok: false, reason: "GROQ_API_KEY is not set" });
    expect(calls).toHaveLength(0);
  });

  it("sends exactly what the app is supposed to send", async () => {
    stubFetch(() => completion({ current_role: "Business Analyst" }));
    await extractWithAi(CV);

    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe(GROQ_ENDPOINT);
    const headers = calls[0].init.headers as Record<string, string>;
    expect(headers.Authorization).toBe("Bearer test-key");

    const body = JSON.parse(String(calls[0].init.body));
    expect(body.model).toBe(AI_MODEL);
    expect(body.response_format.json_schema.strict).toBe(true);
    expect(body.reasoning_effort).toBe("low");
    expect(body.include_reasoning).toBe(false);
    expect(body.temperature).toBe(0);
    expect(calls[0].init.signal).toBeInstanceOf(AbortSignal);
  });

  it("never sends the contact details", async () => {
    // The single most important assertion in this file.
    stubFetch(() => completion({}));
    await extractWithAi(CV);
    const sent = String(calls[0].init.body);
    expect(sent).not.toContain("nomsa@example.com");
    expect(sent).not.toContain("082 123 4567");
    expect(sent).toContain("[email removed]");
    expect(sent).toContain("[phone removed]");
    // The skills still went, since that is what the model is for.
    expect(sent).toContain("Power BI");
  });

  it("returns coerced fields on a good answer", async () => {
    stubFetch(() =>
      completion({ current_role: " Business Analyst ", skills: ["SQL", "sql"], years_experience: 7 }),
    );
    const out = await extractWithAi(CV);
    expect(out.ok).toBe(true);
    if (out.ok) {
      expect(out.fields.current_role).toBe("Business Analyst");
      expect(out.fields.skills).toEqual(["SQL"]);
      expect(out.truncated).toBe(false);
    }
  });

  it("reports a rate limit with the retry hint", async () => {
    stubFetch(() => answer("slow down", 429, { "retry-after": "12" }));
    const out = await extractWithAi(CV);
    expect(out).toEqual({ ok: false, reason: "Groq rate limit reached, try again in 12s" });
  });

  it("reports a request that is too large on its own", async () => {
    stubFetch(() => answer("too big", 413));
    const out = await extractWithAi(CV);
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.reason).toMatch(/too long/);
  });

  it("reports any other failure with the status and the start of the body", async () => {
    stubFetch(() => answer("Invalid API Key", 401));
    const out = await extractWithAi(CV);
    expect(out).toEqual({ ok: false, reason: "Groq 401: Invalid API Key" });
  });

  it("uses the answer Groq refused when the model left a key out", async () => {
    // Strict mode on this model checks after the fact, and one long CV came
    // back 400 with the whole answer attached, minus one list.
    const refused = {
      error: {
        message:
          "Generated JSON does not match the expected schema. Please adjust your prompt. See 'failed_generation' for more details. Error: jsonschema: '' does not validate with /required: missing properties: 'sectors', 'projects'",
        type: "invalid_request_error",
        code: "json_validate_failed",
        failed_generation: JSON.stringify({ current_role: "Senior Business Analyst", skills: ["SQL"] }),
      },
    };
    stubFetch(() => answer(refused, 400));
    const out = await extractWithAi(CV);
    expect(out.ok).toBe(true);
    if (out.ok) {
      expect(out.fields.current_role).toBe("Senior Business Analyst");
      expect(out.fields.skills).toEqual(["SQL"]);
      expect(out.note).toBe(
        "The AI left out sectors, projects; the rest of its answer was used and the local parser filled the gaps.",
      );
    }
  });

  it("uses an answer Groq cut off at the token cap and closed itself", async () => {
    const refused = {
      error: {
        message: "Generated JSON does not match the expected schema. Error: jsonschema: '' does not validate with /required: missing properties: 'education'",
        failed_generation: '{"current_role": "Analyst", "work_experience": [{"title": "Analyst", "company": "SITA"}]}',
      },
    };
    stubFetch(() => answer(refused, 400));
    const out = await extractWithAi(CV);
    expect(out.ok).toBe(true);
    if (out.ok) expect(out.fields.work_experience?.[0]?.company).toBe("SITA");
  });

  it("still reports a 400 whose failed generation is not JSON", async () => {
    stubFetch(() => answer({ error: { message: "bad", failed_generation: '{"current_role": "Ana' } }, 400));
    const out = await extractWithAi(CV);
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.reason).toMatch(/^Groq 400: /);
  });

  it("reports an answer with no content", async () => {
    stubFetch(() => answer({ choices: [] }));
    const out = await extractWithAi(CV);
    expect(out).toEqual({ ok: false, reason: "Groq returned no content" });
  });

  it("reports content that is not JSON, rather than throwing", async () => {
    stubFetch(() => answer({ choices: [{ message: { content: "{ not json" } }] }));
    const out = await extractWithAi(CV);
    expect(out).toEqual({ ok: false, reason: "Groq returned something that was not JSON" });
  });

  it("reports a body that is not JSON at all", async () => {
    stubFetch(() => answer("<html>gateway error</html>", 200));
    const out = await extractWithAi(CV);
    expect(out.ok).toBe(false);
  });

  it("reports a network failure as data, never as a throw", async () => {
    stubFetch(() => {
      throw new Error("ECONNRESET");
    });
    const out = await extractWithAi(CV);
    expect(out).toEqual({ ok: false, reason: "ECONNRESET" });
  });

  it("reports a timeout in words", async () => {
    stubFetch(() => {
      const e = new Error("aborted");
      e.name = "AbortError";
      throw e;
    });
    const out = await extractWithAi(CV);
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.reason).toMatch(/did not answer within 20s/);
  });

  it("survives a model that ignored the schema", async () => {
    stubFetch(() => completion({ current_role: 42, skills: "not a list", surprise: true }));
    const out = await extractWithAi(CV);
    expect(out.ok).toBe(true);
    if (out.ok) {
      expect(out.fields.current_role).toBeNull();
      expect(out.fields.skills).toEqual([]);
    }
  });
});

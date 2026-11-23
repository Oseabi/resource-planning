import "server-only";

/**
 * Read a request with the AI, for wording the rules do not cover ("folks who
 * can build Power Apps and have been doing it a while, Joburg side").
 *
 * Only the request and the previous reading go out: no candidate, no name, no
 * CV. The answer is only ever criteria, made safe by coerceTalentQuery, and
 * the search runs here on the app's own data. Any failure (no key, rate limit,
 * timeout, a strange answer) comes back as null and the rules read it instead.
 */
import { GROQ_ENDPOINT } from "@/lib/extraction/ai-extractor";
import { AI_MODEL, stripPii } from "@/lib/extraction/ai-fields";
import { coerceTalentQuery, type TalentQuery } from "@/lib/talent-search/query";

const TIMEOUT_MS = 8_000;

const SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["count", "role", "skills", "certifications", "minYears", "location", "availableNow"],
  properties: {
    count: { type: "integer", description: "How many people are wanted. 5 when not said." },
    role: { type: ["string", "null"], description: "The job title, singular, e.g. Software Developer. Null when none." },
    skills: { type: "array", items: { type: "string" }, description: "Technologies or skills required." },
    certifications: {
      type: "array",
      items: { type: "string" },
      description: "Certificates required. Write Microsoft exams as their code, e.g. MB-500, AZ-900.",
    },
    minYears: { type: ["integer", "null"], description: "Minimum years of experience, or null." },
    location: { type: ["string", "null"], description: "South African city or province, or null." },
    availableNow: { type: "boolean", description: "True only when they must be available immediately." },
  },
};

function prompt(message: string, previous: TalentQuery | null): string {
  return [
    "You turn a recruiter's request into search criteria for a South African IT recruitment database.",
    "Return only the criteria. Do not invent requirements the request does not state.",
    previous
      ? `The previous search was ${JSON.stringify(previous)}. If the new message only adjusts it (a number, a place, an extra certificate, removing something), return the previous search with that change. If it asks for a different role, start fresh.`
      : "There is no previous search.",
    `Request: ${message}`,
  ].join("\n");
}

export async function readRequestWithAi(message: string, previous: TalentQuery | null): Promise<TalentQuery | null> {
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) return null;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(GROQ_ENDPOINT, {
      method: "POST",
      signal: controller.signal,
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: AI_MODEL,
        reasoning_effort: "low",
        include_reasoning: false,
        temperature: 0,
        max_completion_tokens: 400,
        messages: [{ role: "user", content: stripPii(prompt(message.slice(0, 600), previous)) }],
        response_format: { type: "json_schema", json_schema: { name: "talent_query", strict: true, schema: SCHEMA } },
      }),
    });
    if (!res.ok) return null;
    const body = (await res.json()) as { choices?: { message?: { content?: string } }[] };
    const content = body.choices?.[0]?.message?.content;
    if (!content) return null;
    return coerceTalentQuery(JSON.parse(content));
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

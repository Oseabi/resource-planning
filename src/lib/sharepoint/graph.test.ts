import { describe, expect, it, beforeEach } from "vitest";
import { getGraphToken, resetTokenCache, getItemByPath, uploadFile, isSharePointConfigured } from "./graph";
import { encodeDrivePath, libraryRelativePath, safeDriveName } from "./paths";

const env = { MS_TENANT_ID: "t", MS_CLIENT_ID: "c", MS_CLIENT_SECRET: "s", SHAREPOINT_DRIVE_ID: "d" } as unknown as NodeJS.ProcessEnv;

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

describe("paths", () => {
  it("encodes each segment and drops empty ones", () => {
    expect(encodeDrivePath("C# Developer/Thabo O'Neil/CV (1).pdf")).toBe("C%23%20Developer/Thabo%20O''Neil/CV%20(1).pdf");
    expect(encodeDrivePath("\\Role\\Person\\")).toBe("Role/Person");
  });
  it("finds a file's path inside the synced library", () => {
    const root = "C:\\Users\\x\\Lib\\Resourcing - Candidate Database";
    expect(libraryRelativePath(root, root + "\\Test Analyst\\A B\\cv.docx")).toBe("Test Analyst/A B/cv.docx");
    expect(libraryRelativePath(root, "C:\\Temp\\stage\\cv.docx")).toBeNull();
  });
  it("replaces characters SharePoint refuses", () => {
    expect(safeDriveName('a:b?c*.pdf')).toBe("a_b_c_.pdf");
    expect(safeDriveName("name. ")).toBe("name");
  });
});

describe("graph", () => {
  beforeEach(() => resetTokenCache());

  it("knows when it is configured", () => {
    expect(isSharePointConfigured(env)).toBe(true);
    expect(isSharePointConfigured({} as NodeJS.ProcessEnv)).toBe(false);
  });

  it("reuses the token until near expiry", async () => {
    let calls = 0;
    const f = (async () => {
      calls++;
      return jsonResponse({ access_token: `tok${calls}`, expires_in: 3600 });
    }) as typeof fetch;
    expect(await getGraphToken(env, f, 0)).toBe("tok1");
    expect(await getGraphToken(env, f, 30 * 60_000)).toBe("tok1");
    expect(await getGraphToken(env, f, 56 * 60_000)).toBe("tok2");
    expect(calls).toBe(2);
  });

  it("returns null for a missing path and the item otherwise", async () => {
    const old = { ...process.env };
    Object.assign(process.env, env);
    try {
      const f = (async (url: string | URL | Request) => {
        const u = String(url);
        if (u.includes("oauth2")) return jsonResponse({ access_token: "tok", expires_in: 3600 });
        if (u.includes("Missing")) return jsonResponse({ error: { code: "itemNotFound" } }, 404);
        return jsonResponse({ id: "ITEM1", name: "cv.pdf", size: 10 });
      }) as typeof fetch;
      expect(await getItemByPath("d", "Role/Missing/cv.pdf", f)).toBeNull();
      expect((await getItemByPath("d", "Role/Here/cv.pdf", f))?.id).toBe("ITEM1");
    } finally {
      process.env = old;
    }
  });

  it("uploads large files in chunks without the bearer token on the session URL", async () => {
    const old = { ...process.env };
    Object.assign(process.env, env);
    try {
      const seen: { url: string; auth: string | null; range: string | null }[] = [];
      const f = (async (url: string | URL | Request, init?: RequestInit) => {
        const u = String(url);
        const h = new Headers(init?.headers);
        seen.push({ url: u, auth: h.get("Authorization"), range: h.get("Content-Range") });
        if (u.includes("oauth2")) return jsonResponse({ access_token: "tok", expires_in: 3600 });
        if (u.includes("createUploadSession")) return jsonResponse({ uploadUrl: "https://upload.example/session" });
        const range = h.get("Content-Range") ?? "";
        const total = Number(range.split("/")[1]);
        const end = Number(range.split("-")[1].split("/")[0]);
        return end + 1 >= total ? jsonResponse({ id: "BIG", name: "big.pdf", size: total }, 201) : jsonResponse({}, 202);
      }) as typeof fetch;
      const item = await uploadFile("d", "App uploads/x", "big.pdf", new Uint8Array(5 * 1024 * 1024), "application/pdf", f);
      expect(item.id).toBe("BIG");
      const chunks = seen.filter((s) => s.url.startsWith("https://upload.example"));
      expect(chunks.length).toBe(2);
      expect(chunks.every((c) => c.auth === null)).toBe(true);
    } finally {
      process.env = old;
    }
  });
});

import { describe, it, expect } from "vitest";
import { confirmUrl, safeNext, isConfirmType } from "@/lib/auth/links";

describe("confirmUrl", () => {
  it("points at the app's confirm route with the token, the kind and the page after", () => {
    const url = new URL(confirmUrl("https://planning.tippfocus.co.za", "abc123", "magiclink"));
    expect(url.origin).toBe("https://planning.tippfocus.co.za");
    expect(url.pathname).toBe("/auth/confirm");
    expect(url.searchParams.get("token_hash")).toBe("abc123");
    expect(url.searchParams.get("type")).toBe("magiclink");
    expect(url.searchParams.get("next")).toBe("/set-password");
  });

  it("sends a recovery to the reset page, and copes with a trailing slash on the app URL", () => {
    const url = new URL(confirmUrl("http://localhost:3000/", "t", "recovery"));
    expect(url.toString()).toBe("http://localhost:3000/auth/confirm?token_hash=t&type=recovery&next=%2Freset-password");
  });
});

describe("safeNext", () => {
  it("keeps a path on this site", () => {
    expect(safeNext("/set-password", "/dashboard")).toBe("/set-password");
    expect(safeNext("/tenders/abc?tab=team", "/dashboard")).toBe("/tenders/abc?tab=team");
  });

  it("refuses anything that could leave the site", () => {
    for (const bad of [null, "", "https://evil.example", "//evil.example/x", "/x y", "\\evil", "javascript:alert(1)"]) {
      expect(safeNext(bad, "/dashboard")).toBe("/dashboard");
    }
  });
});

describe("isConfirmType", () => {
  it("knows the two kinds and nothing else", () => {
    expect(isConfirmType("magiclink")).toBe(true);
    expect(isConfirmType("recovery")).toBe(true);
    expect(isConfirmType("signup")).toBe(false);
    expect(isConfirmType(null)).toBe(false);
  });
});

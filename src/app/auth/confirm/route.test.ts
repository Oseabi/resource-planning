import { describe, it, expect, vi, beforeEach } from "vitest";

const verifyOtp = vi.fn();
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({ auth: { verifyOtp } }),
}));

import { GET } from "@/app/auth/confirm/route";

const call = (query: string) => GET(new Request(`https://planning.example${query}`));

describe("GET /auth/confirm", () => {
  beforeEach(() => verifyOtp.mockReset());

  it("trades a good token for a session and sends the person on", async () => {
    verifyOtp.mockResolvedValue({ error: null });
    const res = await call("/auth/confirm?token_hash=abc&type=magiclink&next=%2Fset-password");
    expect(verifyOtp).toHaveBeenCalledWith({ type: "magiclink", token_hash: "abc" });
    expect(res.status).toBe(307);
    expect(res.headers.get("location")).toBe("https://planning.example/set-password");
  });

  it("falls back to the page that fits the kind of link when next is missing or points off the site", async () => {
    verifyOtp.mockResolvedValue({ error: null });
    expect((await call("/auth/confirm?token_hash=abc&type=recovery")).headers.get("location")).toBe(
      "https://planning.example/reset-password",
    );
    expect((await call("/auth/confirm?token_hash=abc&type=recovery&next=https%3A%2F%2Fevil.example")).headers.get("location")).toBe(
      "https://planning.example/reset-password",
    );
  });

  it("lands a dead or malformed link on the sign-in page with a word about it, without calling Supabase for a bad one", async () => {
    verifyOtp.mockResolvedValue({ error: { message: "Token has expired or is invalid" } });
    expect((await call("/auth/confirm?token_hash=old&type=magiclink")).headers.get("location")).toBe(
      "https://planning.example/login?link=expired",
    );
    verifyOtp.mockClear();
    expect((await call("/auth/confirm?token_hash=abc&type=signup")).headers.get("location")).toBe(
      "https://planning.example/login?link=expired",
    );
    expect((await call("/auth/confirm")).headers.get("location")).toBe("https://planning.example/login?link=expired");
    expect(verifyOtp).not.toHaveBeenCalled();
  });
});

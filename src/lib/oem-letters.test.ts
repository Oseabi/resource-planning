import { describe, it, expect } from "vitest";
import {
  daysUntilExpiry,
  expiryStatus,
  isUsable,
  buildFolders,
  EXPIRY_WARNING_DAYS,
} from "@/lib/oem-letters";

// Fixed "today" so the tests never drift with the wall clock.
const TODAY = new Date("2026-07-28T09:30:00Z");

describe("daysUntilExpiry", () => {
  it("counts whole days regardless of the time of day", () => {
    expect(daysUntilExpiry("2026-07-30", TODAY)).toBe(2);
  });
  it("is 0 on the expiry date itself", () => {
    expect(daysUntilExpiry("2026-07-28", TODAY)).toBe(0);
  });
  it("goes negative once past", () => {
    expect(daysUntilExpiry("2026-07-20", TODAY)).toBe(-8);
  });
  it("returns null when unset or unparseable", () => {
    expect(daysUntilExpiry(null, TODAY)).toBeNull();
    expect(daysUntilExpiry("", TODAY)).toBeNull();
    expect(daysUntilExpiry("not-a-date", TODAY)).toBeNull();
  });
});

describe("expiryStatus", () => {
  it("flags a lapsed letter as expired", () => {
    expect(expiryStatus("2026-07-27", TODAY)).toBe("expired");
  });
  it("treats the expiry date itself as still valid but expiring", () => {
    expect(expiryStatus("2026-07-28", TODAY)).toBe("expiring_soon");
  });
  it("warns inside the notice window", () => {
    expect(expiryStatus("2026-09-01", TODAY)).toBe("expiring_soon"); // 35 days
  });
  it("is valid beyond the notice window", () => {
    expect(expiryStatus("2027-01-01", TODAY)).toBe("valid");
  });
  it("uses the documented window boundary", () => {
    const boundary = new Date(TODAY.getTime() + EXPIRY_WARNING_DAYS * 86_400_000);
    const iso = boundary.toISOString().slice(0, 10);
    expect(expiryStatus(iso, TODAY)).toBe("expiring_soon");
  });
  it("is unknown when no expiry is recorded", () => {
    expect(expiryStatus(null, TODAY)).toBe("unknown");
  });
});

describe("isUsable", () => {
  it("blocks only expired letters", () => {
    expect(isUsable("expired")).toBe(false);
    expect(isUsable("valid")).toBe(true);
    expect(isUsable("expiring_soon")).toBe(true);
    expect(isUsable("unknown")).toBe(true);
  });
});

describe("buildFolders", () => {
  const letters = [
    { expiry_date: "2027-01-01", vendor: "Microsoft", categories: ["ERP", "Data & BI"] },
    { expiry_date: "2026-07-01", vendor: "Microsoft", categories: ["ERP"] }, // expired
    { expiry_date: "2026-08-15", vendor: "SAP", categories: ["ERP"] }, // expiring soon
    { expiry_date: null, vendor: "SAP", categories: [] },
  ];

  it("counts letters per vendor folder, busiest first", () => {
    const folders = buildFolders(letters, (l) => [(l as typeof letters[0]).vendor], TODAY);
    expect(folders.map((f) => f.name)).toEqual(["Microsoft", "SAP"]);
    expect(folders[0].count).toBe(2);
  });

  it("surfaces expired and expiring counts per folder", () => {
    const folders = buildFolders(letters, (l) => [(l as typeof letters[0]).vendor], TODAY);
    const microsoft = folders.find((f) => f.name === "Microsoft");
    const sap = folders.find((f) => f.name === "SAP");
    expect(microsoft?.expired).toBe(1);
    expect(sap?.expiringSoon).toBe(1);
    expect(sap?.expired).toBe(0);
  });

  it("lets one letter appear in several category folders", () => {
    const folders = buildFolders(letters, (l) => (l as typeof letters[0]).categories, TODAY);
    const byName = Object.fromEntries(folders.map((f) => [f.name, f.count]));
    expect(byName["ERP"]).toBe(3);
    expect(byName["Data & BI"]).toBe(1);
  });

  it("ignores blank keys", () => {
    const folders = buildFolders([{ expiry_date: null }], () => ["", "  "], TODAY);
    expect(folders).toEqual([]);
  });
});

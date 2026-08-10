/**
 * OEM letters, manufacturer authorisation letters used in tender submissions.
 * Pure domain helpers (vendor vocabulary + expiry status); no I/O, unit-tested.
 */

/** Common OEM/vendor names, offered as suggestions, free text is still allowed. */
export const OEM_VENDORS: string[] = [
  "Microsoft",
  "SAP",
  "Oracle",
  "Cisco",
  "Dell",
  "HP",
  "HPE",
  "Lenovo",
  "IBM",
  "VMware",
  "Amazon Web Services",
  "Google Cloud",
  "Fortinet",
  "Palo Alto Networks",
  "Check Point",
  "Veeam",
  "NetApp",
  "Huawei",
  "Schneider Electric",
  "Siemens",
  "ServiceNow",
  "Salesforce",
  "Adobe",
  "Red Hat",
  "Nutanix",
  "Mimecast",
  "Sophos",
  "Kaspersky",
  "Trend Micro",
  "Autodesk",
];

export type ExpiryStatus = "valid" | "expiring_soon" | "expired" | "unknown";

/** A letter within this many days of lapsing is flagged before it can cost a bid. */
export const EXPIRY_WARNING_DAYS = 60;

const MS_PER_DAY = 86_400_000;

/** Whole days until `expiryDate` (negative once past). Null when no date is set. */
export function daysUntilExpiry(
  expiryDate: string | null | undefined,
  today: Date = new Date(),
): number | null {
  if (!expiryDate) return null;
  const expiry = new Date(`${expiryDate}T00:00:00Z`);
  if (Number.isNaN(expiry.getTime())) return null;
  const start = Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate());
  return Math.round((expiry.getTime() - start) / MS_PER_DAY);
}

/** Validity bucket for an OEM letter, driving its badge and the readiness stats. */
export function expiryStatus(
  expiryDate: string | null | undefined,
  today: Date = new Date(),
): ExpiryStatus {
  const days = daysUntilExpiry(expiryDate, today);
  if (days === null) return "unknown";
  if (days < 0) return "expired";
  if (days <= EXPIRY_WARNING_DAYS) return "expiring_soon";
  return "valid";
}

export const EXPIRY_LABELS: Record<ExpiryStatus, string> = {
  valid: "Valid",
  expiring_soon: "Expiring soon",
  expired: "Expired",
  unknown: "No expiry set",
};

/** A letter is usable in a bid unless it has actually lapsed. */
export function isUsable(status: ExpiryStatus): boolean {
  return status !== "expired";
}

export interface VendorFolder {
  name: string;
  count: number;
  expired: number;
  expiringSoon: number;
}

/**
 * Group letters into "folders" for the browse view. Used for both the OEM-vendor
 * folders and the practice-area folders, so the counts stay consistent.
 */
export function buildFolders(
  letters: { expiry_date: string | null }[],
  keyOf: (letter: { expiry_date: string | null }) => string[],
  today: Date = new Date(),
): VendorFolder[] {
  const map = new Map<string, VendorFolder>();

  for (const letter of letters) {
    const status = expiryStatus(letter.expiry_date, today);
    for (const key of keyOf(letter)) {
      const name = key.trim();
      if (!name) continue;
      const folder = map.get(name) ?? { name, count: 0, expired: 0, expiringSoon: 0 };
      folder.count += 1;
      if (status === "expired") folder.expired += 1;
      if (status === "expiring_soon") folder.expiringSoon += 1;
      map.set(name, folder);
    }
  }

  return [...map.values()].sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
}

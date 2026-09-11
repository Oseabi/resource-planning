/**
 * Dates as documents write them, to the ISO form the database stores.
 *
 * The TiPP Focus template prints "05 February 1989" and "07 September 2026".
 * The only other shape allowed is ISO itself, so a value already stored is
 * accepted back. Anything else is refused rather than guessed at: a date is
 * exactly the kind of field where a guess looks right and is wrong.
 *
 * Pure, no I/O.
 */

const MONTHS: Record<string, number> = {
  january: 1,
  february: 2,
  march: 3,
  april: 4,
  may: 5,
  june: 6,
  july: 7,
  august: 8,
  september: 9,
  october: 10,
  november: 11,
  december: 12,
  jan: 1,
  feb: 2,
  mar: 3,
  apr: 4,
  jun: 6,
  jul: 7,
  aug: 8,
  sep: 9,
  sept: 9,
  oct: 10,
  nov: 11,
  dec: 12,
};

const pad = (n: number) => String(n).padStart(2, "0");

/** "05 February 1989" or "1989-02-05" to "1989-02-05", or null. */
export function parseLongDate(raw: string | null | undefined): string | null {
  const v = (raw ?? "").trim();
  if (!v) return null;

  const iso = v.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (iso) return real(Number(iso[1]), Number(iso[2]), Number(iso[3]));

  // "5 Feb 1989", "05 February 1989", "5th February, 1989".
  const long = v.match(/^(\d{1,2})(?:st|nd|rd|th)?\s+([A-Za-z]+),?\s+(\d{4})$/);
  if (long) {
    const month = MONTHS[long[2].toLowerCase()];
    if (!month) return null;
    return real(Number(long[3]), month, Number(long[1]));
  }

  // "February 5, 1989", as some export tools write it.
  const american = v.match(/^([A-Za-z]+)\s+(\d{1,2}),?\s+(\d{4})$/);
  if (american) {
    const month = MONTHS[american[1].toLowerCase()];
    if (!month) return null;
    return real(Number(american[3]), month, Number(american[2]));
  }

  return null;
}

/** An ISO string only if the calendar agrees the day exists. */
function real(y: number, m: number, d: number): string | null {
  if (m < 1 || m > 12 || d < 1 || d > 31 || y < 1900 || y > 2100) return null;
  const date = new Date(Date.UTC(y, m - 1, d));
  if (date.getUTCFullYear() !== y || date.getUTCMonth() !== m - 1 || date.getUTCDate() !== d) return null;
  return `${y}-${pad(m)}-${pad(d)}`;
}

/** "1989-02-05" to "05 February 1989", as the template prints it. */
export function formatLongDate(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return null;
  const names = [
    "January",
    "February",
    "March",
    "April",
    "May",
    "June",
    "July",
    "August",
    "September",
    "October",
    "November",
    "December",
  ];
  const month = names[Number(m[2]) - 1];
  return month ? `${m[3]} ${month} ${m[1]}` : null;
}

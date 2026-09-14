/**
 * The file name a download should carry, read off the response.
 *
 * The route names the file after the department the document goes out
 * under, which the button does not know; taking the name from the
 * Content-Disposition header keeps the two in step without a second
 * source of truth. Pure, no I/O.
 */
export function filenameFromDisposition(header: string | null | undefined, fallback: string): string {
  if (!header) return fallback;
  const quoted = header.match(/filename\*?=(?:UTF-8'')?"?([^";]+)"?/i);
  const name = quoted?.[1] ? decodeURIComponent(quoted[1]).trim() : "";
  return name || fallback;
}

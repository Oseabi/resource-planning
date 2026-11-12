/**
 * Read every row of a query, a page at a time.
 *
 * PostgREST answers at most a thousand rows and says nothing about the rest:
 * no error, no flag, just a shorter list. Matching read its candidates in one
 * query, so past a thousand people some would simply never have been scored,
 * and a ten-seat bid's match rows pass a thousand at a hundred candidates.
 *
 * The caller builds the query and applies the range, and must give it a total
 * order (a unique column last), or rows can repeat or go missing between pages.
 */
export const PAGE_SIZE = 1000;

export async function fetchAll<T>(
  page: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>,
  size = PAGE_SIZE,
): Promise<{ data: T[]; error: string | null }> {
  const rows: T[] = [];
  for (let from = 0; ; from += size) {
    const { data, error } = await page(from, from + size - 1);
    if (error) return { data: rows, error: error.message };
    rows.push(...(data ?? []));
    if (!data || data.length < size) return { data: rows, error: null };
  }
}

/** A list cut into runs of at most `size`, for writes too large for one request. */
export function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

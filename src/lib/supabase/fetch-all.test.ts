import { describe, it, expect } from "vitest";
import { fetchAll, chunk } from "@/lib/supabase/fetch-all";

const table = (n: number) => Array.from({ length: n }, (_, i) => ({ id: i }));
const pager = (rows: { id: number }[], calls: number[][] = []) => (from: number, to: number) => {
  calls.push([from, to]);
  return Promise.resolve({ data: rows.slice(from, to + 1), error: null });
};

describe("fetchAll", () => {
  it("reads past the thousand rows one query is silently cut at", async () => {
    const { data, error } = await fetchAll(pager(table(2350)));
    expect(error).toBeNull();
    expect(data).toHaveLength(2350);
    expect(new Set(data.map((r) => r.id)).size).toBe(2350);
  });

  it("asks once more when the last page was exactly full, and stops on the empty one", async () => {
    const calls: number[][] = [];
    const { data } = await fetchAll(pager(table(2000), calls));
    expect(data).toHaveLength(2000);
    expect(calls).toEqual([[0, 999], [1000, 1999], [2000, 2999]]);
  });

  it("makes one request for a short table", async () => {
    const calls: number[][] = [];
    await fetchAll(pager(table(22), calls));
    expect(calls).toHaveLength(1);
  });

  it("reports an error with what it had read so far", async () => {
    let n = 0;
    const { data, error } = await fetchAll<{ id: number }>(() => {
      n += 1;
      return Promise.resolve(n === 1 ? { data: table(1000), error: null } : { data: null, error: { message: "boom" } });
    });
    expect(error).toBe("boom");
    expect(data).toHaveLength(1000);
  });
});

describe("chunk", () => {
  it("cuts a list into runs and loses nothing", () => {
    expect(chunk([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]]);
    expect(chunk([], 500)).toEqual([]);
  });
});

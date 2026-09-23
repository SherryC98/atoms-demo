import { describe, it, expect, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { decide, checkAndIncrement, HOURLY_LIMIT } from "./rate-limit";

const L = { hourly: 20, daily: 100, global: 500 };

describe("rate-limit decide", () => {
  it("allows well under all limits", () => {
    expect(decide({ hourly: 3, daily: 10, global: 50 }, L).allowed).toBe(true);
  });
  it("allows exactly at limit (returned count == limit)", () => {
    expect(decide({ hourly: 20, daily: 100, global: 500 }, L).allowed).toBe(true);
  });
  it("blocks when hourly exceeded", () => {
    const r = decide({ hourly: 21, daily: 1, global: 1 }, L);
    expect(r.allowed).toBe(false);
    expect(r.reason).toBe("hourly");
  });
  it("blocks when daily exceeded", () => {
    expect(decide({ hourly: 1, daily: 101, global: 1 }, L).reason).toBe("daily");
  });
  it("blocks when global exceeded", () => {
    expect(decide({ hourly: 1, daily: 1, global: 501 }, L).reason).toBe("global");
  });
});

// ---- UC20: 限流边界 + fail-closed ----
describe("UC20 rate-limit boundary + fail-closed", () => {
  it("HOURLY_LIMIT constant is 20 (brief 边界基准)", () => {
    expect(HOURLY_LIMIT).toBe(20);
  });

  it("decide: hourly count == 20 (== limit) is allowed (count > limit 才拒)", () => {
    const r = decide({ hourly: 20, daily: 1, global: 1 }, L);
    expect(r.allowed).toBe(true);
  });

  it("decide: hourly count == 21 (> limit) is rejected with reason 'hourly'", () => {
    const r = decide({ hourly: 21, daily: 1, global: 1 }, L);
    expect(r.allowed).toBe(false);
    expect(r.reason).toBe("hourly");
  });

  it("decide: daily count over limit is rejected with reason 'daily'", () => {
    const r = decide({ hourly: 1, daily: 101, global: 1 }, L);
    expect(r.allowed).toBe(false);
    expect(r.reason).toBe("daily");
  });

  it("decide: global count over limit is rejected with reason 'global'", () => {
    const r = decide({ hourly: 1, daily: 1, global: 501 }, L);
    expect(r.allowed).toBe(false);
    expect(r.reason).toBe("global");
  });

  function mockSb(rpcResult: { data: unknown; error: unknown }): SupabaseClient {
    return { rpc: vi.fn().mockResolvedValue(rpcResult) } as unknown as SupabaseClient;
  }

  it("checkAndIncrement fail-closed: RPC returns an error -> allowed:false, never throws/allows", async () => {
    const sb = mockSb({ data: null, error: { message: "db unreachable" } });
    const r = await checkAndIncrement(sb);
    expect(r.allowed).toBe(false);
    expect((sb.rpc as any)).toHaveBeenCalledTimes(1);
  });

  it("checkAndIncrement fail-closed: RPC returns null data with no error -> allowed:false", async () => {
    const sb = mockSb({ data: null, error: null });
    const r = await checkAndIncrement(sb);
    expect(r.allowed).toBe(false);
  });

  it("checkAndIncrement fail-closed: RPC returns data missing numeric 'hourly' field -> allowed:false", async () => {
    const sb = mockSb({ data: { reason: "unauthenticated" }, error: null });
    const r = await checkAndIncrement(sb);
    expect(r.allowed).toBe(false);
    expect(r.reason).toBe("unauthenticated");
  });

  it("checkAndIncrement: RPC returns well-formed counts at exactly the limit -> allowed:true (not fail-closed on valid data)", async () => {
    const sb = mockSb({
      data: {
        hourly: 20, daily: 5, global: 5,
        hourly_limit: 20, daily_limit: 100, global_limit: 500,
      },
      error: null,
    });
    const r = await checkAndIncrement(sb);
    expect(r.allowed).toBe(true);
  });

  it("checkAndIncrement: RPC returns counts over limit -> allowed:false with reason", async () => {
    const sb = mockSb({
      data: {
        hourly: 21, daily: 5, global: 5,
        hourly_limit: 20, daily_limit: 100, global_limit: 500,
      },
      error: null,
    });
    const r = await checkAndIncrement(sb);
    expect(r.allowed).toBe(false);
    expect(r.reason).toBe("hourly");
  });
});

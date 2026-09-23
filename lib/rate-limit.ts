import type { SupabaseClient } from "@supabase/supabase-js";

export const HOURLY_LIMIT = 20;
export const DAILY_LIMIT = 100;
export const GLOBAL_HOURLY_LIMIT = 500;

export type Counts = { hourly: number; daily: number; global: number };
export type Limits = { hourly: number; daily: number; global: number };

// RPC 内已「先递增再返回」，所以返回值 <= 上限即放行；超过即拒。
export function decide(counts: Counts, limits: Limits): { allowed: boolean; reason?: string } {
  if (counts.hourly > limits.hourly) return { allowed: false, reason: "hourly" };
  if (counts.daily > limits.daily) return { allowed: false, reason: "daily" };
  if (counts.global > limits.global) return { allowed: false, reason: "global" };
  return { allowed: true };
}

export async function checkAndIncrement(
  sb: SupabaseClient
): Promise<{ allowed: boolean; reason?: string }> {
  const { data, error } = await sb.rpc("rl_incr", {
    p_hourly: HOURLY_LIMIT,
    p_daily: DAILY_LIMIT,
    p_global_hourly: GLOBAL_HOURLY_LIMIT,
  });

  // fail-closed：RPC 出错、无数据、或未认证(无计数字段) => 一律拒绝，绝不放行
  if (error || !data || typeof (data as any).hourly !== "number") {
    return { allowed: false, reason: (data as any)?.reason ?? "rpc-error" };
  }

  const counts: Counts = {
    hourly: (data as any).hourly,
    daily: (data as any).daily,
    global: (data as any).global,
  };
  const limits: Limits = {
    hourly: (data as any).hourly_limit,
    daily: (data as any).daily_limit,
    global: (data as any).global_limit,
  };
  return decide(counts, limits);
}

import type { Session } from "@supabase/supabase-js";
import { getBrowserClient } from "@/lib/supabase";

// 有 session 就复用；没有才匿名登录。绝不无条件 signInAnonymously（会丢旧项目）。
export async function ensureSession(): Promise<Session> {
  const sb = getBrowserClient();
  const { data: { session } } = await sb.auth.getSession();
  if (session) return session;
  const { data, error } = await sb.auth.signInAnonymously();
  if (error || !data.session) throw new Error(error?.message ?? "anonymous sign-in failed");
  return data.session;
}

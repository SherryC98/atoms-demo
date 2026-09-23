import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

// 浏览器端单例：同一会话跨组件/跨页复用，token 由 supabase-js 持久化到 localStorage
let browserClient: SupabaseClient | null = null;
export function getBrowserClient(): SupabaseClient {
  if (browserClient) return browserClient;
  browserClient = createClient(url, anonKey, {
    auth: { persistSession: true, autoRefreshToken: true },
  });
  return browserClient;
}

// 服务端：用请求带来的用户 access token 构造，RLS 与 auth.uid() 生效
export function getServerClient(accessToken: string): SupabaseClient {
  return createClient(url, anonKey, {
    global: { headers: { Authorization: `Bearer ${accessToken}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

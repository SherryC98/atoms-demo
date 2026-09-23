import { NextRequest, NextResponse } from "next/server";
import { callLLM } from "@/lib/llm";
import { buildRepairPrompt, SYSTEM_HTML } from "@/lib/prompts";
import { getServerClient } from "@/lib/supabase";
import { checkAndIncrement } from "@/lib/rate-limit";

export async function POST(req: NextRequest) {
  const { code, errors, accessToken } = await req.json();
  if (!accessToken || !code) return NextResponse.json({ error: "missing" }, { status: 400 });

  const sb = getServerClient(accessToken);
  const { data: userData } = await sb.auth.getUser();
  const uid = userData.user?.id;
  if (!uid) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { allowed } = await checkAndIncrement(sb);
  if (!allowed) return NextResponse.json({ error: "rate limited" }, { status: 429 });

  try {
    const fixed = await callLLM(buildRepairPrompt(code, errors ?? []), SYSTEM_HTML, 16000);
    return NextResponse.json({ code: fixed });
  } catch (e: any) {
    return NextResponse.json({ error: e.message ?? "llm error" }, { status: 502 });
  }
}

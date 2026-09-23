import { NextRequest, NextResponse } from "next/server";
import { callLLM } from "@/lib/llm";
import { buildPlanPrompt } from "@/lib/prompts";
import { getServerClient } from "@/lib/supabase";
import { checkAndIncrement } from "@/lib/rate-limit";

export async function POST(req: NextRequest) {
  const { need, accessToken } = await req.json();
  if (!need || !accessToken) return NextResponse.json({ error: "missing" }, { status: 400 });

  const sb = getServerClient(accessToken);
  const { data: userData } = await sb.auth.getUser();
  const uid = userData.user?.id;
  if (!uid) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { allowed } = await checkAndIncrement(sb);
  if (!allowed) return NextResponse.json({ error: "rate limited" }, { status: 429 });

  try {
    const plan = await callLLM(buildPlanPrompt(need), undefined, 1024);
    return NextResponse.json({ plan });
  } catch (e: any) {
    return NextResponse.json({ error: e.message ?? "llm error" }, { status: 502 });
  }
}

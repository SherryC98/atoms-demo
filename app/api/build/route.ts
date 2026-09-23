import { NextRequest, NextResponse } from "next/server";
import { callLLM } from "@/lib/llm";
import { buildBuildPrompt, buildEditPrompt, buildRestylePrompt, SYSTEM_HTML } from "@/lib/prompts";
import { getServerClient } from "@/lib/supabase";
import { checkAndIncrement } from "@/lib/rate-limit";

export async function POST(req: NextRequest) {
  const { need, plan, mode = "new", currentCode, change, accessToken } = await req.json();
  if (!accessToken) return NextResponse.json({ error: "missing" }, { status: 400 });

  const sb = getServerClient(accessToken);
  const { data: userData } = await sb.auth.getUser();
  const uid = userData.user?.id;
  if (!uid) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { allowed } = await checkAndIncrement(sb);
  if (!allowed) return NextResponse.json({ error: "rate limited" }, { status: 429 });

  let prompt: string;
  if (mode === "edit") {
    if (!currentCode || !change) return NextResponse.json({ error: "missing edit inputs" }, { status: 400 });
    prompt = buildEditPrompt(currentCode, change);
  } else if (mode === "restyle") {
    if (!currentCode) return NextResponse.json({ error: "missing currentCode for restyle" }, { status: 400 });
    prompt = buildRestylePrompt(currentCode, need ?? "");
  } else {
    prompt = buildBuildPrompt(plan ?? "", need ?? "");
  }

  try {
    const code = await callLLM(prompt, SYSTEM_HTML, 16000);
    return NextResponse.json({ code });
  } catch (e: any) {
    return NextResponse.json({ error: e.message ?? "llm error" }, { status: 502 });
  }
}

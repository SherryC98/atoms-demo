import { NextRequest, NextResponse } from "next/server";
import { validateHtml } from "@/lib/validate-html";

export async function POST(req: NextRequest) {
  const { code } = await req.json();
  return NextResponse.json(validateHtml(code ?? ""));
}

import { NextResponse } from "next/server";
import { BUILD_INFO } from "@/lib/build-info";

// 公开的版本信息接口，供评审核对线上部署与 GitHub 提交是否对应。
// 返回 { sha, ref, builtAt }；sha 对应 Vercel 构建时的 commit。
export function GET() {
  return NextResponse.json(BUILD_INFO);
}

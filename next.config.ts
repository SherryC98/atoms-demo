import type { NextConfig } from "next";

// 构建时把 Vercel 注入的 commit 信息「烘焙」进 NEXT_PUBLIC_ 变量。
// 关键：客户端组件只能读到 NEXT_PUBLIC_ 前缀的变量，直接读 VERCEL_GIT_COMMIT_SHA
// 在浏览器里是 undefined。next.config 在构建时（服务端）执行，此刻能读到 Vercel 变量。
const nextConfig: NextConfig = {
  eslint: {
    ignoreDuringBuilds: true,
  },
  env: {
    NEXT_PUBLIC_BUILD_SHA: process.env.VERCEL_GIT_COMMIT_SHA || "dev",
    NEXT_PUBLIC_BUILD_REF: process.env.VERCEL_GIT_COMMIT_REF || "local",
    NEXT_PUBLIC_BUILD_AT: new Date().toISOString(),
  },
};

export default nextConfig;

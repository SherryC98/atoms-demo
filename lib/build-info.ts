// 构建信息：让评审能把线上运行的版本与 GitHub 提交建立可核对的对应关系。
// 读 NEXT_PUBLIC_BUILD_* —— 这些在 next.config.ts 构建时由 Vercel 的
// VERCEL_GIT_COMMIT_SHA/REF 烘焙而来。用 NEXT_PUBLIC_ 前缀，客户端组件才能读到；
// 直接读 VERCEL_GIT_COMMIT_SHA 在浏览器里会是 undefined（回落成 dev）。
export type BuildInfo = { sha: string; ref: string; builtAt: string };

export const BUILD_INFO: BuildInfo = {
  sha: process.env.NEXT_PUBLIC_BUILD_SHA || "dev",
  ref: process.env.NEXT_PUBLIC_BUILD_REF || "local",
  builtAt: process.env.NEXT_PUBLIC_BUILD_AT || new Date().toISOString(),
};

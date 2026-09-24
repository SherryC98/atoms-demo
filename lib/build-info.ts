// 构建信息：让评审能把线上运行的版本与 GitHub 提交建立可核对的对应关系。
// Vercel 在构建时自动注入 VERCEL_GIT_COMMIT_SHA / VERCEL_GIT_COMMIT_REF；
// 本地开发无这些变量时回落到 "dev"。builtAt 在模块首次求值（即构建/启动）时确定。
export type BuildInfo = { sha: string; ref: string; builtAt: string };

export const BUILD_INFO: BuildInfo = {
  sha: process.env.VERCEL_GIT_COMMIT_SHA || "dev",
  ref: process.env.VERCEL_GIT_COMMIT_REF || "local",
  builtAt: new Date().toISOString(),
};

import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // 只跑 lib/**/*.test.ts 这类单测；明确排除 e2e/（Playwright 专属目录），
    // 避免 vitest 误把 .spec.ts 当单测跑（两者 test() 签名不兼容）。
    include: ["**/*.test.ts", "**/*.test.tsx"],
    exclude: ["node_modules", "e2e/**", ".next/**"],
  },
});

import { defineConfig, devices } from "@playwright/test";

/**
 * 只跑 e2e/ 目录，避免和 vitest（单测）互相干扰：
 * vitest 只认 lib/**\/*.test.ts，Playwright 只认 e2e/**\/*.spec.ts。
 */
export default defineConfig({
  testDir: "./e2e",
  timeout: 150_000, // 单个测试整体上限：真调网关一次生成可能要 30-60s，留足余量
  expect: {
    timeout: 15_000,
  },
  fullyParallel: false,
  retries: 0,
  workers: 1,
  reporter: [["list"]],
  use: {
    baseURL: "http://localhost:3000",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
  webServer: {
    command: "npm run build && npm run start",
    url: "http://localhost:3000",
    reuseExistingServer: false,
    timeout: 180_000,
  },
});

import { test, expect, type Page } from "@playwright/test";

/**
 * UC16 / UC17 / UC18：API Mock E2E（不调真实网关）。
 *
 * 只 mock /api/plan /api/build /api/repair 这三个会触发真实 LLM 调用的接口，
 * 用 page.route 在浏览器网络层拦截并伪造响应——请求根本不会离开浏览器进程，
 * 对应的 Next.js route handler（以及其中的 checkAndIncrement 限流写入）也不会执行。
 *
 * /api/validate 是纯本地、确定性、不花钱的校验逻辑，故意不 mock，让它真跑，
 * 这样"合法 HTML 通过校验 / 非法 HTML 被拒"这条链路测的是真实代码而不是我们编的假设。
 *
 * Supabase 的匿名登录 + 落库也是真实调用（不花钱），不 mock；每个 test 用 Playwright
 * 默认给的全新 browser context（=全新 localStorage=全新匿名会话），互不干扰。
 *
 * "非法 HTML" 统一用空字符串：validateHtml() 对空输出有显式分支
 * `{ ok:false, cleaned:"", errors:["empty output after stripping fences"] }`，
 * 是"截断/无输出"这类真实失败的一个确定性、不依赖 parse5 内部行为的代表。
 */

function validHtml(marker: string): string {
  return `<!doctype html><html><head><title>t</title></head><body><div id="marker">${marker}</div></body></html>`;
}
const INVALID_HTML = "";

async function gotoReady(page: Page) {
  await page.goto("/");
  await expect(page.getByPlaceholder(/描述你想要的应用/)).toBeEnabled({ timeout: 20_000 });
}

async function submitText(page: Page, text: string) {
  const input = page.getByPlaceholder(/描述你想要的应用|描述要修改的地方/);
  await input.fill(text);
  await input.press("Enter");
}

async function clickRestyle(page: Page) {
  await page.getByRole("button", { name: "换个风格" }).click();
}

async function expectErrorBanner(page: Page) {
  await expect(page.locator("text=出错：")).toBeVisible({ timeout: 15_000 });
}

async function clickRetry(page: Page) {
  const btn = page.getByRole("button", { name: "重试" });
  await expect(btn).toBeEnabled({ timeout: 10_000 });
  await btn.click();
}

async function expectFrameContains(page: Page, text: string) {
  const frame = page.frameLocator('iframe[title="preview"]');
  await expect(frame.locator("body")).toContainText(text, { timeout: 20_000 });
}

async function historyCount(page: Page): Promise<number> {
  const btn = page.getByRole("button", { name: /版本历史/ });
  const text = await btn.textContent();
  const m = text?.match(/(\d+)/);
  return m ? Number(m[1]) : -1;
}

async function mockPlanAlwaysOk(page: Page) {
  await page.route("**/api/plan", (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ plan: "mock plan" }) })
  );
}

test.describe("UC16 Mock API：失败重试", () => {
  test("首次生成失败后点重试，重新执行的是首次生成", async ({ page }) => {
    const buildCalls: string[] = [];
    let attempt = 0;

    await mockPlanAlwaysOk(page);
    await page.route("**/api/build", async (route) => {
      const body = route.request().postDataJSON() as { mode: string };
      buildCalls.push(body.mode);
      attempt++;
      if (attempt === 1) {
        await route.fulfill({ status: 502, contentType: "application/json", body: JSON.stringify({ error: "mock gateway 502" }) });
      } else {
        await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ code: validHtml("OK_new") }) });
      }
    });

    await gotoReady(page);
    await submitText(page, "做一个待办清单");

    await expectErrorBanner(page);
    await clickRetry(page);
    await expectFrameContains(page, "OK_new");

    expect(buildCalls).toEqual(["new", "new"]);
  });

  test("增量修改失败后点重试，重新执行的是这次修改", async ({ page }) => {
    const buildCalls: string[] = [];
    let editAttempt = 0;

    await mockPlanAlwaysOk(page);
    await page.route("**/api/build", async (route) => {
      const body = route.request().postDataJSON() as { mode: string };
      buildCalls.push(body.mode);
      if (body.mode === "edit") {
        editAttempt++;
        if (editAttempt === 1) {
          await route.fulfill({ status: 502, contentType: "application/json", body: JSON.stringify({ error: "mock gateway 502" }) });
          return;
        }
      }
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ code: validHtml(`OK_${body.mode}`) }) });
    });

    await gotoReady(page);
    await submitText(page, "做一个待办清单");
    await expectFrameContains(page, "OK_new");

    await submitText(page, "加个删除按钮");
    await expectErrorBanner(page);
    await clickRetry(page);
    await expectFrameContains(page, "OK_edit");

    expect(buildCalls).toEqual(["new", "edit", "edit"]);
  });

  test("换风格失败后点重试，重新执行的是换风格（回归：bug 修复前会误执行上一次的操作）", async ({ page }) => {
    const buildCalls: string[] = [];
    let restyleAttempt = 0;

    await mockPlanAlwaysOk(page);
    await page.route("**/api/build", async (route) => {
      const body = route.request().postDataJSON() as { mode: string };
      buildCalls.push(body.mode);
      if (body.mode === "restyle") {
        restyleAttempt++;
        if (restyleAttempt === 1) {
          await route.fulfill({ status: 502, contentType: "application/json", body: JSON.stringify({ error: "mock gateway 502" }) });
          return;
        }
      }
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ code: validHtml(`OK_${body.mode}`) }) });
    });

    await gotoReady(page);
    // 先做一次首次生成、再做一次增量修改，让 lastSubmission 在换风格之前是 "edit"——
    // 这正是 bug 报告里的场景：换风格失败后，若 handleRestyle 没写 lastSubmission，
    // "重试"会误执行上一条历史操作（这里是 edit）而不是重新换风格。
    await submitText(page, "做一个待办清单");
    await expectFrameContains(page, "OK_new");
    await submitText(page, "加个删除按钮");
    await expectFrameContains(page, "OK_edit");

    await clickRestyle(page);
    await expectErrorBanner(page);
    await clickRetry(page);
    await expectFrameContains(page, "OK_restyle");

    // 关键断言：换风格失败之后的两次 /api/build 请求都必须是 "restyle"，
    // 不能出现 "edit"（那就是 bug 复现）。
    expect(buildCalls).toEqual(["new", "edit", "restyle", "restyle"]);
  });
});

test.describe("UC17 Mock API：修复链", () => {
  test("Build 返回非法 HTML，Repair 返回合法 HTML：经过 Fixing 后进入 Done，且展示的是修复后的代码", async ({ page }) => {
    let buildCalled = 0;
    let repairCalled = 0;

    await mockPlanAlwaysOk(page);
    await page.route("**/api/build", async (route) => {
      buildCalled++;
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ code: INVALID_HTML }) });
    });
    await page.route("**/api/repair", async (route) => {
      repairCalled++;
      // 故意延迟一下，给测试留出窗口，稳定观察到 "Fixing" 这个只在 stage==="fixing" 时才渲染的徽标，
      // 而不是依赖 StageBar 里那批一进入非 idle 就会全部渲染出来的阶段标签。
      await new Promise((r) => setTimeout(r, 1200));
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ code: validHtml("REPAIRED_OK") }) });
    });

    await gotoReady(page);
    await submitText(page, "做一个待办清单");

    // "Fixing" 文案只在 StageBar 的 {stage === "fixing" && ...} 分支里出现，是可靠信号。
    await expect(page.getByText("Fixing", { exact: false })).toBeVisible({ timeout: 20_000 });

    await expectFrameContains(page, "REPAIRED_OK");
    await expect(page.locator("text=出错：")).toHaveCount(0);

    expect(buildCalled).toBe(1);
    expect(repairCalled).toBe(1);
  });
});

test.describe("UC18 Mock API：坏代码不落库", () => {
  test("Build 和 Repair 连续返回非法 HTML：进入 Error，原项目代码和版本数不变", async ({ page }) => {
    await mockPlanAlwaysOk(page);
    await page.route("**/api/build", async (route) => {
      const body = route.request().postDataJSON() as { mode: string };
      const code = body.mode === "new" ? validHtml("ORIGINAL_OK") : INVALID_HTML;
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ code }) });
    });
    await page.route("**/api/repair", async (route) => {
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ code: INVALID_HTML }) });
    });

    await gotoReady(page);

    // 先建立一个已有的正常项目。
    await submitText(page, "做一个待办清单");
    await expectFrameContains(page, "ORIGINAL_OK");
    // iframe 内容（setCode）和版本历史计数（setMessages，来自落库后的重新拉取）
    // 是两次独立的状态更新，不保证同一时刻生效，用 poll 等它稳定到期望值。
    await expect.poll(() => historyCount(page), { timeout: 10_000 }).toBe(1);
    const baselineVersions = 1;

    // 增量修改：build 和 repair 都返回非法 HTML → 两次 validate 都不过 → 应用进入 Error。
    await submitText(page, "加个删除按钮");

    // "Error" 文案只在 StageBar 的 {stage === "error" && ...} 分支里出现，是可靠信号。
    await expect(page.getByText(/Error/)).toBeVisible({ timeout: 20_000 });
    await expectErrorBanner(page);

    // 坏代码不预览：iframe 里仍是原来通过校验的代码，没有被替换成任何东西（也没有变空/崩溃）。
    await expectFrameContains(page, "ORIGINAL_OK");

    // 坏代码不落库、不新增版本：版本数量必须还是修改前的数量。
    // （这里不需要 poll——失败路径里代码从未走到 appendTurn/setMessages，数字不会再变。）
    expect(await historyCount(page)).toBe(baselineVersions);
  });
});

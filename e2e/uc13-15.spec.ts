import { test, expect, type Page, type FrameLocator, type Locator } from "@playwright/test";

/**
 * UC13 / UC14 / UC15：真实 E2E（真调网关，不 mock /api/plan /api/build /api/validate/repair）。
 *
 * 复用 todo-interaction.spec.ts 已经验证过的做法，避免重踩坑：
 * - 生成完成的判定：轮询 iframe 内容出现，绝不能靠"页面出现 Done 文本"
 *   （StageBar 一离开 idle 就把 Planning/Building/Validating/Done 四个标签全部渲染出来，
 *   只是用透明度/粗细区分是否 active）。
 * - iframe 内元素定位：图标按钮没有文字 name，用三级 fallback
 *   （role name → 输入框相邻按钮 → following::button）。
 * - 真调网关一次 30-90s，给足超时（单测 150-250s）。
 * - UC13/UC14 全程用同一个 page（= 同一个 browser context），
 *   保证匿名会话（localStorage 里的 token）在 reload 前后是同一个，
 *   不能像 uc16-18-mock 那样每个 test 用全新 context。
 */

const GENERATION_TIMEOUT = 150_000;

async function waitForAnonymousSession(page: Page) {
  await expect(page.getByPlaceholder(/描述你想要的应用/)).toBeEnabled({ timeout: 20_000 });
}

async function submitNeed(page: Page, text: string) {
  const input = page.getByPlaceholder(/描述你想要的应用|描述要修改的地方/);
  await input.fill(text);
  await input.press("Enter");
}

/** 见 todo-interaction.spec.ts 顶部注释：完成信号是 iframe（srcDoc）里真的出现了内容。 */
async function waitForGenerationDone(page: Page): Promise<FrameLocator> {
  const frame = page.frameLocator('iframe[title="preview"]');
  const errorBanner = page.locator("text=出错：");
  const retryButton = page.getByRole("button", { name: "重试" });

  let retriedOnce = false;
  const deadline = Date.now() + GENERATION_TIMEOUT;

  while (Date.now() < deadline) {
    const errorText = await errorBanner.first().textContent().catch(() => null);
    if (errorText) {
      if (!retriedOnce && (await retryButton.isEnabled().catch(() => false))) {
        retriedOnce = true;
        await retryButton.click();
      } else {
        throw new Error(`生成流程报错，测试判定失败：${errorText}`);
      }
    } else {
      const visible = await frame
        .locator("body *")
        .first()
        .isVisible()
        .catch(() => false);
      if (visible) {
        return frame;
      }
    }
    await page.waitForTimeout(1000);
  }
  throw new Error("等待生成完成超时：iframe 始终没有内容，也没有可恢复的出错提示");
}

/** 定位"添加"按钮：文字/可访问名 → 输入框旁边第一个按钮 → DOM 顺序上紧跟的第一个 button。 */
async function locateAddButton(frame: FrameLocator, todoInput: Locator): Promise<Locator> {
  const byName = frame.getByRole("button", { name: /添加|新增|add/i }).first();
  if (await byName.isVisible({ timeout: 5_000 }).catch(() => false)) {
    return byName;
  }
  const siblingButton = todoInput.locator("xpath=..").locator("button").first();
  if (await siblingButton.isVisible({ timeout: 5_000 }).catch(() => false)) {
    return siblingButton;
  }
  return todoInput.locator("xpath=following::button[1]");
}

/** 在 iframe 内的待办 app 里真的加一条待办，验证 iframe 仍然可交互。 */
async function verifyIframeInteractive(frame: FrameLocator, marker: string) {
  const todoInput = frame.getByRole("textbox").first();
  await expect(todoInput).toBeVisible({ timeout: 15_000 });
  const addButton = await locateAddButton(frame, todoInput);
  await expect(addButton).toBeVisible({ timeout: 15_000 });
  await todoInput.fill(marker);
  await addButton.click();
  await expect(frame.locator("body")).toContainText(marker, { timeout: 10_000 });
}

/** "版本历史（N）" 按钮文案里的数字。 */
async function historyCount(page: Page): Promise<number> {
  const btn = page.getByRole("button", { name: /版本历史/ });
  const text = await btn.textContent();
  const m = text?.match(/(\d+)/);
  return m ? Number(m[1]) : -1;
}

test.describe("UC13 刷新恢复", () => {
  test.describe.configure({ retries: 1 });

  test.skip("生成 + 增量修改后刷新页面，项目/消息/版本历史/预览均被恢复", async ({ page }) => {
    test.setTimeout(300_000);

    await page.goto("/");
    await waitForAnonymousSession(page);

    // 1) 首次生成
    await submitNeed(page, "做一个待办清单");
    await waitForGenerationDone(page);

    const messagesBefore = await page.locator("b:text('你'), b:text('AI')").count();
    const historyBefore = await historyCount(page);
    expect(historyBefore).toBeGreaterThanOrEqual(1);

    // 2) 一次增量修改
    await submitNeed(page, "标题改成蓝色");
    await waitForGenerationDone(page);

    const historyAfterEdit = await historyCount(page);
    expect(historyAfterEdit).toBeGreaterThan(historyBefore);

    const messagesAfterEdit = await page.locator("b:text('你'), b:text('AI')").count();
    expect(messagesAfterEdit).toBeGreaterThan(messagesBefore);

    // 3) 刷新——同一个 page/context，匿名会话（localStorage token）应被复用，不重新走 signInAnonymously
    await page.reload();
    await waitForAnonymousSession(page);

    // ---- 核心断言：刷新后当前项目被恢复 ----
    // 3a. 消息列表被恢复（不是空白，回到刷新前的条数）
    await expect
      .poll(async () => page.locator("b:text('你'), b:text('AI')").count(), { timeout: 15_000 })
      .toBe(messagesAfterEdit);

    // 3b. 版本历史被恢复（展开后条数不变）
    await expect.poll(() => historyCount(page), { timeout: 15_000 }).toBe(historyAfterEdit);

    // 3c. 当前代码被恢复：iframe（srcDoc）里仍有内容，且不需要重新生成
    const frame = page.frameLocator('iframe[title="preview"]');
    await expect(frame.locator("body")).not.toBeEmpty({ timeout: 15_000 });

    // 3d. 预览仍可操作：真的在 iframe 里加一条待办
    await verifyIframeInteractive(frame, "刷新后仍可交互");
  });
});

test.describe("UC14 Preview/Code 切换", () => {
  test.describe.configure({ retries: 1 });

  test.skip("生成后切到 Code 显示完整 HTML（不含 markdown 围栏），切回 Preview 仍可交互", async ({ page }) => {
    test.setTimeout(200_000);

    await page.goto("/");
    await waitForAnonymousSession(page);

    await submitNeed(page, "做一个待办清单");
    await waitForGenerationDone(page);

    // ---- 切到 Code ----
    await page.getByRole("button", { name: "Code" }).click();
    const codeBlock = page.locator("pre code");
    await expect(codeBlock).toBeVisible({ timeout: 10_000 });

    const codeText = (await codeBlock.textContent()) ?? "";
    expect(codeText.length).toBeGreaterThan(0);
    // 关键断言：不含 markdown 代码块围栏——validateHtml() 已经在服务端剥过一层，
    // 展示的必须是纯 HTML，不能再带 ``` 或 ```html。
    expect(codeText).not.toContain("```");
    // 是真实的完整 HTML 文档，而不是半截字符串。
    expect(codeText.toLowerCase()).toMatch(/<!doctype html|<html/);

    // ---- 切回 Preview ----
    await page.getByRole("button", { name: "Preview" }).click();
    const frame = page.frameLocator('iframe[title="preview"]');
    await expect(frame.locator("body")).not.toBeEmpty({ timeout: 10_000 });

    // 核心断言：切换 tab 不会破坏 iframe 状态——在里面真的加一条待办，文本要出现。
    await verifyIframeInteractive(frame, "切回预览仍可交互");
  });
});

test.describe("UC15 独立预览权限", () => {
  test.describe.configure({ retries: 1 });

  test.skip("同一身份可打开独立预览页；全新匿名身份访问同一预览页被 RLS 拒绝", async ({ page, browser }) => {
    test.setTimeout(220_000);

    await page.goto("/");
    await waitForAnonymousSession(page);

    await submitNeed(page, "做一个待办清单");
    await waitForGenerationDone(page);

    // 拿 projectId：读"新窗口打开"链接的 href（只有 projectId 存在时才会渲染）。
    const previewLink = page.getByRole("link", { name: "新窗口打开" });
    await expect(previewLink).toBeVisible({ timeout: 10_000 });
    const href = await previewLink.getAttribute("href");
    expect(href).toBeTruthy();
    const previewPath = href!; // 形如 /preview/<uuid>

    // ---- 同一 context：能加载出 app 内容 ----
    const samePage = await page.context().newPage();
    await samePage.goto(previewPath);
    const sameFrame = samePage.frameLocator('iframe[title="preview"]');
    await expect(sameFrame.locator("body")).not.toBeEmpty({ timeout: 20_000 });
    await expect(samePage.getByText("找不到该应用或无权访问")).toHaveCount(0);
    await samePage.close();

    // ---- 全新 browser context（=全新匿名身份）：访问同一预览页应被 RLS 隔离拒绝 ----
    const freshContext = await browser.newContext();
    try {
      const freshPage = await freshContext.newPage();
      await freshPage.goto(previewPath);
      // 新匿名身份会触发一次新的 signInAnonymously，之后 ensureSession() 完成、
      // RLS 按 auth.uid() 过滤 projects 行——非本人项目查不到，展示"找不到该应用或无权访问"。
      await expect(freshPage.getByText("找不到该应用或无权访问")).toBeVisible({ timeout: 20_000 });
      await expect(freshPage.frameLocator('iframe[title="preview"]').locator("body")).toHaveCount(0);
    } finally {
      await freshContext.close();
    }
  });
});

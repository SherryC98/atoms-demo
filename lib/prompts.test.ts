import { describe, it, expect } from "vitest";
import {
  buildPlanPrompt, buildBuildPrompt, buildEditPrompt,
  buildRestylePrompt, buildRepairPrompt, SYSTEM_HTML,
} from "./prompts";

describe("prompts", () => {
  it("plan prompt asks for plain-language steps, forbids jargon", () => {
    const p = buildPlanPrompt("做一个待办清单");
    expect(p).toContain("待办清单");
    expect(p.toLowerCase()).toContain("plain");
  });
  it("build prompt includes plan and need", () => {
    const p = buildBuildPrompt("步骤A", "做个计算器");
    expect(p).toContain("步骤A");
    expect(p).toContain("计算器");
  });
  it("edit prompt includes current code and change", () => {
    const p = buildEditPrompt("<html>current</html>", "标题改红色");
    expect(p).toContain("<html>current</html>");
    expect(p).toContain("标题改红色");
  });
  it("restyle prompt carries current code so features are preserved", () => {
    const p = buildRestylePrompt("<html>current</html>", "做个计算器");
    expect(p).toContain("<html>current</html>");   // 关键：必须带当前代码
    expect(p).toContain("计算器");
    expect(p.toLowerCase()).toContain("keep");      // 要求保留功能
  });
  it("repair prompt includes errors", () => {
    const p = buildRepairPrompt("<html>bad", ["empty or missing body"]);
    expect(p).toContain("empty or missing body");
  });
  it("system enforces single self-contained HTML + whitelist", () => {
    expect(SYSTEM_HTML).toContain("cdn.jsdelivr.net");
    expect(SYSTEM_HTML.toLowerCase()).toContain("html");
  });
});

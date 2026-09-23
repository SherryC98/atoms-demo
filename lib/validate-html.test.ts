import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";
import { validateHtml } from "./validate-html";

const CSP_MARK = "Content-Security-Policy";
const TRUSTED = "default-src 'none'";

describe("validateHtml", () => {
  it("strips markdown fences", () => {
    const r = validateHtml("```html\n<html><head></head><body><h1>hi</h1></body></html>\n```");
    expect(r.ok).toBe(true);
    expect(r.cleaned).not.toContain("```");
  });

  it("rejects empty body", () => {
    expect(validateHtml("<html><head></head><body></body></html>").ok).toBe(false);
  });

  it("rejects oversized by real UTF-8 byte length", () => {
    const big = "<html><head></head><body>" + "x".repeat(210_000) + "</body></html>";
    expect(validateHtml(big).ok).toBe(false);
  });

  it("rejects non-whitelisted external script[src]", () => {
    const r = validateHtml('<html><head></head><body><script src="https://evil.com/x.js"></script>text</body></html>');
    expect(r.ok).toBe(false);
    expect(r.errors.join()).toContain("evil.com");
  });

  it("allows whitelisted CDN script", () => {
    const r = validateHtml('<html><head></head><body><script src="https://cdn.jsdelivr.net/npm/x"></script>text</body></html>');
    expect(r.ok).toBe(true);
  });

  it("does NOT flag normal anchor href or img src (only script[src] / stylesheet link)", () => {
    const r = validateHtml(
      '<html><head></head><body>' +
      '<a href="https://example.com/page">link</a>' +
      '<img src="https://images.example.com/a.png">' +
      '</body></html>'
    );
    expect(r.ok).toBe(true);
  });

  it("flags non-whitelisted stylesheet link[href], ignores non-stylesheet link", () => {
    const bad = validateHtml('<html><head><link rel="stylesheet" href="https://evil.com/a.css"></head><body>x</body></html>');
    expect(bad.ok).toBe(false);
    expect(bad.errors.join()).toContain("evil.com");
    const ok = validateHtml('<html><head><link rel="icon" href="https://evil.com/favicon.ico"></head><body>x</body></html>');
    // icon link 不是 stylesheet，不应被外链扫描误杀（但空 body 除外，这里 body 有内容）
    expect(ok.ok).toBe(true);
  });

  it("injects trusted CSP as first head child and removes any model-supplied CSP", () => {
    const r = validateHtml(
      '<html><head><meta http-equiv="Content-Security-Policy" content="default-src *"><title>t</title></head><body>x</body></html>'
    );
    expect(r.ok).toBe(true);
    // 只保留一个可信 CSP
    const occurrences = r.cleaned.split(CSP_MARK).length - 1;
    expect(occurrences).toBe(1);
    expect(r.cleaned).toContain(TRUSTED);
    expect(r.cleaned).not.toContain("default-src *");
    // 注入到 head 首位：CSP 出现在 <title> 之前
    expect(r.cleaned.indexOf(CSP_MARK)).toBeLessThan(r.cleaned.indexOf("<title>"));
  });

  it("fails on truncated HTML (eof-in-tag class parse error)", () => {
    const r = validateHtml("<html><head></head><body><div class=\"x");
    expect(r.ok).toBe(false);
  });

  // ---- UC19: 安全隔离 ----
  describe("UC19 security isolation", () => {
    it("rejects non-whitelisted external <script src> and names the offending host in errors", () => {
      const r = validateHtml(
        '<html><head></head><body><script src="https://evil.com/x.js"></script>text</body></html>'
      );
      expect(r.ok).toBe(false);
      expect(r.errors.join()).toContain("evil.com");
    });

    it("allows whitelisted CDN hosts (cdn.jsdelivr.net, cdnjs.cloudflare.com, cdn.tailwindcss.com)", () => {
      const jsdelivr = validateHtml(
        '<html><head></head><body><script src="https://cdn.jsdelivr.net/npm/x"></script>ok</body></html>'
      );
      const cdnjs = validateHtml(
        '<html><head></head><body><script src="https://cdnjs.cloudflare.com/ajax/libs/x/x.js"></script>ok</body></html>'
      );
      const tailwind = validateHtml(
        '<html><head></head><body><script src="https://cdn.tailwindcss.com"></script>ok</body></html>'
      );
      expect(jsdelivr.ok).toBe(true);
      expect(cdnjs.ok).toBe(true);
      expect(tailwind.ok).toBe(true);
    });

    it("injected CSP locks down default-src / object-src / frame-src and does not mention allow-same-origin", () => {
      const r = validateHtml('<html><head></head><body>hi</body></html>');
      expect(r.ok).toBe(true);
      expect(r.cleaned).toContain("default-src 'none'");
      expect(r.cleaned).toContain("object-src 'none'");
      expect(r.cleaned).toContain("frame-src 'none'");
      // allow-same-origin 是 iframe sandbox 属性，不属于 CSP 语义；CSP 字符串里绝不应出现它
      expect(r.cleaned).not.toContain("allow-same-origin");
    });

    // 注意：源文件里的注释本身会写“不加 allow-same-origin”来解释意图，
    // 所以不能对整份文件字符串做 not.toContain；要单独抠出 sandbox="..." 的属性值来断言。
    function sandboxAttrValue(src: string): string {
      const m = /sandbox="([^"]*)"/.exec(src);
      if (!m) throw new Error("no sandbox attribute found in source");
      return m[1];
    }

    it("preview iframe sandbox attribute is exactly allow-scripts allow-forms, never allow-same-origin (PreviewPane.tsx)", () => {
      const src = readFileSync(join(process.cwd(), "components", "PreviewPane.tsx"), "utf8");
      const value = sandboxAttrValue(src);
      expect(value).toBe("allow-scripts allow-forms");
      expect(value).not.toContain("allow-same-origin");
    });

    it("standalone preview page iframe sandbox attribute is exactly allow-scripts allow-forms, never allow-same-origin (app/preview/[id]/page.tsx)", () => {
      const src = readFileSync(join(process.cwd(), "app", "preview", "[id]", "page.tsx"), "utf8");
      const value = sandboxAttrValue(src);
      expect(value).toBe("allow-scripts allow-forms");
      expect(value).not.toContain("allow-same-origin");
    });
  });
});

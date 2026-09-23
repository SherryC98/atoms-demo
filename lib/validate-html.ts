import { parse, serialize, defaultTreeAdapter, html } from "parse5";

const WHITELIST = ["cdnjs.cloudflare.com", "cdn.jsdelivr.net", "cdn.tailwindcss.com"];
const MAX_BYTES = 200_000;
const TRUSTED_CSP =
  "default-src 'none'; " +
  "script-src 'unsafe-inline' https://cdnjs.cloudflare.com https://cdn.jsdelivr.net https://cdn.tailwindcss.com; " +
  "style-src 'unsafe-inline' https:; img-src data: https:; connect-src 'none'; " +
  "object-src 'none'; frame-src 'none'; form-action 'none';";

// ---- 小工具：parse5 default tree adapter 下的节点遍历 ----
type AnyNode = any;
function childNodesOf(node: AnyNode): AnyNode[] {
  return node && Array.isArray(node.childNodes) ? node.childNodes : [];
}
function findFirst(root: AnyNode, tag: string): AnyNode | null {
  for (const c of childNodesOf(root)) {
    if (c.tagName === tag) return c;
    const deep = findFirst(c, tag);
    if (deep) return deep;
  }
  return null;
}
function collectByTag(root: AnyNode, tag: string, acc: AnyNode[] = []): AnyNode[] {
  for (const c of childNodesOf(root)) {
    if (c.tagName === tag) acc.push(c);
    collectByTag(c, tag, acc);
  }
  return acc;
}
function attrOf(el: AnyNode, name: string): string | undefined {
  return el.attrs?.find((a: AnyNode) => a.name === name)?.value;
}
function bodyHasContent(body: AnyNode): boolean {
  const walk = (n: AnyNode): boolean => {
    for (const c of childNodesOf(n)) {
      if (c.tagName) return true;
      if (c.nodeName === "#text" && typeof c.value === "string" && c.value.trim()) return true;
      if (walk(c)) return true;
    }
    return false;
  };
  return !!body && walk(body);
}
// 仅当是绝对 http(s) URL 时才返回其 host（相对 URL / data: / 锚点返回 null，不参与外链扫描）
function externalHost(url: string | undefined): string | null {
  if (!url) return null;
  const m = /^https?:\/\/([^/?#"'\s]+)/i.exec(url.trim());
  return m ? m[1].toLowerCase() : null;
}
function whitelisted(host: string): boolean {
  return WHITELIST.some((w) => host === w || host.endsWith("." + w));
}

export function validateHtml(raw: string): { ok: boolean; cleaned: string; errors: string[] } {
  // const errors: string[] = [];

  // // 1. 剥 markdown 围栏
  // const stripped = raw
  //   .trim()
  //   .replace(/^```(?:html)?\s*/i, "")
  //   .replace(/```\s*$/, "")
  //   .trim();

  // if (!stripped) {
  //   return { ok: false, cleaned: "", errors: ["empty output after stripping fences"] };
  // }

    const errors: string[] = [];

  // 1. 提取 HTML 文档本身，剥掉模型可能附带的前言/尾巴/markdown 围栏。
  //    话痨模型（如 DeepSeek）常在 HTML 前后加自然语言说明和 ```html 围栏，
  //    仅靠“剥两端围栏”会漏；改为直接定位 <!DOCTYPE/<html ... </html> 这一段。
  let stripped = raw.trim();

  // 1a. 先去掉 markdown 代码围栏（```html ... ```），无论它在整段何处包裹代码
  const fence = /```(?:html|HTML)?\s*([\s\S]*?)```/;
  const fenceMatch = fence.exec(stripped);
  if (fenceMatch && /<(?:!doctype|html)/i.test(fenceMatch[1])) {
    stripped = fenceMatch[1].trim();
  }

  // 1b. 截取真正的 HTML 文档：从第一个 <!DOCTYPE 或 <html> 开始，到最后一个 </html> 结束，
  //     丢弃前言（Here is a ...）和尾巴（Optimization Tip ...）等非 HTML 文本
  const startMatch = /<!doctype\s+html|<html[\s>]/i.exec(stripped);
  if (startMatch) {
    const start = startMatch.index;
    const closeIdx = stripped.toLowerCase().lastIndexOf("</html>");
    const end = closeIdx >= 0 ? closeIdx + "</html>".length : stripped.length;
    stripped = stripped.slice(start, end).trim();
  }

  if (!stripped) {
    return { ok: false, cleaned: "", errors: ["empty output after stripping fences"] };
  }

  // 2. parse5 解析，onParseError 收集所有错误码
  const parseErrorCodes: string[] = [];
  const doc = parse(stripped, {
    sourceCodeLocationInfo: false,
    onParseError: (err: { code: string }) => parseErrorCodes.push(err.code),
  });

  // 2b. 合并「致命」解析错误到 errors（关键：原代码收集了却没用）。
  //     致命 = EOF-in-* 一类(通常是被截断的输出) 及空字符，其余 parse5 能自愈的告警不致命。
  const fatal = parseErrorCodes.filter(
    (c) => c.startsWith("eof-in-") || c === "unexpected-null-character"
  );
  for (const c of fatal) errors.push(`fatal parse error: ${c}`);

  // 3. 结构定位
  const head = findFirst(doc, "head");
  const body = findFirst(doc, "body");
  if (!head) errors.push("missing <head> element");
  if (!bodyHasContent(body)) errors.push("empty or missing body");

  // 4. 外链白名单：只扫 script[src] 与 link[rel=stylesheet][href]，绝不误杀普通 href / img
  for (const s of collectByTag(doc, "script")) {
    const host = externalHost(attrOf(s, "src"));
    if (host && !whitelisted(host)) errors.push(`non-whitelisted external script host: ${host}`);
  }
  for (const l of collectByTag(doc, "link")) {
    const rel = (attrOf(l, "rel") || "").toLowerCase().split(/\s+/);
    if (!rel.includes("stylesheet")) continue;
    const host = externalHost(attrOf(l, "href"));
    if (host && !whitelisted(host)) errors.push(`non-whitelisted external stylesheet host: ${host}`);
  }

  // 5. CSP：用 AST 删掉模型生成的任何 CSP meta，再把可信 CSP 注入 head 首位
  if (head) {
    head.childNodes = childNodesOf(head).filter((c: AnyNode) => {
      if (c.tagName !== "meta") return true;
      const he = (attrOf(c, "http-equiv") || "").toLowerCase();
      return he !== "content-security-policy";
    });
    const meta = defaultTreeAdapter.createElement("meta", html.NS.HTML, [
      { name: "http-equiv", value: "Content-Security-Policy" },
      { name: "content", value: TRUSTED_CSP },
    ]);
    (meta as AnyNode).parentNode = head;
    head.childNodes.unshift(meta as AnyNode);
  }

  // 6. 序列化 + 按真实 UTF-8 字节数校验大小（不用 .length）
  const cleaned = serialize(doc);
  const bytes = Buffer.byteLength(cleaned, "utf8");
  if (bytes > MAX_BYTES) errors.push(`too large: ${bytes} bytes > ${MAX_BYTES}`);

  return { ok: errors.length === 0, cleaned, errors };
}

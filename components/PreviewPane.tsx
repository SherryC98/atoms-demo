export function PreviewPane({ code, tab }: { code: string; tab: "preview" | "code" }) {
  if (tab === "code") {
    return (
      <pre style={{ overflow: "auto", height: "100%", margin: 0, padding: 12, background: "#0b0b0b", color: "#e6e6e6" }}>
        <code>{code || "// 还没有生成代码"}</code>
      </pre>
    );
  }
  return (
    <iframe
      title="preview"
      sandbox="allow-scripts allow-forms" /* 加 allow-forms 让表单交互可用;坚决不加 allow-same-origin(防逃逸) */
      srcDoc={code}
      style={{ width: "100%", height: "100%", border: 0, background: "#fff" }}
    />
  );
}

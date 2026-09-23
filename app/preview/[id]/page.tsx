"use client";
import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { ensureSession } from "@/lib/session";
import { getBrowserClient } from "@/lib/supabase";

export default function PreviewPage() {
  const params = useParams<{ id: string }>();
  const [code, setCode] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        await ensureSession();
        const sb = getBrowserClient();
        const { data, error } = await sb.from("projects")
          .select("current_code")
          .eq("id", params.id)
          .maybeSingle();
        if (error) throw error;
        if (!data?.current_code) { setError("找不到该应用或无权访问"); return; }
        setCode(data.current_code);
      } catch (e: any) {
        setError(e.message ?? "加载失败");
      }
    })();
  }, [params.id]);

  if (error) return <div style={{ padding: 24, color: "var(--danger)" }}>{error}</div>;
  if (code === null) return <div style={{ padding: 24, color: "var(--text-muted)" }}>加载中…</div>;
  return (
    <iframe
      title="preview"
      sandbox="allow-scripts allow-forms"  /* 与主界面同一套隔离(加 allow-forms),不加 allow-same-origin,不用 Blob URL */
      srcDoc={code}
      style={{ position: "fixed", inset: 0, width: "100%", height: "100%", border: 0, background: "#fff" }}
    />
  );
}

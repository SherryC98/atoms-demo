"use client";
import { useEffect, useState, useCallback } from "react";
import { StageBar, type Stage } from "@/components/StageBar";
import { PreviewPane } from "@/components/PreviewPane";
import { getBrowserClient } from "@/lib/supabase";
import { ensureSession } from "@/lib/session";
import { runAgent } from "@/lib/agent-client";
import {
  createProject, appendTurn, loadAllProjects, loadProject, loadMessages, restoreVersion,
  type MessageRow, type ProjectListItem,
} from "@/lib/persistence";
import { BUILD_INFO } from "@/lib/build-info";

const EXAMPLES = ["做一个待办清单", "做一个计算器", "做一个番茄钟"];

export default function Home() {
  const [ready, setReady] = useState(false);
  const [stage, setStage] = useState<Stage>("idle");
  const [planText, setPlanText] = useState("");
  const [code, setCode] = useState("");
  const [tab, setTab] = useState<"preview" | "code">("preview");
  const [historyOpen, setHistoryOpen] = useState(false);
  const [projectsOpen, setProjectsOpen] = useState(false);   // 顶部「历史记录」跨项目列表
  const [projects, setProjects] = useState<ProjectListItem[]>([]);

  const [need, setNeed] = useState("");          // 当前项目的原始需求（供 edit/restyle 使用）
  const [projectId, setProjectId] = useState<string | null>(null);
  const [messages, setMessages] = useState<MessageRow[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastSubmission, setLastSubmission] = useState<{ kind: "create" | "edit" | "restyle"; text: string } | null>(null);

  // 挂载：只复用会话，默认干净态（不自动恢复上次项目）。
  // 历史项目留在库里，需用户从顶部「历史记录」里主动点开才加载。
  useEffect(() => {
    (async () => {
      try {
        await ensureSession();
      } catch (e: any) {
        setError(e.message ?? "初始化失败");
      } finally {
        setReady(true);
      }
    })();
  }, []);

  // 打开「历史记录」下拉：拉一次跨项目列表
  async function toggleProjects() {
    const next = !projectsOpen;
    setProjectsOpen(next);
    if (next) {
      try {
        const sb = getBrowserClient();
        setProjects(await loadAllProjects(sb));
      } catch (e: any) {
        setError(e.message ?? "读取历史记录失败");
      }
    }
  }

  // 从历史记录里点开某个项目：加载其代码与对话
  async function openProject(id: string) {
    setBusy(true); setError(null); setProjectsOpen(false);
    try {
      const sb = getBrowserClient();
      const proj = await loadProject(sb, id);
      if (!proj) { setError("该项目不存在"); return; }
      setProjectId(proj.id);
      setCode(proj.current_code ?? "");
      setNeed(proj.title ?? "");
      setMessages(await loadMessages(sb, proj.id));
      setTab("preview");
      setStage(proj.current_code ? "done" : "idle");
      setPlanText("");
    } catch (e: any) {
      setError(e.message ?? "打开历史项目失败");
    } finally {
      setBusy(false);
    }
  }

  // 回到干净的新建态（不删除任何历史，只是清空当前视图）
  function newProject() {
    setProjectId(null); setCode(""); setNeed(""); setMessages([]);
    setInput(""); setPlanText(""); setError(null);
    setLastSubmission(null); setTab("preview"); setStage("idle");
    setProjectsOpen(false);
  }

  const onStage = useCallback((s: Stage, extra?: { plan?: string; errors?: string[] }) => {
    setStage(s);
    if (extra?.plan) setPlanText(extra.plan);
  }, []);

  // 首次生成
  async function handleCreate(text: string) {
    setBusy(true); setError(null); setPlanText("");
    setLastSubmission({ kind: "create", text });
    try {
      const session = await ensureSession();
      const token = session.access_token;
      const { code: newCode, plan } = await runAgent({ mode: "new", need: text }, token, onStage);
      const sb = getBrowserClient();
      const proj = await createProject(sb, session.user.id, text.slice(0, 60), newCode);
      await appendTurn(sb, proj.id, text, plan, newCode, "new");
      // 存库成功后才 Done
      setProjectId(proj.id);
      setNeed(text);
      setCode(newCode);
      setMessages(await loadMessages(sb, proj.id));
      setTab("preview");
      setStage("done");
    } catch (e: any) {
      setError(e.message ?? "生成失败");
      setStage("error");
    } finally {
      setBusy(false);
    }
  }

  // 增量修改（Task 9 复用）
  async function handleEdit(change: string) {
    if (!projectId) return;
    setBusy(true); setError(null);
    setLastSubmission({ kind: "edit", text: change });
    try {
      const session = await ensureSession();
      const { code: newCode, plan } = await runAgent(
        { mode: "edit", need, currentCode: code, change }, session.access_token, onStage
      );
      const sb = getBrowserClient();
      await appendTurn(sb, projectId, change, plan, newCode, "edit");
      setCode(newCode);
      setMessages(await loadMessages(sb, projectId));
      setStage("done");
    } catch (e: any) {
      setError(e.message ?? "修改失败");
      setStage("error");
    } finally {
      setBusy(false);
    }
  }

  async function handleRestyle() {
    if (!projectId || !code) return;
    setBusy(true); setError(null);
    setLastSubmission({ kind: "restyle", text: "" });
    try {
      const session = await ensureSession();
      // restyle 传入当前 code（保留增量修改后的功能），而非只传原始 need
      const { code: newCode, plan } = await runAgent(
        { mode: "restyle", need, currentCode: code }, session.access_token, onStage
      );
      const sb = getBrowserClient();
      await appendTurn(sb, projectId, "换个风格", plan, newCode, "restyle");
      setCode(newCode);
      setMessages(await loadMessages(sb, projectId));
      setStage("done");
    } catch (e: any) {
      setError(e.message ?? "换风格失败");
      setStage("error");
    } finally {
      setBusy(false);
    }
  }

  // 回滚（git revert 语义）：追加一个不可变的新版本，而非改写指针。
  // fromLabel 如 "v2"，会写进新版本说明并显示在版本历史里。
  async function handleRestore(snapshot: string, fromLabel: string) {
    if (!projectId) return;
    setBusy(true); setError(null);
    try {
      const sb = getBrowserClient();
      await restoreVersion(sb, projectId, snapshot, fromLabel);
      setCode(snapshot);
      setMessages(await loadMessages(sb, projectId)); // 重新拉取，让新增的回滚版本出现在版本历史
      setTab("preview");
      setStage("done");
    } catch (e: any) {
      setError(e.message ?? "恢复失败");
    } finally {
      setBusy(false);
    }
  }

  function submit() {
    const text = input.trim();
    if (!text || busy) return;
    setInput("");
    if (projectId) handleEdit(text);
    else handleCreate(text);
  }

  // 重试：对最近一次提交的文本重跑（不重新读输入框，取 state 里保存的那次）
  function retry() {
    if (!lastSubmission || busy) return;
    if (lastSubmission.kind === "create") handleCreate(lastSubmission.text);
    else if (lastSubmission.kind === "edit") handleEdit(lastSubmission.text);
    else handleRestyle();
  }

  if (!ready) return <div style={{ padding: 24, color: "var(--text-muted)" }}>加载中…</div>;

  return (
    <div style={{ display: "flex", height: "100vh", background: "var(--bg)" }}>
      {/* 左：顶栏(历史记录/新建) + 聊天 + 版本历史 + 阶段条 + 输入 */}
      <div style={{ width: "38%", minWidth: 340, background: "var(--surface)", borderRight: "1px solid var(--border)", display: "flex", flexDirection: "column" }}>
        {/* 顶栏：历史记录入口 + 新建 */}
        <div style={{ position: "relative", borderBottom: "1px solid var(--border)", padding: "10px 12px", display: "flex", gap: 8, alignItems: "center" }}>
          <span style={{ fontWeight: 700, fontSize: 15, color: "var(--primary)", marginRight: 4 }}>Atoms</span>
          <button className="btn btn-ghost" onClick={toggleProjects} disabled={busy}>
            {projectsOpen ? "▾" : "▸"} 历史记录
          </button>
          <button className="btn btn-ghost" onClick={newProject} disabled={busy} style={{ marginLeft: "auto" }}>
            ＋ 新建
          </button>
          {projectsOpen && (
            <div style={{
              position: "absolute", top: "100%", left: 12, right: 12, zIndex: 10, marginTop: 6,
              background: "var(--surface)", border: "1px solid var(--border)", borderRadius: "var(--r-md)",
              boxShadow: "var(--shadow-md)", maxHeight: 340, overflow: "auto",
            }}>
              {projects.length === 0 && <div style={{ padding: 16, color: "var(--text-muted)", fontSize: 14 }}>暂无历史记录</div>}
              {projects.map((p) => (
                <button key={p.id} onClick={() => openProject(p.id)} disabled={busy}
                  className={`history-item${p.id === projectId ? " is-current" : ""}`}>
                  <div className="history-title">{p.title || "未命名"}</div>
                  <div className="history-time">{new Date(p.updated_at).toLocaleString()}</div>
                </button>
              ))}
            </div>
          )}
        </div>

        <div style={{ flex: 1, overflow: "auto", padding: 16 }}>
          {messages.length === 0 && (
            <div>
              <h2 style={{ fontSize: 20, fontWeight: 700, marginBottom: 4 }}>想做点什么小应用？👋</h2>
              <p style={{ color: "var(--text-muted)", fontSize: 14, marginBottom: 12 }}>用一句话描述，AI 几十秒帮你生成：</p>
              {EXAMPLES.map((ex) => (
                <button key={ex} className="example-chip" onClick={() => handleCreate(ex)} disabled={busy}>
                  {ex}
                </button>
              ))}
            </div>
          )}
          {messages.map((m) => (
            <div key={m.id} className={`msg ${m.role === "user" ? "msg-user" : "msg-assistant"}`}>
              <span className="msg-role">{m.role === "user" ? "你" : "AI"}</span>
              <span className="msg-bubble">{m.content}</span>
            </div>
          ))}
          {stage === "planning" && planText && (
            <div className="msg msg-assistant">
              <span className="msg-role">AI 计划</span>
              <pre className="msg-bubble" style={{ fontFamily: "inherit" }}>{planText}</pre>
            </div>
          )}
          {error && (
            <div style={{ margin: "12px 0", padding: "10px 12px", borderRadius: "var(--r-md)", background: "var(--danger-soft)", color: "var(--danger)", fontSize: 14 }}>
              <div>出错：{error}</div>
              {lastSubmission && (
                <button className="btn" onClick={retry} disabled={busy} style={{ marginTop: 8 }}>
                  重试
                </button>
              )}
            </div>
          )}
        </div>

        {/* 版本历史（当前项目内的多轮版本） */}
        <div style={{ borderTop: "1px solid var(--border)" }}>
          <button className="btn btn-ghost" onClick={() => setHistoryOpen((v) => !v)} style={{ width: "100%", textAlign: "left", borderRadius: 0, fontSize: 13 }}>
            {historyOpen ? "▾" : "▸"} 版本历史（{messages.filter((m) => m.role === "assistant").length}）
          </button>
          {historyOpen && (
            <div style={{ padding: "4px 12px 8px", maxHeight: 200, overflow: "auto" }}>
              {messages.filter((m) => m.role === "assistant" && m.code_snapshot).map((m, i) => (
                <div key={m.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, padding: "6px 0" }}>
                  <span style={{ fontSize: 13, color: m.mode === "revert" ? "var(--primary)" : "var(--text-muted)" }}>
                    v{i + 1} · {new Date(m.created_at).toLocaleTimeString()} · {m.mode === "revert" ? `↩ ${m.content}` : m.mode}
                  </span>
                  <button className="btn" onClick={() => handleRestore(m.code_snapshot!, `v${i + 1}`)} disabled={busy} style={{ padding: "4px 10px", fontSize: 13 }}>回到这一版</button>
                </div>
              ))}
              {messages.filter((m) => m.role === "assistant" && m.code_snapshot).length === 0 && <span style={{ color: "var(--text-muted)", fontSize: 13 }}>暂无版本</span>}
            </div>
          )}
        </div>

        <StageBar stage={stage} />

        <div style={{ padding: 12, borderTop: "1px solid var(--border)", display: "flex", gap: 8 }}>
          <input
            className="input"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && submit()}
            placeholder={projectId ? "描述要修改的地方…" : "描述你想要的应用…"}
            disabled={busy}
            style={{ flex: 1 }}
          />
          <button className="btn btn-primary" onClick={submit} disabled={busy}>{busy ? "…" : "发送"}</button>
        </div>

        {/* 构建版本：供核对线上与 GitHub 提交的对应关系（完整信息见 /api/version 或 window.__ATOMS_BUILD__） */}
        <div style={{ padding: "4px 12px 8px", fontSize: 11, color: "var(--text-faint)", textAlign: "center" }}>
          build {BUILD_INFO.sha === "dev" ? "dev" : BUILD_INFO.sha.slice(0, 7)} · {BUILD_INFO.ref}
        </div>
      </div>

      {/* 右：预览 */}
      <div style={{ flex: 1, display: "flex", flexDirection: "column", background: "var(--bg)" }}>
        <div style={{ padding: "10px 12px", display: "flex", gap: 6, alignItems: "center", borderBottom: "1px solid var(--border)" }}>
          <button className={`btn btn-ghost${tab === "preview" ? " is-active" : ""}`} onClick={() => setTab("preview")}>预览</button>
          <button className={`btn btn-ghost${tab === "code" ? " is-active" : ""}`} onClick={() => setTab("code")}>代码</button>
          <button className="btn" onClick={handleRestyle} disabled={busy || !projectId} style={{ marginLeft: 8 }}>🎨 换个风格</button>
          {projectId && (
            <a className="btn btn-ghost" href={`/preview/${projectId}`} target="_blank" rel="noopener noreferrer"
               style={{ marginLeft: "auto" }}>↗ 新窗口打开</a>
          )}
        </div>
        <div style={{ flex: 1, padding: 16, overflow: "hidden" }}>
          <div style={{ height: "100%", borderRadius: "var(--r-lg)", overflow: "hidden", boxShadow: "var(--shadow-md)", background: "var(--surface)" }}>
            <PreviewPane code={code} tab={tab} />
          </div>
        </div>
      </div>
    </div>
  );
}

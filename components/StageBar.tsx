export type Stage = "idle" | "planning" | "building" | "validating" | "fixing" | "done" | "error";

const ORDER: Stage[] = ["planning", "building", "validating", "done"];
const LABELS: Record<Stage, string> = {
  idle: "", planning: "Planning", building: "Building",
  validating: "Validating", fixing: "Fixing", done: "Done", error: "Error",
};

export function StageBar({ stage }: { stage: Stage }) {
  if (stage === "idle") return null;
  const activeIdx = ORDER.indexOf(stage === "fixing" ? "validating" : stage);
  return (
    <div style={{
      display: "flex", gap: 12, padding: "10px 12px", alignItems: "center", flexWrap: "wrap",
      borderTop: "1px solid var(--border)", background: "var(--surface-soft)", fontSize: 13,
    }}>
      {ORDER.map((s, i) => (
        <span key={s} style={{
          fontWeight: s === stage ? 700 : 400,
          color: i <= activeIdx ? "var(--primary)" : "var(--text-muted)",
          opacity: i <= activeIdx ? 1 : 0.6,
        }}>
          {i <= activeIdx ? "●" : "○"} {LABELS[s]}
        </span>
      ))}
      {stage === "fixing" && <span style={{ fontWeight: 700, color: "var(--primary)" }}>{"⟳"} Fixing</span>}
      {stage === "error" && <span style={{ color: "var(--danger)", fontWeight: 600 }}>{"✕"} Error</span>}
    </div>
  );
}

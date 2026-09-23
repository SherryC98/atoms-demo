import type { Stage } from "@/components/StageBar";

async function post(url: string, body: unknown): Promise<any> {
  const r = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const json = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(json?.error ? `${url}: ${json.error}` : `${url} ${r.status}`);
  return json;
}

export type RunInput =
  | { mode: "new"; need: string }
  | { mode: "edit"; need: string; currentCode: string; change: string }
  | { mode: "restyle"; need: string; currentCode: string };

// 返回已通过校验的 cleaned 代码。注意：本函数不发出 "done"/"error"，
// "done" 必须由调用方在数据库保存成功之后设置；异常由调用方 catch 后置 "error"。
export async function runAgent(
  input: RunInput,
  accessToken: string,
  onStage: (s: Stage, extra?: { plan?: string; errors?: string[] }) => void
): Promise<{ code: string; plan: string }> {
  let plan = "";

  if (input.mode === "new") {
    onStage("planning");
    const r = await post("/api/plan", { need: input.need, accessToken });
    plan = r.plan;
    onStage("planning", { plan });
  }

  onStage("building");
  const buildBody =
    input.mode === "new"
      ? { mode: "new", need: input.need, plan, accessToken }
      : input.mode === "edit"
      ? { mode: "edit", need: input.need, currentCode: input.currentCode, change: input.change, accessToken }
      : { mode: "restyle", need: input.need, currentCode: input.currentCode, accessToken };
  let { code } = await post("/api/build", buildBody);

  onStage("validating");
  let v = await post("/api/validate", { code });

  if (!v.ok) {
    onStage("fixing", { errors: v.errors });
    const rep = await post("/api/repair", { code, errors: v.errors, accessToken });
    code = rep.code;
    onStage("validating");
    v = await post("/api/validate", { code });
    if (!v.ok) {
      // 第二次仍失败：抛异常。禁止 return 坏代码 / 预览 / 持久化。
      throw new Error("生成的应用两次校验均未通过：" + (v.errors ?? []).join("; "));
    }
  }

  const label = input.mode === "edit" ? input.change : input.mode === "restyle" ? "换个风格" : plan;
  return { code: v.cleaned, plan: label };
}

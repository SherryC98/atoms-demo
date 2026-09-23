import type { SupabaseClient } from "@supabase/supabase-js";

export type ProjectRow = {
  id: string; title: string | null; current_code: string | null; current_version_id: string | null;
};
export type MessageRow = {
  id: string; project_id: string; role: string; content: string | null;
  stage: string | null; mode: string | null; code_snapshot: string | null; created_at: string;
};

export async function createProject(
  sb: SupabaseClient, userId: string, title: string, code: string
): Promise<ProjectRow> {
  const { data, error } = await sb
    .from("projects")
    .insert({ user_id: userId, title, current_code: code })
    .select("id, title, current_code, current_version_id")
    .single();
  if (error) throw error;
  return data as ProjectRow;
}

// 写一轮对话：user 消息 + assistant 消息(带 code_snapshot)，再把项目的 current_code/current_version_id/updated_at 指到这条新版本
export async function appendTurn(
  sb: SupabaseClient, projectId: string, userContent: string,
  assistantContent: string, code: string, mode: string
): Promise<string> {
  const { error: uErr } = await sb.from("messages")
    .insert({ project_id: projectId, role: "user", content: userContent, mode });
  if (uErr) throw uErr;

  const { data: asst, error: aErr } = await sb.from("messages")
    .insert({ project_id: projectId, role: "assistant", content: assistantContent, stage: "done", mode, code_snapshot: code })
    .select("id")
    .single();
  if (aErr) throw aErr;

  const { error: pErr } = await sb.from("projects")
    .update({ current_code: code, current_version_id: asst.id, updated_at: new Date().toISOString() })
    .eq("id", projectId);
  if (pErr) throw pErr;

  return asst.id as string;
}

export async function loadLatestProject(sb: SupabaseClient): Promise<ProjectRow | null> {
  const { data, error } = await sb.from("projects")
    .select("id, title, current_code, current_version_id")
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return (data as ProjectRow) ?? null;
}

export type ProjectListItem = { id: string; title: string | null; updated_at: string };

// 历史记录：列出本人所有项目（按最近更新倒序），供「历史记录」入口选择
export async function loadAllProjects(sb: SupabaseClient): Promise<ProjectListItem[]> {
  const { data, error } = await sb.from("projects")
    .select("id, title, updated_at")
    .order("updated_at", { ascending: false });
  if (error) throw error;
  return (data as ProjectListItem[]) ?? [];
}

// 按 id 加载单个历史项目（用户从历史记录里主动点开时调用）
export async function loadProject(sb: SupabaseClient, id: string): Promise<ProjectRow | null> {
  const { data, error } = await sb.from("projects")
    .select("id, title, current_code, current_version_id")
    .eq("id", id)
    .maybeSingle();
  if (error) throw error;
  return (data as ProjectRow) ?? null;
}

export async function loadMessages(sb: SupabaseClient, projectId: string): Promise<MessageRow[]> {
  const { data, error } = await sb.from("messages")
    .select("id, project_id, role, content, stage, mode, code_snapshot, created_at")
    .eq("project_id", projectId)
    .order("created_at", { ascending: true });
  if (error) throw error;
  return (data as MessageRow[]) ?? [];
}

// Restore：把项目当前版本指回某条历史 assistant 消息（Task 9 用）
export async function restoreVersion(
  sb: SupabaseClient, projectId: string, messageId: string, code: string
): Promise<void> {
  const { error } = await sb.from("projects")
    .update({ current_code: code, current_version_id: messageId, updated_at: new Date().toISOString() })
    .eq("id", projectId);
  if (error) throw error;
}

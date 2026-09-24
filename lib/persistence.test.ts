import { describe, it, expect, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { restoreVersion } from "./persistence";

// 构造一个能记录 insert/update 载荷的 Supabase mock。
// insert(...).select(...).single() -> 返回新版本 id；update(...).eq(...) -> 记录更新载荷。
function mockSb() {
  const inserted: any[] = [];
  const updated: any[] = [];
  const from = vi.fn((table: string) => ({
    insert: (payload: any) => {
      inserted.push({ table, payload });
      return {
        select: () => ({
          single: async () => ({ data: { id: "v4-new-id" }, error: null }),
        }),
      };
    },
    update: (payload: any) => ({
      eq: async (_col: string, _val: string) => {
        updated.push({ table, payload });
        return { error: null };
      },
    }),
  }));
  return { sb: { from } as unknown as SupabaseClient, inserted, updated };
}

describe("restoreVersion — git revert 语义（追加不可变新版本，不改写历史）", () => {
  it("追加一条 assistant 消息作为新版本，code_snapshot=旧快照，mode=revert", async () => {
    const { sb, inserted } = mockSb();
    await restoreVersion(sb, "proj-1", "<html>v2 snapshot</html>", "v2");

    // 只应有一次 insert，写进 messages 表
    expect(inserted).toHaveLength(1);
    expect(inserted[0].table).toBe("messages");
    const p = inserted[0].payload;
    expect(p.role).toBe("assistant");
    expect(p.mode).toBe("revert");                       // 标记为回滚版本，供审计
    expect(p.code_snapshot).toBe("<html>v2 snapshot</html>"); // 内容来自被回滚到的旧快照
    expect(p.content).toContain("v2");                   // 说明回滚来源
  });

  it("把项目当前指针指向新版本，而不是指回旧消息", async () => {
    const { sb, updated } = mockSb();
    const newId = await restoreVersion(sb, "proj-1", "<html>snap</html>", "v2");

    expect(newId).toBe("v4-new-id");
    expect(updated).toHaveLength(1);
    expect(updated[0].table).toBe("projects");
    expect(updated[0].payload.current_version_id).toBe("v4-new-id"); // 指向新追加的版本
    expect(updated[0].payload.current_code).toBe("<html>snap</html>");
  });

  it("不对任何已有 messages 执行 update/delete（历史不可改写）", async () => {
    const { sb, updated } = mockSb();
    await restoreVersion(sb, "proj-1", "<html>snap</html>", "v2");

    // 唯一的 update 是针对 projects 指针；messages 表不应被 update（即不改写旧版本）
    const messageUpdates = updated.filter((u) => u.table === "messages");
    expect(messageUpdates).toHaveLength(0);
  });
});

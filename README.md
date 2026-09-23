# Atoms Demo

一句话描述需求，AI 在几十秒内生成一个可运行的单页 HTML 小应用（待办清单 / 计算器 / 番茄钟等），并支持继续对话式增量修改、一键换风格、版本历史回溯与独立预览。

## 产品简介

- 输入一句自然语言需求 → AI 先出一份「小白也能看懂」的实现计划 → 再生成完整单文件 HTML 应用 → 服务端校验/清洗/注入安全策略后展示在隔离的 iframe 里。
- 支持基于当前应用继续追加修改（保留已有功能）、一键"换个风格"（保留功能、改视觉）。
- 每一轮生成都落库为一个版本，可在历史列表中随时"回到这一版"。
- 每个应用都有一个独立的只读预览地址 `/preview/[id]`，可在新窗口打开分享。
- 匿名会话（无需注册登录），项目与会话绑定，同一浏览器刷新后自动恢复最近项目。

## 架构

```
浏览器 (Next.js Client Component)
  ├─ lib/session.ts     匿名登录 / 复用会话（Supabase Auth）
  ├─ lib/supabase.ts     浏览器端单例 client（受 RLS 约束，只能读写自己的项目）
  ├─ lib/agent-client.ts 编排 plan → build → validate → (repair → validate) 的调用序列
  └─ lib/persistence.ts  项目/消息/版本的读写

        │ fetch (携带 accessToken)
        ▼
Next.js Route Handlers (app/api/*)
  ├─ /api/plan      调用 LLM 生成计划（面向非技术人员的自然语言步骤）
  ├─ /api/build     调用 LLM 生成/修改/换风格完整 HTML
  ├─ /api/validate  parse5 解析 → 结构校验 → 外链白名单校验 → 注入可信 CSP
  └─ /api/repair    校验失败时把错误反馈给 LLM，要求修复后重新生成
        │
        ├─ lib/llm.ts          走公司 OpenAI 兼容网关（openai SDK + 自定义 baseURL）
        ├─ lib/validate-html.ts  parse5 AST 校验与清洗（详见 docs/WRITEUP.md）
        └─ lib/rate-limit.ts    调用 Supabase RPC 做原子限流，fail-closed

Supabase (Postgres + Auth)
  ├─ projects / messages 表，RLS 仅允许 user_id = auth.uid()
  └─ rate_limits 表：无任何 RLS 策略，只能通过 SECURITY DEFINER 的 rl_incr() RPC 原子读写
```

预览分两处渲染，用的是同一套隔离策略（`sandbox="allow-scripts"`，不加 `allow-same-origin`，用 `srcDoc` 而非 Blob URL）：
- 主界面右侧 Preview/Code 切换视图（`components/PreviewPane.tsx`）。
- 独立只读预览页 `/preview/[id]`（`app/preview/[id]/page.tsx`），可在新窗口打开分享，服务端不经过 cookie 鉴权，由浏览器端持有的匿名会话 + Supabase RLS 保证只能取到本人项目的代码。

## 技术栈

- **框架**：Next.js 15（App Router，Turbopack），React 19，TypeScript
- **LLM**：通过公司内部提供的 OpenAI 协议兼容网关调用（`openai` SDK + 自定义 `baseURL`），非直连官方 API
- **数据与鉴权**：Supabase（Postgres + Row Level Security + 匿名登录 Auth）
- **HTML 校验/清洗**：`parse5`（AST 级解析，剥 markdown 围栏、结构检查、CDN 白名单扫描、CSP 注入）
- **测试**：Vitest（对纯逻辑模块做单元测试：validate-html / prompts / rate-limit）
- **部署**：Vercel

## 本地运行

```powershell
npm install
npm run dev
```

打开 http://localhost:3000。

首次运行前需要：
1. 在 Supabase 项目中执行 `supabase/schema.sql` 建表、RLS 策略与限流 RPC。
2. 在 Supabase Auth 设置中启用 Anonymous Sign-ins。
3. 复制 `.env.local`（不提交到 git）并填好下方 5 个环境变量。

## 环境变量

| 变量 | 说明 |
|---|---|
| `LLM_BASE_URL` | 公司 OpenAI 协议兼容网关的 base URL（仅服务端使用，不下发到浏览器） |
| `LLM_API_KEY` | 网关鉴权密钥（仅服务端使用，绝不出现在前端打包产物或 Network 响应体中） |
| `LLM_MODEL` | 调用的模型名 |
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase 项目 URL（浏览器端可见，Supabase 设计上允许公开） |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase 匿名 anon key（浏览器端可见，实际数据访问权限由 RLS 收窄到本人数据） |

`LLM_*` 三个变量只在服务端 Route Handler（`lib/llm.ts`）中读取，绝不加 `NEXT_PUBLIC_` 前缀，因此不会被打进客户端 bundle。

## 关键取舍

- **走公司网关而非直连模型官方 API**：牺牲了一部分官方 SDK 的高级特性（如原生流式 SSE），换来的是密钥集中管控、成本可审计、符合公司安全合规要求——细节见 `docs/WRITEUP.md`。
- **阶段展示用离散状态机而非真实 SSE 流式**：`planning → building → validating → (fixing) → done` 是按请求边界推进的粗粒度阶段条，不是逐 token 流式输出。换来的是实现简单、每一步都有明确的可重试边界，代价是单步耗时较长时用户看不到"打字机"式反馈。
- **CDN 外链只开白名单三家（cdnjs / jsdelivr / cdn.tailwindcss.com）**：牺牲了模型生成时更自由的库选择，换来的是可预测、可审计的攻击面，配合 CSP 兜底。
- **校验失败允许一次自动修复重试，第二次仍失败直接抛异常**：不返回、不预览、不落库任何未通过校验的代码，保证用户看到的应用一定是通过安全校验的。
- **限流 fail-closed**：限流 RPC 出错、无数据或身份异常时一律拒绝生成请求，而不是"看不清楚就放行"，避免网关成本被打爆。
- **匿名会话而非账号体系**：为了让评测者无需注册即可跑通主流程；代价是项目与浏览器 localStorage 绑定，换设备/清缓存会丢失项目归属（但代码仍在数据库中，只是失去访问凭证）。

不复制任何笔试题原文；关于评测维度与创新点的完整说明见 `docs/WRITEUP.md`。

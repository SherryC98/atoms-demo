-- ============ 业务表 ============
create table projects (
  id                 uuid primary key default gen_random_uuid(),
  user_id            uuid not null references auth.users(id),
  title              text,
  current_code       text,
  current_version_id uuid,            -- 指向 messages.id 的真实外键，Restore/生成后更新（约束在下方 alter 添加，规避循环依赖）
  created_at         timestamptz default now(),
  updated_at         timestamptz default now()
);

create table messages (
  id            uuid primary key default gen_random_uuid(),
  project_id    uuid not null references projects(id) on delete cascade,
  role          text check (role in ('user','assistant')),
  content       text,
  stage         text,                 -- planning|building|validating|fixing|done
  mode          text,                 -- new|edit|restyle|repair
  code_snapshot text,                 -- 该轮生成/修改后的代码快照（=版本）
  created_at    timestamptz default now()
);

-- current_version_id 的真实外键（messages 建表后再加，避免 create table 时的循环引用）
alter table projects
  add constraint fk_current_version
  foreign key (current_version_id) references messages(id) on delete set null;

-- 限流表：bucket 区分 小时/每日/全局；不给任何角色 RLS 策略，只经 SECURITY DEFINER RPC 写
create table rate_limits (
  bucket       text not null,         -- 'h:<uid>' | 'd:<uid>' | 'g'
  window_start timestamptz not null,
  count        int not null default 0,
  primary key (bucket, window_start)
);

-- ============ RLS ============
alter table projects    enable row level security;
alter table messages    enable row level security;
alter table rate_limits enable row level security;   -- 开启但故意不建策略 => 匿名/登录用户无法直接读写，防篡改

create policy own_projects on projects
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

create policy own_messages on messages
  for all using (exists (select 1 from projects p
    where p.id = messages.project_id and p.user_id = auth.uid()))
  with check (exists (select 1 from projects p
    where p.id = messages.project_id and p.user_id = auth.uid()));

-- ============ 限流 RPC：原子递增 + fail-closed 由调用方兜 ============
-- SECURITY DEFINER 以函数所有者权限运行，绕过 rate_limits 的 RLS（该表无策略）。
-- 用户身份来自请求 JWT 的 auth.uid()，不信任任何入参 uid，杜绝伪造他人配额。
create or replace function rl_incr(
  p_hourly        int default 20,
  p_daily         int default 100,
  p_global_hourly int default 500
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid  uuid := auth.uid();
  v_hour timestamptz := date_trunc('hour', now());
  v_day  timestamptz := date_trunc('day',  now());
  v_h int; v_d int; v_g int;
begin
  if v_uid is null then
    return jsonb_build_object('allowed', false, 'reason', 'unauthenticated');
  end if;

  insert into rate_limits(bucket, window_start, count)
    values ('h:' || v_uid::text, v_hour, 1)
    on conflict (bucket, window_start) do update set count = rate_limits.count + 1
    returning count into v_h;

  insert into rate_limits(bucket, window_start, count)
    values ('d:' || v_uid::text, v_day, 1)
    on conflict (bucket, window_start) do update set count = rate_limits.count + 1
    returning count into v_d;

  insert into rate_limits(bucket, window_start, count)
    values ('g', v_hour, 1)
    on conflict (bucket, window_start) do update set count = rate_limits.count + 1
    returning count into v_g;

  return jsonb_build_object(
    'hourly', v_h, 'daily', v_d, 'global', v_g,
    'hourly_limit', p_hourly, 'daily_limit', p_daily, 'global_limit', p_global_hourly
  );
end;
$$;

-- 仅暴露执行权限给应用角色；直接读写 rate_limits 表仍被 RLS 挡死
grant execute on function rl_incr(int, int, int) to anon, authenticated;

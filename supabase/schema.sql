create table if not exists public.app_state (
  id text primary key,
  data jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

create table if not exists public.user_roles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  role text not null check (role in ('관리자', '선생님', '의료인')),
  created_at timestamptz not null default now()
);

alter table public.app_state enable row level security;
alter table public.user_roles enable row level security;

create or replace function public.current_app_role()
returns text
language sql
stable
security definer
set search_path = public
as $$
  select role from public.user_roles where user_id = auth.uid()
$$;

drop policy if exists "authenticated users can read app state" on public.app_state;
create policy "authenticated users can read app state"
on public.app_state
for select
to authenticated
using (true);

drop policy if exists "authenticated users can write shared app state" on public.app_state;
drop policy if exists "admins can write app state" on public.app_state;
create policy "authenticated users can write shared app state"
on public.app_state
for all
to authenticated
using (public.current_app_role() in ('관리자', '선생님', '의료인'))
with check (public.current_app_role() in ('관리자', '선생님', '의료인'));

drop policy if exists "users can read own role" on public.user_roles;
create policy "users can read own role"
on public.user_roles
for select
to authenticated
using (user_id = auth.uid());

insert into public.app_state (id, data)
values ('main', '{"participants":[],"groups":[{"id":"group-1","name":"1조"},{"id":"group-2","name":"2조"},{"id":"group-3","name":"3조"},{"id":"group-4","name":"4조"}],"teams":[],"dayLabels":["1일차","2일차","3일차"]}'::jsonb)
on conflict (id) do nothing;

-- Supabase Dashboard > Authentication > Users에서 세 계정을 만든 뒤,
-- 각 user id를 아래에 넣어 실행하세요.
--
-- insert into public.user_roles (user_id, role) values
--   ('관리자_USER_ID', '관리자'),
--   ('선생님_USER_ID', '선생님'),
--   ('의료인_USER_ID', '의료인')
-- on conflict (user_id) do update set role = excluded.role;

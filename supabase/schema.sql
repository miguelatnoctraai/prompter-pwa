-- Run this once in the Supabase SQL Editor (Dashboard → SQL Editor → New query).

create table public.scripts (
  id uuid primary key,
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  title text not null,
  hook text not null default '',
  body text not null,
  -- Millisecond timestamps, matching the app's Date.now() values.
  created_at bigint not null,
  updated_at bigint not null
);

alter table public.scripts enable row level security;

-- Each user can only see and modify their own scripts.
create policy "Users manage own scripts"
  on public.scripts
  for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create index scripts_user_id_idx on public.scripts (user_id);

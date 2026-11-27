-- Run once in the Supabase SQL editor.
-- The app stores edited tables and app state (tasks, plans, settings, audit) as JSON documents.
create table if not exists public.kv (
  key text primary key,
  value jsonb not null,
  updated_at timestamptz not null default now()
);
-- The server uses the service-role key, which bypasses RLS. Keep RLS on so the public anon key cannot read or write.
alter table public.kv enable row level security;

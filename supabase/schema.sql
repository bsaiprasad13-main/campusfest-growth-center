-- Run once in the Supabase SQL editor.
-- The app stores edited tables and app state (tasks, plans, settings, audit) as JSON documents.
create table if not exists public.kv (
  key text primary key,
  value jsonb not null,
  updated_at timestamptz not null default now()
);

-- Keep RLS on with no policies, so the public (publishable/anon) key cannot read or write.
alter table public.kv enable row level security;

-- The server uses the secret (service_role) key. Newer Supabase projects do not grant table
-- access to service_role automatically, so grant it explicitly.
grant usage on schema public to service_role;
grant select, insert, update, delete on table public.kv to service_role;

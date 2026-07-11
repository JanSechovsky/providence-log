-- Providence Log migration — paste ALL of this into the Supabase SQL Editor and click RUN.
-- Safe to run repeatedly: every line is "if not exists", so it only adds what's missing.
-- This fixes the PGRST204 "could not find the 'client_delivery_done' column" error.

alter table public.providence_log add column if not exists outreach_sent        int     default 0;
alter table public.providence_log add column if not exists calls_booked         int     default 0;
alter table public.providence_log add column if not exists deals_closed         int     default 0;
alter table public.providence_log add column if not exists revenue              numeric default 0;
alter table public.providence_log add column if not exists deep_work_hours      numeric default 0;
alter table public.providence_log add column if not exists sleep_hours          numeric default 0;
alter table public.providence_log add column if not exists energy_level         int     default 0;
alter table public.providence_log add column if not exists gym_count            int     default 0;
alter table public.providence_log add column if not exists instant_grat_minutes int     default 0;
alter table public.providence_log add column if not exists pages_read           int     default 0;
alter table public.providence_log add column if not exists content_created      boolean default false;
alter table public.providence_log add column if not exists reflection_done      boolean default false;
alter table public.providence_log add column if not exists good_routine         boolean default false;
alter table public.providence_log add column if not exists client_delivery_done boolean default false;
alter table public.providence_log add column if not exists brain_dump           text    default '';
alter table public.providence_log add column if not exists goals                text    default '';
alter table public.providence_log add column if not exists goals_kept           text    default '';

-- force PostgREST to refresh its schema cache (otherwise it can keep saying the column is missing)
notify pgrst, 'reload schema';

-- HOLLOW KING: rpg_events (level-ups, pacts, artifacts) — idempotent
create table if not exists public.rpg_events (
  id bigint generated always as identity primary key,
  ts timestamptz default now(),
  kind text not null,
  payload jsonb default '{}'::jsonb
);
alter table public.rpg_events enable row level security;
drop policy if exists "anon all rpg_events" on public.rpg_events;
create policy "anon all rpg_events" on public.rpg_events for all using (true) with check (true);
notify pgrst, 'reload schema';

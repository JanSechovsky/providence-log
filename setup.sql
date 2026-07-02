-- Providence Log table (paste into Supabase SQL Editor and Run)
create table if not exists public.providence_log (
  id bigint generated always as identity primary key,
  date date not null unique,
  outreach_sent int default 0,
  calls_booked int default 0,
  deals_closed int default 0,
  revenue numeric default 0,
  deep_work_hours numeric default 0,
  sleep_hours numeric default 0,
  energy_level int default 0,
  gym_count int default 0,
  instant_grat_minutes int default 0,
  pages_read int default 0,
  content_created boolean default false,
  reflection_done boolean default false,
  good_routine boolean default false,
  client_delivery_done boolean default false,
  brain_dump text default '',
  created_at timestamptz default now()
);
alter table public.providence_log enable row level security;
create policy "pl_insert" on public.providence_log for insert to anon with check (true);
create policy "pl_update" on public.providence_log for update to anon using (true);
create policy "pl_select" on public.providence_log for select to anon using (true);

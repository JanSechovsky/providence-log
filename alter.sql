-- v1.1: two new fields (paste into Supabase SQL Editor and Run)
alter table public.providence_log add column if not exists pages_read int default 0;
alter table public.providence_log add column if not exists client_delivery_done boolean default false;

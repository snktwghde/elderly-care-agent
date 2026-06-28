-- CareProxy — RLS policies for all tables
-- Run in Supabase SQL Editor after creating all tables
-- Restricts all access to service role key only (backend uses service role; anon key gets nothing)

alter table if exists appointments enable row level security;
alter table if exists medication_logs enable row level security;
alter table if exists message_logs enable row level security;
alter table if exists clinic_cache enable row level security;
alter table if exists conversation_history enable row level security;
alter table if exists accounts enable row level security;
alter table if exists care_recipients enable row level security;

-- Drop existing policies before recreating (idempotent)
drop policy if exists "service role only" on appointments;
drop policy if exists "service role only" on medication_logs;
drop policy if exists "service role only" on message_logs;
drop policy if exists "service role only" on clinic_cache;
drop policy if exists "service role only" on conversation_history;
drop policy if exists "service role only" on accounts;
drop policy if exists "service role only" on care_recipients;

create policy "service role only" on appointments for all using (auth.role() = 'service_role');
create policy "service role only" on medication_logs for all using (auth.role() = 'service_role');
create policy "service role only" on message_logs for all using (auth.role() = 'service_role');
create policy "service role only" on clinic_cache for all using (auth.role() = 'service_role');
create policy "service role only" on conversation_history for all using (auth.role() = 'service_role');
create policy "service role only" on accounts for all using (auth.role() = 'service_role');
create policy "service role only" on care_recipients for all using (auth.role() = 'service_role');

-- CareProxy — Phase 2 schema
-- Replaces user_profile with accounts + care_recipients (supports family plan in Phase 8)
-- Run this in Supabase SQL Editor: supabase.com → your project → SQL Editor

-- Drop old table if it exists (Phase 1 had no real users)
drop table if exists user_profile cascade;

-- ─── accounts ────────────────────────────────────────────────────────────────
-- One row per WhatsApp number. account_phone is the number that messages the bot.
-- account_type: 'self' = elderly person set it up themselves
--               'caregiver' = family member set it up on behalf of elderly person

create table if not exists accounts (
  account_phone            text primary key,
  account_type             text check (account_type in ('self', 'caregiver')),
  onboarding_complete      boolean default false,
  onboarding_step          text default 'start',
  subscription_status      text check (subscription_status in ('trial', 'active', 'expired')) default 'trial',
  razorpay_subscription_id text,
  created_at               timestamptz default now(),
  updated_at               timestamptz default now()
);

alter table accounts enable row level security;

-- ─── care_recipients ─────────────────────────────────────────────────────────
-- One account can have multiple care recipients (V1: 1 per account, family plan: 2+)

create table if not exists care_recipients (
  id                 uuid primary key default gen_random_uuid(),
  account_phone      text not null references accounts(account_phone) on delete cascade,
  recipient_name     text,
  recipient_phone    text,
  preferred_language text check (preferred_language in ('hindi', 'marathi', 'english')) default 'hindi',
  home_address       text,
  home_lat           numeric,
  home_lng           numeric,
  family_contacts    text[] default '{}',
  saved_doctors      jsonb default '[]',
  medication_schedule jsonb default '[]',
  created_at         timestamptz default now(),
  updated_at         timestamptz default now()
);

alter table care_recipients enable row level security;

-- ─── conversation_history ────────────────────────────────────────────────────
-- Stores last N messages per account so Claude has context across turns

create table if not exists conversation_history (
  id            uuid primary key default gen_random_uuid(),
  account_phone text not null references accounts(account_phone) on delete cascade,
  role          text check (role in ('user', 'assistant')) not null,
  content       text not null,
  created_at    timestamptz default now()
);

alter table conversation_history enable row level security;

create index conversation_history_account_phone_idx on conversation_history(account_phone, created_at desc);

-- ─── updated_at trigger ──────────────────────────────────────────────────────

create or replace function update_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

create trigger accounts_updated_at
  before update on accounts
  for each row execute function update_updated_at();

create trigger care_recipients_updated_at
  before update on care_recipients
  for each row execute function update_updated_at();

-- ─── RLS policies ────────────────────────────────────────────────────────────
-- The backend uses the service role key which bypasses RLS.
-- These policies protect against anon key exposure or misconfiguration.

create policy "service role only" on accounts
  for all using (auth.role() = 'service_role');

create policy "service role only" on care_recipients
  for all using (auth.role() = 'service_role');

create policy "service role only" on conversation_history
  for all using (auth.role() = 'service_role');

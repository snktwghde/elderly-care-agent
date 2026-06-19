-- CareProxy — user_profile table
-- Run this in Supabase SQL Editor: supabase.com → your project → SQL Editor

create table if not exists user_profile (
  id                       uuid primary key default gen_random_uuid(),
  elderly_user_phone       text unique not null,
  elderly_user_name        text,
  preferred_language       text check (preferred_language in ('hindi', 'marathi', 'english')) default 'hindi',
  home_address             text,
  home_lat                 numeric,
  home_lng                 numeric,
  family_contacts          text[] default '{}',
  saved_doctors            jsonb default '[]',
  medication_schedule      jsonb default '[]',
  onboarded_by             text,
  subscription_status      text check (subscription_status in ('trial', 'active', 'expired')) default 'trial',
  razorpay_subscription_id text,
  created_at               timestamptz default now(),
  updated_at               timestamptz default now()
);

-- Auto-update updated_at on every row change
create or replace function update_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

create trigger user_profile_updated_at
  before update on user_profile
  for each row execute function update_updated_at();

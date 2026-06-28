-- CareProxy — Clinic cache table
-- Caches Google Maps clinic search results per address+specialty for 7 days
-- Prevents repeated Maps API calls for the same user — cost protection at scale
-- Run in Supabase SQL Editor

create table if not exists clinic_cache (
  cache_key        text primary key,  -- '{normalised_address}::{specialty|general}'
  clinics          jsonb not null,
  next_page_token  text,
  lat              double precision,
  lng              double precision,
  keyword          text,
  cached_at        timestamptz default now()
);

alter table clinic_cache enable row level security;

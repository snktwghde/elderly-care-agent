-- CareProxy — trial expiry warning
-- Tracks whether the "trial ends in 24 hours" nudge has already been sent,
-- so the reminder cron doesn't resend it every 5 minutes.
-- Run this in Supabase SQL Editor: supabase.com → your project → SQL Editor

alter table accounts add column if not exists trial_warning_sent boolean default false;

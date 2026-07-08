-- CareProxy — Phase 10: Digital Health Card columns
-- Run this in Supabase SQL Editor: supabase.com → your project → SQL Editor
-- Existing RLS policy "service role only" on care_recipients covers these columns automatically.
-- No new RLS policy needed.

ALTER TABLE care_recipients
  ADD COLUMN IF NOT EXISTS blood_group    text,
  ADD COLUMN IF NOT EXISTS allergies      jsonb DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS major_illnesses text[] DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS surgeries      jsonb DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS medical_history text;

---
phase: 10-digital-health-card
plan: 01
type: summary
wave: 1
completed: true
---

## What was built

- Created `supabase/add_health_card_columns.sql` — ALTER TABLE migration adding 5 nullable columns to care_recipients (blood_group text, allergies jsonb, major_illnesses text[], surgeries jsonb, medical_history text)
- Updated 4 price strings in `src/webhook/whatsapp.js` from ₹299 → ₹499 (sendTrialStartedMessage + getExpiredReply in 3 languages)

## Human actions completed

- SQL migration run in Supabase SQL Editor — 5 columns confirmed in care_recipients
- New ₹499/month Razorpay plan created
- RAZORPAY_PLAN_ID env var updated in Railway
- Railway redeployed and Active

## Verification

- `grep -c "₹499" src/webhook/whatsapp.js` → 4
- `grep "₹299" src/webhook/whatsapp.js` → 0 matches

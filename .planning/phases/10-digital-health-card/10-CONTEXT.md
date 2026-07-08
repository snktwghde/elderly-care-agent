# Phase 10: Digital Health Card — Context

**Gathered:** 2026-07-08
**Status:** Ready for planning
**Source:** Design session with founder

<domain>
## Phase Boundary

Add a digital health card feature to CareProxy. Users can optionally set up a health profile (blood group, allergies, medications, illnesses, surgeries, medical history) stored in Supabase. The health card is generated as a formatted WhatsApp text message — no AI call needed, just a template fill from stored data. Sent on demand or auto-sent to family on SOS. Razorpay plan updated from ₹299 to ₹499 flat (no tiers).

</domain>

<decisions>
## Implementation Decisions

### Pricing
- Single plan: ₹499/month flat. No tiers. All features included.
- Update RAZORPAY_PLAN_ID in Railway env vars to new ₹499 plan
- Existing test users can be migrated manually (no real paying users yet)
- 7-day free trial stays

### Health Card Storage
- New columns on existing `care_recipients` table — no new table
- Fields: blood_group (text), allergies (jsonb array), major_illnesses (text[]), surgeries (jsonb array), medical_history (text)
- Allergies jsonb format: [{ type: 'medicine'|'food'|'other', name: 'string' }]
- Surgeries jsonb format: [{ name: 'string', date: 'string' }]
- All fields nullable — partial setup allowed

### Health Card Generation
- Pure string interpolation from Supabase data — ZERO Claude API calls for card generation
- Formatted WhatsApp text with bold headers and emoji
- Template fill only — deterministic, instant, free

### Health Card Format (WhatsApp text)
```
🩺 *Health Card — {name}*
─────────────────────
🩸 Blood Group: {blood_group}
💊 Current Medications: {medications list}
⚠️ Allergies: {allergies list}
🏥 Major Illnesses: {illnesses list}
🔪 Surgeries: {surgeries with dates}
📋 Medical History: {history}
📞 Emergency Contact: {first family contact}
─────────────────────
```
Fields not set up show as "Not provided"

### Setup Flow
- Offered immediately after onboarding completes — one message, user can decline
- Setup prompt: "Doctors often ask for current medications and medical history during visits — this lets you share it instantly. Would you like to set up your health card? (Takes about 5 minutes)"
- If yes: bot collects fields conversationally, one at a time
- If no: saved for later, user can trigger with "health card" or "set up health card"
- Partial setup allowed — any field can be skipped with "skip"
- Individual field updates allowed at any time: "update blood group", "add allergy", "add surgery"

### Health Card Triggers
- On demand: user says "health card", "medical card", "meri health card", "show medical summary", etc. → bot sends card to user
- On SOS: auto-sent to all family contacts (not to user) with the SOS message
- If card not set up on SOS: SOS sends normally with note "Health card is not set up yet."
- User requesting own card: sent to the requesting user only

### Intent Detection
- Extend existing Claude intent parser to recognise health card intents
- New intents: SETUP_HEALTH_CARD, SHOW_HEALTH_CARD, UPDATE_HEALTH_CARD
- UPDATE_HEALTH_CARD carries the field name and new value

### Claude's Discretion
- Exact conversation flow phrasing for each field collection step
- How to handle invalid blood group input (e.g., free text vs validated enum)
- Session state management for multi-step health card setup (can reuse existing onboarding pattern)
- Exact intent detection phrases

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Project foundation
- `CLAUDE.md` — Project overview, tech stack, phase history, build rules
- `src/config/env.js` — Required env vars and config structure
- `src/services/supabase.js` — Supabase client and existing DB patterns
- `src/webhook/whatsapp.js` — Main message handler and intent routing
- `src/services/claude.js` — Intent parsing patterns (extend, don't rewrite)
- `src/services/onboarding.js` — Onboarding flow pattern to replicate for health card setup
- `src/services/whatsapp.js` — WhatsApp send functions (reuse for health card messages)
- `src/routes/razorpay.js` — Razorpay webhook handler (for plan update)
- `src/services/reminders.js` — Scheduler pattern reference

### Security context
- `.planning/reviews/pre-payment-SECURITY.md` — Prior security audit findings

</canonical_refs>

<specifics>
## Specific Implementation Notes

- Medications are already stored in care_recipients.medication_schedule — reuse this for the health card medications section (don't duplicate storage)
- Family contacts are already in care_recipients.family_contacts — reuse for emergency contact in card
- SOS handler is in src/webhook/whatsapp.js — find the SOS intent handler and add health card fetch + append there
- Razorpay plan change: create new ₹499 plan in Razorpay dashboard, update RAZORPAY_PLAN_ID env var in Railway, update payment link generation in src/services/razorpay.js
- Health card setup state (mid-conversation, what field is next) — reuse the same onboarding_step pattern in Supabase if one exists, or track via a health_card_setup_step field

</specifics>

<deferred>
## Deferred

- PDF version of health card — WhatsApp text is sufficient for V1
- Weekly/monthly family summary — scrapped entirely
- NRI tier (₹799) — scrapped
- Voice booking (Phase 9) — blocked by infrastructure, not in scope here
- Automated upgrade flow (₹299 → ₹499) — no real users yet, manual migration is fine

</deferred>

---

*Phase: 10-digital-health-card*
*Context gathered: 2026-07-08*

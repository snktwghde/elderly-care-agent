# CareProxy Roadmap

## Milestone v1.0 — WhatsApp-First Elderly Care Agent

### Completed Phases

- [x] Phase 1: Foundation
- [x] Phase 2: Onboarding
- [x] Phase 3: Clinic Finder
- [x] Phase 4: Clinic Contact and Walk-in Flow
- [x] Phase 5: Notifications
- [x] Phase 6: Medication Reminders
- [x] Phase 7: SOS Emergency
- [x] Phase 8: Payments

---

## Phase 1: Foundation

**Goal:** Node.js + Express backend with WhatsApp Cloud API webhook, Claude intent parsing, and Supabase database connected end-to-end.
**Depends on:** None
**Requirements:** TBD

## Phase 2: Onboarding

**Goal:** Self and caregiver onboarding flows with conversation memory. accounts and care_recipients schema in Supabase.
**Depends on:** Phase 1
**Requirements:** TBD

## Phase 3: Clinic Finder

**Goal:** Google Maps Places API integration returning top 5 clinics by specialty near the user's home address. 7-day clinic cache in Supabase.
**Depends on:** Phase 2
**Requirements:** TBD

## Phase 4: Clinic Contact and Walk-in Flow

**Goal:** Send clinic phone number and address to user. No-phone clinics handled via walk-in vs future appointment flow.
**Depends on:** Phase 3
**Requirements:** TBD

## Phase 5: Notifications

**Goal:** Appointment confirmation sent to user and all family contacts. 1-hour reminder with Google Maps link.
**Depends on:** Phase 4
**Requirements:** TBD

## Phase 6: Medication Reminders

**Goal:** Per-medicine onboarding, scheduled WhatsApp reminders to elderly user, family notification on setup.
**Depends on:** Phase 5
**Requirements:** TBD

## Phase 7: SOS Emergency

**Goal:** SOS triggered by keywords opens 108 dialler and sends GPS plus nearest ambulance numbers to family contacts.
**Depends on:** Phase 6
**Requirements:** TBD

## Phase 8: Payments

**Goal:** Razorpay subscription at ₹299/month with 7-day free trial. Subscription status checked on every interaction.
**Depends on:** Phase 7
**Requirements:** TBD

## Phase 10: Digital Health Card

**Goal:** Allow users to set up a health profile (blood group, allergies, medications, illnesses, surgeries, medical history) stored in Supabase. Health card is sent as formatted WhatsApp text on demand or auto-sent to family on SOS. Razorpay plan updated to ₹499 flat.
**Depends on:** Phase 8
**Requirements:** [REQ-10-01, REQ-10-02, REQ-10-03, REQ-10-04, REQ-10-05, REQ-10-06, REQ-10-07, REQ-10-08, REQ-10-09, REQ-10-10, REQ-10-11]
**Plans:** 4 plans

Plans:
- [ ] 10-01-PLAN.md — Schema migration (care_recipients health card columns) + ₹499 price string update
- [ ] 10-02-PLAN.md — Claude intent extension + health-card.js service + onboarding offer wiring
- [ ] 10-03-PLAN.md — Intent routing (show/setup) + SOS health card integration + PHI-safe logging
- [ ] 10-04-PLAN.md — Field update flow (update blood group, add allergy, add surgery)

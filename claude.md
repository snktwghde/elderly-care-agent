# Elderly Care WhatsApp Agent — CLAUDE.md

**Project**: CareProxy (EmbedLab product)  
**Status**: Phase 1 ready to begin  
**Last Updated**: June 19, 2026

---

## What We're Building

A WhatsApp-first AI agent that acts as a **digital proxy for elderly parents** — handling clinic appointment booking (via voice call), medication reminders, family notifications, and emergency SOS coordination.

- **Who pays**: Adult children (28–40, urban India), ₹199/month
- **Who uses**: Elderly parents (60+), WhatsApp-only, no app download
- **Core value**: Peace of mind. Daily friction removed.

---

## Why This Product (Never Lose Sight)

- 78% of Indian elderly users require assisted/offline-first digital access (LASI Aug 2025)
- 40–75% of elderly miss medication doses — app-based solutions fail them (IJRPR Apr 2026)
- IRCTC/clinic booking UX is Severity 5 pain for elderly users
- Founder personal pain signal: own parents face these exact problems daily
- No competitor serves this with WhatsApp/voice-first India-native experience

---

## Tech Stack — Decided

| Component | Tool | Why |
|-----------|------|-----|
| Frontend/Interface | WhatsApp (Meta Cloud API) | Zero download, elderly users already have it |
| AI Brain | Claude API (claude-sonnet-4-6) | Intent parsing, multi-language, conversation management |
| Voice Calls | Twilio Programmable Voice | Cheapest at volume, best-verified India telephony access. Paired with own STT/TTS layer (TBD, test in Phase 4) |
| Backend | Node.js + Express | Simple, Claude Code friendly |
| Database | Supabase (free tier) | Easy setup, ~8,300 user ceiling on free plan |
| Deployment | Railway | One-click deploy, no DevOps needed |
| Clinic Finder | Google Maps Places API | Free tier covers thousands of calls/month |
| Payments | Razorpay | India-native, ₹199/month subscription |

### What We're NOT Using

- **ABDM for appointment booking** — Physical Consultation Booking API not live, marked "Coming Soon." See `/research/ABDM_June_2026.md`.
- **Vapi.ai** — Demoted after wider 5-platform comparison. India-specific pricing/deliverability proof too thin vs Twilio. See `/research/Voice_AI_5Platform_Comparison_June_2026.md`.
- **ElevenLabs** — India deployment sales-gated, leads to weeks of delays. See `/research/Vapi_vs_ElevenLabs_June_2026.md` (superseded but still accurate on this point).
- Custom mobile app — WhatsApp IS the app
- Complex orchestration platforms (n8n, Make, etc.) — unnecessary for V1

---

## Build Rules

- Always ask before editing any file
- Never build what wasn't discussed and approved
- One feature at a time, fully working before moving to next
- Test every feature before calling it done
- Keep code simple — founder is non-technical

---

## Build Order — Phase by Phase

### Phase 1 — Foundation (Week 1–2)
- [ ] Set up Node.js + Express project structure
- [ ] Connect Meta WhatsApp Cloud API webhook
- [ ] Send and receive WhatsApp messages via the backend
- [ ] Connect Claude API for intent parsing
- [ ] Set up Supabase with user_profile schema
- [ ] Test: send "book doctor appointment" on WhatsApp → Claude parses intent → logs to console

### Phase 2 — Onboarding (Week 2–3)
- [ ] Adult child/Family member/User onboarding flow via WhatsApp
- [ ] Collect: parent/elderly name, home address, preferred language, family contacts, existing doctors
- [ ] Store all in Supabase user_profile
- [ ] Test: complete onboarding for one test user, verify data in Supabase

### Phase 3 — Clinic Finder (Week 3)
- [ ] Google Maps Places API integration
- [ ] Given home address → find nearest clinic by specialty
- [ ] Return top 3 results with name, address, phone, rating
- [ ] Test: "nearest orthopaedic clinic" → returns 3 clinics near saved address

### Phase 4 — Voice Booking (Week 3–4)
**UPDATE (June 2026): Voice calling is the ONLY clinic booking mechanism. ABDM not live. Twilio replaces Vapi (see research).**
- [ ] Twilio Programmable Voice integration (telephony layer)
- [ ] Select and test STT/TTS provider (2-3 options) for Hindi/Marathi quality — unverified across all platforms, must test with real calls
- [ ] Agent places call to clinic phone number via Twilio
- [ ] Conversation script (Hindi/Marathi/English): "Namaste, main [patient name] ki taraf se call kar raha hoon, appointment book karni thi [date/time] ke liye"
- [ ] Handle: confirmed / no answer / alternative slot offered
- [ ] Store confirmed appointment in Supabase
- [ ] **Test early**: Place test call to a real clinic, validate Hindi/Marathi voice quality before committing further. See `/research/Voice_AI_5Platform_Comparison_June_2026.md`.
- [ ] **Backup plan**: If Twilio integration proves too heavy, fall back to Retell AI (see research for trade-offs)

### Phase 5 — Notifications (Week 4)
- [ ] On appointment confirmation: WhatsApp to elderly user (confirmed details)
- [ ] On appointment confirmation: WhatsApp to all family contacts simultaneously
- [ ] Reminder: evening before appointment
- [ ] Reminder: 2 hours before appointment (with Google Maps link)
- [ ] Test: book appointment → verify all 3 contacts receive notifications

### Phase 6 — Medication Reminders (Week 5)
- [ ] Onboarding flow for medication schedule (name, time, days)
- [ ] Scheduled WhatsApp reminders to elderly user
- [ ] CC family contacts on missed reminders (if user doesn't acknowledge)
- [ ] Test: set medication reminder → verify delivery at correct time

### Phase 7 — SOS (Week 5)
- [ ] SOS trigger: user sends "help", "emergency", "madad", "bachao"
- [ ] Opens 108 dialler via WhatsApp tel: link
- [ ] Sends GPS + "needs help" message to the shared family contacts
- [ ] Sends nearest 3 private ambulance numbers to family
- [ ] Test: trigger SOS → verify family receives message within 10 seconds

### Phase 8 — Payments (Week 6)
- [ ] Razorpay subscription integration (₹199/month)
- [ ] 7-day free trial before payment required
- [ ] Payment link sent via WhatsApp after onboarding
- [ ] Subscription status check on every agent interaction
- [ ] **Before launch**: Confirm Razorpay transaction fee % (currently 2–3% placeholder). See `/research/Razorpay_Subscriptions_June_2026.md`.
- [ ] Test: complete payment flow, verify subscription activates

### Phase 9 — Polish + Launch (Week 6–7)
- [ ] Multi-language: Hindi, Marathi, English detection and response
- [ ] Error handling: what happens when clinic doesn't answer, API fails, etc.
- [ ] Deploy to Railway
- [ ] End-to-end test with real users (start with own parents)
- [ ] Fix critical bugs only, launch

---

## Research Findings (June 2026)

All research archived in `/research/` with source citations. See `/research/README.md` for full index.

### Key Decisions from Research

| Finding | Decision | Impact |
|---------|----------|--------|
| **ABDM physical booking not live** | Removed from Phase 1–4 | Phase 4: voice-only, simpler |
| **Twilio cheapest + best India access among 5 platforms** | Switched from Vapi to Twilio | Phase 4: Twilio telephony + own STT/TTS + Claude orchestration |
| **Hindi/Marathi quality unverified for ALL voice platforms** | Test in Phase 4 regardless of vendor | Phase 4: real clinic call testing required before scaling |
| **WhatsApp test setup free** | Start Phase 1 today | $0 cost, 5 test numbers, no KYC needed |
| **Razorpay fee % unconfirmed** | Use 2–3% placeholder | Confirm before Phase 8 launch |
| **Supabase ~8,300 user ceiling** | Proceed on free tier | Well above V1 target of 500 users |

---

## User Profiles (Supabase Schema)

```
user_profile {
  elderly_user_phone: string
  elderly_user_name: string
  preferred_language: string (hindi/marathi/english)
  home_address: string
  home_lat_lng: coordinates
  family_contacts: [phone1, phone2, phone3]
  saved_doctors: [{ name, clinic, phone }]
  medication_schedule: [{ name, time, days }]
  onboarded_by: adult_child_phone
  subscription_status: active/trial/expired
  razorpay_subscription_id: string
}
```

---

## Agent Architecture (End-to-End Flow)

```
Elderly user sends WhatsApp message
         ↓
Meta Cloud API webhook → Node.js backend receives message
         ↓
Claude API parses intent (language-agnostic)
         ↓
         ├── INTENT: Book appointment
         │     ↓
         │   Google Maps API → find nearest relevant clinic
         │     ↓
         │   Twilio → place AI voice call to clinic
         │     ↓
         │   Confirmation captured → stored in Supabase
         │     ↓
         │   WhatsApp message to elderly user: "Appointment confirmed"
         │     ↓
         │   WhatsApp message to family contacts: "Papa/Mummy appointment booked"
         │     ↓
         │   Reminder scheduled: evening before + 2 hours before
         │
         ├── INTENT: Medication reminder
         │     ↓
         │   Retrieve medication schedule from Supabase
         │     ↓
         │   Scheduled WhatsApp reminders to elderly user + family
         │
         └── INTENT: SOS / Emergency
               ↓
             Opens 108/112 dialler on user's phone (tel: link via WhatsApp)
               ↓
             Sends GPS location + private ambulance numbers to family group
```

---

## Key Decisions Log (DO NOT REOPEN WITHOUT NEW EVIDENCE)

| Decision | Choice | Reason | Date |
|----------|--------|--------|------|
| Vertical vs super-agent | Vertical (health/elderly only) | Tata Neu failure, 100+ horizontal startup failures | June 2026 |
| WhatsApp-first interface | WhatsApp only | Elderly users already have it, no download friction | June 2026 |
| Voice booking mechanism | Twilio Programmable Voice + own STT/TTS | ABDM physical booking API not live; Twilio cheapest + best-verified India access among 5 platforms tested | June 2026 |
| Emergency dispatch | Coordination only (no autonomous dispatch) | Article 21 liability, Clinical Establishments Act | June 2026 |
| Pricing | ₹199/month per family | WTP signal from earlier research | June 2024 |

---

## Competitive Position

**Direct competitors**: None at this exact intersection (WhatsApp-first, voice AI clinic booking, elderly India, family notification layer)

**Biggest threats**:
1. Meta Business Agent — 500M WhatsApp India users
2. Google Gemini — Maps + Search + UPI integration
3. Krutrim/Kruti — India-native AI, 13 languages

**Defense**:
- Personal domain knowledge (founder's own parents)
- WhatsApp number portability — users won't lose number switching agents
- Trust built over months of reliable reminders and bookings
- Family network effect

---

## Claude Code Workflow Rules (Permanent)

1. **Always start in Plan Mode** — never write code without first showing a plan
2. **One feature at a time** — finish and test before moving to the next
3. **Test before calling done** — every feature needs a real test, not just "it looks right"
4. **Use /compact regularly** — prevents context window issues mid-session
5. **Screenshot errors** — show Claude the actual error message, never describe it
6. **Approve before execute** — review every plan, change what's wrong
7. **CLAUDE.md is the source of truth** — update it when major decisions change
8. **Never build what wasn't discussed** — scope creep is the enemy of shipping

---

## Product Name

**CareProxy** — A product of EmbedLab (embedlab.co)

---

**Status**: Ready for Phase 1. Start Claude Code now.  
**Go/No-Go**: 🟢 GREEN — All research complete, all blockers cleared, $0 cost to start testing.
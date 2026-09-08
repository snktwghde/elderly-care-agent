# Elderly Care WhatsApp Agent — CLAUDE.md

**Project**: CareProxy (EmbedLab product)  
**Status**: Phase 1 ready to begin  
**Last Updated**: June 19, 2026

---

## What We're Building

A WhatsApp-first AI agent that acts as a **digital proxy for elderly parents** — finding clinics and handing over their contact details, medication reminders, a digital health card, family notifications, and emergency SOS coordination.

- **Who pays**: Adult children (28–40, urban India), ₹199/month
- **Who uses**: Elderly parents (60+), WhatsApp-only, no app download
- **Core value**: Peace of mind. Daily friction removed.

---

## Why This Product (Never Lose Sight)

- 78% of Indian elderly users require assisted/offline-first digital access (LASI Aug 2025)
- 40–75% of elderly miss medication doses — app-based solutions fail them (IJRPR Apr 2026)
- IRCTC/clinic booking UX is Severity 5 pain for elderly users
- Founder personal pain signal: own parents face these exact problems daily
- No competitor serves this as a WhatsApp-native, Indic-language coordination layer for families

---

## Tech Stack — Decided

| Component | Tool | Why |
|-----------|------|-----|
| Frontend/Interface | WhatsApp (Meta Cloud API) | Zero download, elderly users already have it |
| AI Brain | Claude API (claude-sonnet-4-6) | Intent parsing, multi-language, conversation management |
| Voice input (planned) | Sarvam speech-to-text | Elder sends a WhatsApp voice note instead of typing — transcript feeds the existing intent parser. Indic-language speech is Sarvam's core strength |
| Backend | Node.js + Express | Simple, Claude Code friendly |
| Database | Supabase (free tier) | Easy setup, ~8,300 user ceiling on free plan |
| Deployment | Railway | One-click deploy, no DevOps needed |
| Clinic Finder | Google Maps Places API | Free tier covers thousands of calls/month |
| Payments | Razorpay | India-native, ₹199/month subscription |

### What We're NOT Using

- **AI voice calling to clinics — DROPPED (Sept 2026), not deferred.** Two blockers that no vendor swap fixes: TRAI regulations on automated outbound calling, and the fact that most Indian clinics have no digital booking system on the other end of the call — there is nothing to integrate with even if the call connects. Phase 4 testing also showed a US +1 number reads as spam, AI voice causes receptionists to hang up, and STT is poor on 8kHz phone audio. CareProxy hands the user the clinic's number and address instead; the family makes the call. Twilio code remains in `src/routes/twilio.js` and `src/services/twilio.js` — dead, do not extend.
- **ABDM for appointment booking** — Physical Consultation Booking API not live, marked "Coming Soon." See `/research/ABDM_June_2026.md`.
- **Vapi.ai / ElevenLabs / Deepgram** — all were candidates for the clinic-calling stack. Moot now that voice calling is dropped. See `/research/Voice_AI_5Platform_Comparison_June_2026.md` for the original comparison.
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
- [ ] **New schema**: create `accounts` + `care_recipients` tables in Supabase (replaces single `user_profile`); RLS on both
- [ ] **Conversation memory**: create `conversation_history` table; fetch last 10 messages per account on every Claude call; store as plain text not JSON (2x cheaper)
- [ ] Onboarding flow — first question: "Are you setting this up for yourself or for an elderly family member?"
- [ ] If self: collect their own name, phone auto-known (account_phone), address, language, family contacts, existing doctors
- [ ] If caregiver: collect elderly person's name, their phone number, address, language, existing doctors; caregiver's number auto-added to family_contacts
- [ ] Store completed profile in `accounts` + `care_recipients` tables
- [ ] Test: complete both flows (self + caregiver), verify correct data in Supabase

### Phase 3 — Clinic Finder (Week 3)
- [ ] Google Maps Places API integration
- [ ] Given home address → find nearest clinic by specialty
- [ ] Return top 3 results with name, address, phone, rating
- [ ] Test: "nearest orthopaedic clinic" → returns 3 clinics near saved address

### Phase 4 — Clinic Finder Result + Contact Handoff (Week 3–4)
**UPDATE (Sept 2026): Voice booking DROPPED permanently — see "What We're NOT Using" above. TRAI rules on automated outbound calling plus the absence of any digital booking system at most Indian clinics mean there is no version of this that works, regardless of vendor. Handing the user the clinic's number and address is now the permanent design, not a fallback. Twilio code in `src/routes/twilio.js` and `src/services/twilio.js` is dead — do not extend it.**
- [x] Twilio Programmable Voice integration (code written and tested — now abandoned)
- [x] Time preference collection before call
- [x] Appointment status tracking in Supabase
- [x] When user selects a clinic, send the clinic phone number + address directly
- [ ] Test: select clinic → receive phone number + address on WhatsApp

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

### Phase 9 — Voice Input + Polish + Launch (Week 6–7)
**Voice calling to clinics is dropped (see Phase 4 note). What replaces it is voice on the user's side: the elder sends a WhatsApp voice note instead of typing — which removes the actual barrier, since typing is what they struggle with, not reading.**
- [ ] Accept `audio` messages in the webhook (currently dropped: `if (message.type !== 'text') return;`)
- [ ] Fetch + download the voice note from Meta's media API (two calls, auth-protected URL)
- [ ] Transcribe via Sarvam speech-to-text (Hindi/Marathi/English)
- [ ] Feed transcript into the existing `parseIntent()` — everything downstream unchanged
- [ ] **Open question**: WhatsApp voice notes are OGG/Opus. If Sarvam STT won't accept that directly, an ffmpeg conversion step is needed on Railway — check before building
- [ ] **Deliberately not doing**: spoken replies (TTS). Most replies are scannable reference data — clinic numbers, Maps links, the health card, `tel:` links — which lose their value when read aloud rather than displayed
- [ ] Multi-language: Hindi, Marathi, English detection and response
- [ ] Error handling: what happens when clinic doesn't answer, API fails, etc.
- [ ] **Structured logging**: log every incoming message, parsed intent, and outgoing reply to Supabase `message_logs` table — gives visibility into what's failing in production
- [ ] **Monitoring**: alert when intent parsing falls back to "unknown" more than N times/hour (silent failure signal); alert on WhatsApp send failures
- [ ] Deploy to Railway
- [ ] End-to-end test with real users (start with own parents)
- [ ] Fix critical bugs only, launch

---

## Research Findings (June 2026)

All research archived in `/research/` with source citations. See `/research/README.md` for full index.

### Key Decisions from Research

| Finding | Decision | Impact |
|---------|----------|--------|
| **ABDM physical booking not live** | Removed from Phase 1–4 | Phase 4: clinic finder + contact handoff |
| **Twilio voice: US number = spam, AI voice = hang-up, STT = poor Indian audio** | Voice booking initially moved to Phase 9 | Superseded Sept 2026 — dropped entirely, see row below |
| **TRAI limits on automated outbound calling + no digital booking system at most Indian clinics** | Clinic voice calling dropped permanently (Sept 2026) | Contact handoff is the permanent design; Phase 9 repurposed to voice *input* via Sarvam STT |
| **WhatsApp test setup free** | Start Phase 1 today | $0 cost, 5 test numbers, no KYC needed |
| **Razorpay fee % unconfirmed** | Use 2–3% placeholder | Confirm before Phase 8 launch |
| **Supabase ~8,300 user ceiling** | Proceed on free tier | Well above V1 target of 500 users |

---

## User Profiles (Supabase Schema)

Designed for 1:many — one account can have multiple care recipients (individual plan = 1, family plan = 2+).
V1 implements 1 care recipient per account. Family plan pricing added in Phase 8. No migration needed when it comes.

```
accounts {
  account_phone: string          // WhatsApp number that messages the bot (PK)
  account_type: string           // 'self' | 'caregiver'
  subscription_status: string    // 'trial' | 'active' | 'expired'
  razorpay_subscription_id: string
  created_at: timestamp
}

care_recipients {
  id: uuid (PK)
  account_phone: string          // FK → accounts.account_phone
  recipient_name: string
  recipient_phone: string        // elderly person's phone (same as account_phone if account_type='self')
  preferred_language: string     // 'hindi' | 'marathi' | 'english'
  home_address: string
  home_lat_lng: coordinates
  family_contacts: [phone1, phone2, phone3]  // caregiver's number auto-added if account_type='caregiver'
  saved_doctors: [{ name, clinic, phone }]
  medication_schedule: [{ name, time, days }]
  created_at: timestamp
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
         │   Clinic name + phone + address sent to user — they make the call
         │     ↓
         │   User reports back that they booked → details parsed, stored in Supabase
         │     ↓
         │   WhatsApp message to elderly user: "Appointment confirmed"
         │     ↓
         │   WhatsApp template to family contacts: "Papa/Mummy appointment booked"
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
| Voice booking mechanism | Deferred to Phase 9 | Tested in Phase 4: US +1 looks like spam, AI voice causes hang-ups, Twilio STT poor on Indian phone audio. Phase 9 will use Indian number + Deepgram + ElevenLabs | June 2026 |
| Clinic voice calling | **DROPPED — superseded the June decision above** | TRAI rules on automated outbound calling, and most Indian clinics have no digital booking system to integrate with even if the call connects. No vendor swap fixes either. Contact handoff (number + address to the user) is the permanent design | Sept 2026 |
| Voice on the user's side | Sarvam speech-to-text — elder sends a voice note instead of typing | Typing is the elder's actual barrier, not reading. Transcript feeds the existing intent parser unchanged. Spoken replies (TTS) deliberately excluded — most replies are scannable reference data (clinic numbers, Maps links, health card) that lose value when read aloud | Sept 2026 |
| Emergency dispatch | Coordination only (no autonomous dispatch) | Article 21 liability, Clinical Establishments Act | June 2026 |
| Pricing | ₹299/month per family | WTP signal from earlier research | June 2024 |
| Pricing (current) | **₹199/month per family** — supersedes the ₹299 row above | Briefly set to ₹499 during Phase 10, then reverted to ₹199 (commit `1fe2e53`). ₹199 reflects what a solo, software-only operation can sustainably deliver — no call centre, no field staff — and sits 10–85× below human-service incumbents | Aug 2026 |

---

## Competitive Position

**Direct competitors**: None at this exact intersection (WhatsApp-first, no app download, elderly India, Indic-language, family notification layer). Nearest analogues found in Aug 2026 research: Khyaal (₹99/mo, WhatsApp heritage, but community/wellness not healthcare coordination) and Citraverse (healthcare coordination, but pre-seed and unproven at scale). Human-service incumbents — Emoha, Yodda, Tribeca, Samarth — run ₹2,000–₹24,000/mo with care managers and call centres.

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
3. **Verify before calling done** — diff the actual behavior, not just "it looks right"; check logs, run the real flow end-to-end
4. **Use /compact regularly** — prevents context window issues mid-session
5. **Screenshot errors** — show Claude the actual error message, never describe it
6. **Approve before execute** — review every plan, change what's wrong
7. **CLAUDE.md is the source of truth** — update it when major decisions change
8. **Never build what wasn't discussed** — scope creep is the enemy of shipping
9. **Self-improvement loop** — after every bug fix or correction, ask: "What rule would have prevented this?" Write it in `tasks/lessons.md`. Review lessons at the start of every session.
10. **Demand elegance** — for non-trivial changes, pause and ask "is there a more elegant way?" If a fix feels hacky, it probably is — find the root cause, not the workaround
11. **Autonomous bug fixing** — when shown a bug screenshot or error log, diagnose the root cause immediately; trace the real flow, point at the exact line, fix it — no hand-holding needed

---

## How to Get the Best from Claude (Role Prompts by Situation)

The difference is not the tool — it's how you prompt it. Give Claude a role + context + decision frame.

### Day-to-day coding (use this every session)
> "Act like a senior technical lead who is responsible for maintaining CareProxy for the next 5 years. Before writing any code: ask clarifying questions, challenge bad decisions, identify scaling risks, suggest simpler approaches. Prioritise simplicity over cleverness."

### When resuming after a break / something feels broken
> "Act like a senior engineer who just joined this codebase. Reverse-engineer the architecture, understand the complete data flow, then identify any bad decisions, duplicate logic, or performance bottlenecks before touching anything."

### When debugging an error
> "Act like a senior debugging engineer investigating a live production issue. Analyse the codebase step by step. Understand what the code actually does, trace the real root cause, explain why the failure happens, then provide a fixed production-ready solution."

### Before Phase 8 — Payments (security review)
> "Act like a senior security engineer auditing a production application. Carefully inspect for: security vulnerabilities, authentication flaws, API weaknesses, injection risks, sensitive data exposure, infrastructure risks. Provide a vulnerability report with severity levels and secure fixes."

### Before Phase 9 — Railway deployment
> "Act like a senior DevOps engineer preparing CareProxy for real production deployment. Design the deployment architecture, configure CI/CD, set up monitoring and logging, improve reliability, and reduce downtime risks."

---

## Product Name

**CareProxy** — A product of EmbedLab (embedlab.co)

---

**Status**: Ready for Phase 1. Start Claude Code now.  
**Go/No-Go**: 🟢 GREEN — All research complete, all blockers cleared, $0 cost to start testing.
# CareProxy — WhatsApp-First Elderly Care Agent

A production WhatsApp agent that handles the recurring care coordination an adult child
currently does by phone: finding clinics, medication reminders, a digital health card,
family notifications, and emergency SOS.

No app to download. The elderly user messages a WhatsApp number in Hindi, Marathi or
English and the agent does the rest.

**Stack:** Node.js 22 · Express · Claude API (Sonnet 4.6) · Supabase (Postgres) ·
WhatsApp Cloud API · Google Maps Places · Razorpay · Sentry · Railway

---

## The design constraint everything follows from

Two users, one payer:

| | |
|---|---|
| **Pays** | Adult child, 28–40, urban India — ₹199/month after a 7-day trial |
| **Uses** | Elderly parent, 60+, WhatsApp-only |
| **Market** | India (Hindi / Marathi / English) |

The payer wants visibility. The user wants to not learn anything new. That split rules out
a native app on the parent's side and a dashboard-only product on the child's side — so
the interface is WhatsApp for both, and the family gets fanned-out notifications rather
than a screen to check.

Supporting signals: 78% of Indian elderly require assisted or offline-first digital access
(LASI, Aug 2025); 40–75% miss medication doses, and app-based reminders don't reach them
(IJRPR, Apr 2026).

---

## What it does

| Capability | How it works |
|---|---|
| **Onboarding** | Branching flow — "setting this up for yourself or a family member?" — writing to `accounts` + `care_recipients`. Caregiver's number is auto-added to family contacts. |
| **Clinic finder** | Google Places search by specialty against the saved home address, ranked by distance, with a 7-day Supabase cache keyed on `address::specialty`. |
| **Contact handoff** | Returns clinic name, address and phone. The family places the call. See "The call we reversed" below. |
| **Medication reminders** | Per-medicine schedule, cron-driven WhatsApp sends, family CC'd on setup and on unacknowledged doses. |
| **Digital health card** | Blood group, allergies, medications, illnesses, surgeries. Sent on demand as formatted WhatsApp text, and auto-attached to an SOS. |
| **SOS** | Keyword-triggered (`help`, `emergency`, `madad`, `bachao`) → opens the 108 dialler via `tel:` link, pushes GPS plus the health card to every family contact, and sends nearest private ambulance numbers. |
| **Billing** | Razorpay subscription, 7-day trial, status checked on every interaction. Expired accounts keep SOS and lose everything else. |

That last detail is deliberate: billing lapse should never be the reason an emergency
message goes unanswered.

---

## Architecture

```
WhatsApp Cloud API
      │  (HMAC-SHA256 signature verified on the raw body, before JSON parsing)
      ▼
Express  ──  rate limit 60 req/min/IP
      │
      ├── /webhook          → webhook/whatsapp.js   intent routing, flow state
      └── /webhook/razorpay → routes/razorpay.js    subscription lifecycle
      │
      ▼
services/
  claude.js        intent parsing + conversation, last 10 turns as context
  intelligence.js  higher-level decisioning
  onboarding.js    branching self / caregiver flow
  maps.js          Places search + 7-day clinic cache
  reminders.js     node-cron scheduler — medication, appointment, trial warnings
  health-card.js   health profile CRUD + formatting
  whatsapp.js      outbound send (templates vs free-form)
  supabase.js      data access
  razorpay.js      plans, subscriptions, webhook verification
```

**Data model** (`supabase/schema.sql`): `accounts` (one row per WhatsApp number) →
`care_recipients` (1 per account in V1, multiple for a future family plan) →
`conversation_history` (indexed on `account_phone, created_at desc`, stored as plain text
rather than JSON — roughly half the token cost when replayed into Claude).

RLS is enabled on every table with service-role-only policies. The backend uses the
service key and bypasses RLS; the policies exist so an exposed anon key doesn't become a
data breach.

---

## The call we reversed

Phase 4 originally shipped AI voice calling — the agent would ring the clinic and book the
appointment. Twilio Programmable Voice was selected over Vapi, Bland, Retell and Dialogflow
after a five-platform comparison (`research/`), the integration was built, and it was
tested against real clinics.

It was then **dropped permanently**, for reasons no vendor swap fixes:

1. **TRAI regulations** on automated outbound calling.
2. **There is nothing on the other end.** Most Indian clinics have no digital booking
   system — even a perfect call connects to a receptionist with a paper diary.
3. Testing surfaced the rest: a US +1 number reads as spam to Indian recipients,
   receptionists hang up on synthetic voice, and STT accuracy collapses on 8kHz phone audio.

Handing the family the clinic's number and address is now the permanent design, not a
degraded fallback. The Twilio integration was deleted rather than left to rot.

The genuinely hard product lesson: the blocker wasn't the AI. It was that the workflow
being automated didn't exist in digital form at the destination.

---

## Failure modes worth knowing about

Real bugs from `tasks/lessons.md`, kept because each one cost a debugging session:

**WhatsApp's 24-hour window silently kills scheduled messages.** Free-form sends fail with
no visible error once a user hasn't messaged in 24 hours. Medication reminders were simply
not arriving. Every scheduled outbound message must go out as an approved Message Template;
free-form is only valid as a reply to an inbound message. Related: the first diagnosis
blamed a Railway restart, which was wrong — the API call would have failed either way.

**Two-way ternaries silently drop the third language.** `lang === 'hindi' ? hi : mr` was
copy-pasted across nine sites. Every English-preference user received Marathi, because
English was never checked — it just fell into the `else`. Three-language strings now use a
`{ hindi, english, marathi }[lang]` lookup, which can't omit a branch.

**Initializing an error tracker is not the same as using it.** Sentry was `init()`'d and
reported zero events for five days, because every catch block only called `console.error`
and nothing ever reached `captureException`.

**ESM import order breaks auto-instrumentation.** `Sentry.init()` inside `index.js` runs
*after* every static import in that file has already evaluated — so Express was loaded
unpatched, and Railway logged `express is not instrumented`. Fixed by moving init into
`instrument.js`, preloaded with `node --import`.

**Expiring page tokens can't back user-triggered pagination.** Google Places `pagetoken`
expires within minutes, so "show more clinics" failed whenever the user paused. Replaced
with numeric offsets. The clinic cache deliberately returns `nextPageToken: null` rather
than serving a stale token.

**Flow state can hijack unrelated messages.** A weak `isNewCommandOverride` regex means a
pending action swallows the next command. Every new `pending_action` gets two tests:
completing it normally, and sending something unrelated mid-flow.

---

## Known limitations

- **India-only assumptions are hardcoded.** Emergency numbers (108/100), the IST offset in
  the reminder scheduler, and a `, Pune` suffix on appointment map links. Overseas users
  get reminders at the wrong hour and non-functional emergency numbers. Fix requires a
  `country` and IANA `timezone` field captured at onboarding.
- **Voice input is designed, not built.** Sarvam STT for WhatsApp voice notes is documented
  as the next input path; there is no implementation in `src/` yet.
- **Supabase free tier ceilings out around 8,300 active users** — Edge Function quota, not
  storage. Above V1's target, but it's the first wall.
- **Razorpay international payments are off by default** and must be enabled in the
  dashboard before any overseas payer can subscribe.
- `src/webhook/whatsapp.js` is ~1,900 lines and carries most of the routing logic. It wants
  splitting by intent domain.

---

## Running it

```bash
nvm use                 # Node >= 22
npm install
cp .env.example .env    # fill in WhatsApp, Anthropic, Supabase, Maps, Razorpay keys
npm run dev
```

Then apply `supabase/schema.sql` in the Supabase SQL editor, followed by the migrations in
`supabase/` (clinic cache, RLS policies, health card columns, trial warning).

Point the Meta webhook at `<your-tunnel>/webhook`. `npm run tunnel` starts ngrok for local
development. `GET /` must return 200 — Meta's crawler checks it on every publish attempt
and blocks publishing if it 404s.

---

## Repository layout

```
src/
  index.js              Express app, signature verification, rate limiting, scheduler boot
  instrument.js         Sentry init — preloaded, must not move into index.js
  config/env.js         env validation
  webhook/whatsapp.js   inbound routing, intent dispatch, SOS, flow state
  routes/razorpay.js    subscription webhooks
  services/             claude, intelligence, onboarding, maps, reminders,
                        health-card, whatsapp, supabase, razorpay
supabase/               schema + migrations
research/               dated platform research with source tiers and decision log
.planning/              phase plans and summaries
tasks/lessons.md        running log of real bugs and the rules that came out of them
```

---

## Status

Phases 1–8 shipped. Phase 10 (digital health card) is planned across four documented
plans. Pricing in code is ₹199/month; the Phase 10 plan moves it to ₹499 flat.

Built by [@snktwghde](https://github.com/snktwghde) — an EmbedLab product.

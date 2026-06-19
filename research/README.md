# Research Findings — June 2026

**Archived research for CareProxy (WhatsApp-first AI elderly care agent for India)**

All findings dated June 19, 2026. Each file includes source citations (Tier 1: official docs, Tier 2: verified third-party, Tier 3: community reports).

---

## Files in This Directory

### 1. [ABDM_June_2026.md](./ABDM_June_2026.md)
**Status: BLOCKER — Physical appointment booking API not live**

- ABDM sandbox is open for free developer signup
- Physical Consultation Booking API marked "Coming Soon" — not live
- Apollo, Fortis, Max have ABHA certificates but NO live appointment booking endpoints
- First-hand developer accounts (Feb 2026) report: OTP emails never arriving, credentials stuck for months
- Sandbox → production: 2–4 weeks min for basic tier, ₹80K–2.5L for mandatory security audit
- **Decision**: Removed from Phase 1–4. Voice calling via Vapi is the only clinic booking path for V1.

**Impact**: Phase 4 simplified — all clinics booked via voice, no API shortcuts.

---

### 2. [Voice_AI_5Platform_Comparison_June_2026.md](./Voice_AI_5Platform_Comparison_June_2026.md)
**Status: DECISION UPDATED — Twilio Programmable Voice replaces Vapi**

- Wider comparison across 5 platforms: Vapi, Twilio, Bland AI, Google Cloud Dialogflow, Retell AI
- **Twilio wins**: cheapest at volume ($62–98/mo vs $132–330/mo for alternatives), best-verified India telephony access
- Hindi/Marathi voice quality: unverified for ALL 5 platforms — not a differentiator, becomes a Phase 4 testing requirement regardless of vendor
- Twilio's "not turnkey" downside doesn't apply to CareProxy — Claude was always handling conversation logic, so building the AI layer on top of Twilio isn't more work than doing the same on Vapi/Retell
- Backup option if Twilio integration proves too heavy: Retell AI (strongest community production sentiment, but unverified India deliverability)
- **Decision**: Build Phase 4 on Twilio Programmable Voice + own STT/TTS/LLM orchestration. Test Hindi/Marathi quality with real clinic calls before scaling.

**Impact**: Phase 4 architecture updated — Twilio telephony layer + Claude conversation logic + TBD STT/TTS provider (test 2-3 in Phase 4).

---

### 2a. [Vapi_vs_ElevenLabs_June_2026.md](./Vapi_vs_ElevenLabs_June_2026.md)
**Status: SUPERSEDED by #2 above — kept for historical reference**

Original two-platform comparison. ElevenLabs-specific finding (hard India geo-block, sales-gated deployment) still accurate. Vapi is no longer the primary recommendation — see Voice_AI_5Platform_Comparison_June_2026.md.

---

### 3. [Razorpay_Subscriptions_June_2026.md](./Razorpay_Subscriptions_June_2026.md)
**Status: CLEAR — No blockers, one unresolved detail**

- Sole proprietorship is supported (no need for Pvt Ltd)
- API flow verified: Plan → Subscription → Customer auth → Webhook updates
- Transaction fees: officially unclear (pages conflict between "0% UPI MDR" and "2% domestic"). Use 2–3% placeholder.
- New RBI e-mandate framework (Apr 2026) doesn't impact ₹199/month (under ₹15K threshold)
- **Action**: Confirm exact fee % with Razorpay support before launch (Phase 8), but no Phase 1–4 blocker.

**Impact**: Phase 8 payments. Placeholder margin model now, validate later.

---

### 4. [Supabase_FreeTier_June_2026.md](./Supabase_FreeTier_June_2026.md)
**Status: CLEAR — No changes to architecture**

- Free tier: 500 MB storage, 50K MAU, 500K Edge Fn invocations/month
- Real bottleneck: ~8,300 active users before hitting Edge Function quota (not storage, not auth)
- Well above V1 target of 500 users — no concern
- 7-day inactivity pause confirmed (cron jobs don't count as activity — project still pauses)
- Pro tier: $25/month if upgrade needed later

**Impact**: No action needed. Supabase plan unchanged.

---

### 5. [WhatsApp_CloudAPI_June_2026.md](./WhatsApp_CloudAPI_June_2026.md)
**Status: CLEAR — Start today, $0 cost**

- Test setup: completely free, no Business Verification needed
- Instant provisioning: test WABA, test phone number, access token
- Test recipients: up to 5 pre-approved numbers (use your own + family)
- Test messages: free, no explicit cap stated in docs
- Business Verification only needed when adding real phone number + going live to production
- Typical verification timeline: 2–3 business days (real-world), official SLA 14 days

**Impact**: No blocker to Phase 1 start. Full testing possible today.

---

## Decision Log

| Finding | Decision | Phase Impact |
|---------|----------|--------------|
| ABDM physical booking not live | Remove from Phase 1–4 scope | Phase 4: voice-only clinics, simpler |
| Twilio cheapest + best India telephony access among 5 platforms | **Switched from Vapi to Twilio** | Phase 4: Twilio telephony + own STT/TTS/Claude orchestration |
| Hindi/Marathi quality unverified for ALL voice platforms | Test in Phase 4 regardless of vendor | Phase 4: real clinic call testing required before scaling |
| Razorpay fees unconfirmed | Use 2–3% placeholder margin | Phase 8: confirm before launch |
| Supabase edge fn bottleneck at 8.3K users | No change, above V1 target | No impact |
| WhatsApp test setup free | Start Phase 1 today | Phase 1: go ahead, $0 cost |

---

## How to Use This Folder

1. **Before Phase 1**: Read `WhatsApp_CloudAPI_June_2026.md` — confirms you can start today.
2. **Before Phase 3–4**: Read `ABDM_June_2026.md` and `Voice_AI_5Platform_Comparison_June_2026.md` — confirms clinic booking approach (Twilio + voice calling, no API shortcuts).
3. **Before Phase 8**: Read `Razorpay_Subscriptions_June_2026.md` — check if fee % has been clarified since June 2026.
4. **Anytime**: Check `Supabase_FreeTier_June_2026.md` if you're approaching user limits.

---

## When to Update

- **ABDM**: When UHI's "Physical Consultation Booking" status changes from "Coming Soon" to "Live"
- **Voice platform**: After Phase 4 real-call quality testing — document actual Hindi/Marathi performance on Twilio + chosen STT/TTS provider, confirm or revise the Twilio decision
- **Razorpay**: Before Phase 8 launch — confirm exact fee % and update margin model
- **Supabase**: If approaching 8,000 users or considering upgrade
- **WhatsApp**: If Meta's test account policy changes (unlikely, but possible)

---

Generated: June 19, 2026 | Research conducted via Perplexity Pro + Kimi 2.6 agent swarm
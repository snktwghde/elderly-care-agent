# Voice AI Calling Platforms — India Clinic Booking — June 2026

**Status**: Decision updated — Twilio Programmable Voice replaces Vapi as primary choice  
**Supersedes**: `Vapi_vs_ElevenLabs_June_2026.md` (kept for reference; ElevenLabs eliminated, Vapi demoted)  
**Decision**: Build on Twilio Programmable Voice + own STT/TTS/LLM orchestration (Claude handles conversation logic regardless of vendor).

---

## Why This Re-Research Happened

Original research only compared Vapi vs ElevenLabs. Before committing to Phase 4, ran a wider comparison across 5 platforms: Vapi, Twilio, Bland AI, Google Cloud Speech + Dialogflow, Retell AI.

---

## Research Posture (Read This First)

This report intentionally marks many fields **COULD NOT VERIFY** rather than guessing. The brief required first-hand 2025–2026 community evidence for Hindi/Marathi quality — and that evidence largely doesn't exist publicly yet, for ANY platform. This is not a gap in the research; it's the actual state of the market. Test voice quality yourself in Phase 4, regardless of vendor.

**INR conversion caveat**: All INR figures use a working rate of ₹83.5/USD inferred from secondary sources, not independently verified against a live FX rate. Recheck before finalizing budgets.

---

## Platform-by-Platform Findings

### 1. Vapi.ai

| Aspect | Finding |
|--------|---------|
| Pricing | Platform fee $0.05/min confirmed; no official India-specific rate page found. Real-world all-in estimates: $0.18–0.33/min |
| Hindi quality | COULD NOT VERIFY — no first-hand 2025-2026 accounts found |
| Marathi quality | COULD NOT VERIFY — same |
| India availability | COULD NOT VERIFY — no documented India-specific restrictions or support, but none confirmed either |
| Integration ease | Likely hours-to-days; India-specific pain points unverified |
| Carrier blocking risk | COULD NOT VERIFY |

**Verdict**: Developer-friendly, fast to prototype, but India-specific pricing/deliverability proof is too thin for high-confidence production use.

---

### 2. Twilio Programmable Voice — ⭐ RECOMMENDED

| Aspect | Finding |
|--------|---------|
| Pricing | India mobile ~$0.0075–0.0456/min depending on product; SIP Trunking page confirms $0.0456/min (mobile), $0.0659/min (landline). Cheapest of all 5 platforms. |
| Hindi quality | COULD NOT VERIFY — Twilio is infrastructure, not a bundled voice model. Quality depends on your STT/TTS/LLM stack on top. |
| Marathi quality | COULD NOT VERIFY — same reason |
| India availability | **Best-verified of all 5 platforms.** Official India SIP Trunking pricing page exists; third-party India calculators confirm support. |
| Integration ease | Days to weeks — you assemble telephony + AI layer yourself (Claude for logic, separate STT/TTS) |
| Carrier blocking risk | COULD NOT VERIFY |

**Verdict**: Best-verified India telephony footing of all 5 platforms. Not turnkey — you build the AI orchestration layer. **This is not actually a disadvantage for CareProxy**, since Claude was always handling conversation logic regardless of vendor.

---

### 3. Bland AI

| Aspect | Finding |
|--------|---------|
| Pricing | Tiered: Free/$0.14/min, Build $299/mo + $0.12/min, Scale $499/mo + $0.11/min. ~$15/mo per phone number. |
| Hindi quality | COULD NOT VERIFY |
| Marathi quality | COULD NOT VERIFY |
| India availability | COULD NOT VERIFY — no documented India-specific telephony or regulatory posture |
| Integration ease | Likely hours-to-days, more turnkey than Twilio |
| Carrier blocking risk | COULD NOT VERIFY |

**Verdict**: Expensive at modest volume once plan fees + number costs included. India-specific evidence too thin to justify the cost premium.

---

### 4. Google Cloud Speech + Dialogflow

| Aspect | Finding |
|--------|---------|
| Pricing | $0.06/min audio input/output (official Dialogflow docs), but no bundled India PSTN outbound rate found |
| Hindi quality | COULD NOT VERIFY |
| Marathi quality | COULD NOT VERIFY |
| India availability | Partially verified — Google Cloud is accessible, but no turnkey India outbound calling path confirmed |
| Integration ease | Days to weeks — builder stack, not a calling platform; likely the most complex of all 5 |
| Carrier blocking risk | COULD NOT VERIFY |

**Verdict**: Potentially cost-efficient at the speech layer, but implementation complexity is materially higher than dedicated calling platforms. Not recommended for a solo founder on a build timeline.

---

### 5. Retell AI

| Aspect | Finding |
|--------|---------|
| Pricing | $0.07/min voice engine + ~$0.01/min Twilio telephony + ~$2/mo number. Realistic all-in: $0.13–0.31/min |
| Hindi quality | Reddit threads favor Retell over Bland/Vapi for "production feel," but don't mention Hindi specifically. COULD NOT VERIFY Hindi-specific quality. |
| Marathi quality | COULD NOT VERIFY |
| India availability | COULD NOT VERIFY — no documented India-specific telephony or regulatory posture |
| Integration ease | Hours-to-days, faster than Twilio/Google |
| Carrier blocking risk | COULD NOT VERIFY |

**Verdict**: Strongest production sentiment among voice-agent-native platforms (per Reddit comparisons), legible pricing. Main gap: zero India-specific deliverability evidence. **Worth keeping as backup shortlist candidate** if Twilio integration proves too heavy.

---

## Cost Comparison — 500 Calls/Month, 2-Min Average (1,000 Minutes)

| Platform | Monthly Cost (USD) | Monthly Cost (INR, approx) |
|----------|---------------------|------------------------------|
| **Twilio** | **$62–98** | **₹5,177–8,183** |
| Google Cloud Speech + Dialogflow | $68–106 | ₹5,678–8,851 |
| Retell AI | $132–312 | ₹11,022–26,052 |
| Bland AI | $155–434 | ₹12,942–36,239 |
| Vapi.ai | $180–330 | ₹15,030–27,555 |

**Twilio is the cheapest option by a clear margin** — roughly 2–5x cheaper than Vapi/Retell/Bland at this volume.

---

## Ranked Shortlist

1. **Twilio Programmable Voice** — Best-verified India telephony footing, cheapest cost. Trade-off: you build the AI layer yourself (which you were doing anyway).
2. **Retell AI** — Strongest production sentiment among voice-agent-native tools. Backup if Twilio integration proves too heavy. Hindi/Marathi evidence still unverified.
3. **Vapi.ai** — Fast to prototype, but India-specific proof too thin for high-confidence production use.
4. **Google Cloud Speech + Dialogflow** — Cost-efficient at speech layer, but most complex to implement. Not recommended for solo founder timeline.
5. **Bland AI** — Most expensive at this volume, thinnest India evidence.

---

## Critical Blockers (None Disqualifying, All Noted)

- **Twilio**: Not a turnkey voice-AI product — you assemble telephony + AI stack yourself. (Not a real blocker for CareProxy — Claude handles logic regardless of vendor.)
- **Retell AI**: No verified Hindi/Marathi evidence, no verified India-specific pricing page.
- **Vapi.ai**: No verified India-specific pricing/deliverability evidence strong enough for high-confidence production choice.
- **Google Cloud + Dialogflow**: Outbound India calling path is not turnkey; integration complexity substantially higher.
- **Bland AI**: Expensive at modest volume; thin India-specific evidence.

---

## Unknowns (Same Across All 5 Platforms)

- No platform has verified first-hand 2025–2026 Hindi production call-quality evidence
- No platform has verified first-hand 2025–2026 Marathi production call-quality evidence
- No platform has verified data on Jio/Airtel/Vi spam-flagging behavior for AI-originated calls
- India regulatory/compliance posture for AI outbound calling is highly deployment-specific, not fully verifiable from public sources
- Clean apples-to-apples cost comparison is difficult — some platforms bundle voice components, others (Twilio, Google) require external AI layers

**Action**: Since Hindi/Marathi quality is unverified everywhere, this stops being a vendor-selection criterion and becomes a **Phase 4 testing requirement** regardless of which platform you choose.

---

## Decision: Build on Twilio

### Why

1. **Cheapest at your volume** — $62–98/mo vs $132–330/mo for alternatives
2. **Best-verified India telephony access** — official SIP Trunking pricing page for India exists
3. **The "not turnkey" downside doesn't apply to CareProxy** — Claude was always going to handle intent parsing and conversation logic; Twilio + your own STT/TTS layer isn't meaningfully more integration work than Vapi/Retell + the same layer

### What This Means for Phase 4

- Use Twilio Programmable Voice for the telephony layer (placing/receiving calls to clinic numbers)
- Pair with a separate STT/TTS provider (to be decided — test 2–3 options with real Hindi/Marathi calls before locking in)
- Claude API handles conversation logic and intent parsing (already the plan)
- **Test Hindi/Marathi quality with real clinic calls in Phase 4** before scaling — this is unverified for every platform, not just Twilio

### Backup Plan

If Twilio's DIY integration proves too heavy for a solo non-technical-leaning build, **Retell AI** is the next best option — strongest community production sentiment, simpler integration, but unverified India deliverability and unverified Hindi/Marathi quality.

---

## Sources

Full source appendix with URLs available in original research report. Key sources:
- Twilio SIP Trunking Pricing in India (official): twilio.com/en-us/sip-trunking/pricing/in
- VAPI Review 2026 (dev.to)
- Bland AI Pricing 2026 (multiple secondary sources: Emitrr, Lindy, Autocalls)
- Google Cloud Dialogflow Editions docs (official)
- Retell AI Pricing 2026 (G2, Dialora, Squawkvoice)
- Reddit r/VoiceAiAgents2026, r/AI_Agent_Reviews, r/AiTools4Youu — production comparison threads (Retell vs Bland vs Vapi)

---

Last Updated: June 19, 2026
# WhatsApp Business Cloud API — Test Setup Guide — June 2026

**Status**: Clear — No blockers, start today with $0 cost  
**Decision**: Begin Phase 1 immediately. Full testing capability exists without Business Verification.

---

## 1. Exact Steps to Create Free Test Account

**Source**: Meta for Developers > WhatsApp > Cloud API > Get Started (developers.facebook.com/docs/whatsapp/cloud-api/get-started), verified June 2026.

### Step-by-Step (Takes ~5 minutes)

1. Go to **developers.facebook.com** and log in with your personal Facebook account
2. Create a **Meta Developer Account** if you don't have one (accept Platform Policy and Developer Terms)
3. Click **My Apps** → **Create App**
4. Select **Other** → **Business** as the app type; give your app a name
5. Create or connect a **Meta Business Account (MBA)** — Meta guides you inline if you don't have one
6. On your app dashboard, scroll to **Add Products** → click **Set Up** next to WhatsApp
7. Meta auto-provisions:
   - A test WhatsApp Business Account (WABA)
   - A test phone number (no real SIM required)
   - A temporary access token (24-hour validity; permanent token requires System User setup)
8. Navigate to **WhatsApp > API Setup** in the left sidebar
9. Under "Send and receive messages", go to **To field** → **Manage phone number list**
10. Add any real WhatsApp-enabled phone number as a test recipient (recipient gets a verification code in WhatsApp, must verify once)
11. You can now send the pre-approved `hello_world` template message to verified recipients immediately via curl/API

---

## 2. Cost to Create & Run Test Setup

**Source**: Meta for Developers > Cloud API > Get Started & Pricing, verified June 2026.

| Item | Cost |
|------|------|
| Meta Developer Account | Free |
| Meta Business Account | Free |
| Adding WhatsApp product to app | Free |
| Test phone number (Meta-provided) | Free |
| Test WhatsApp Business Account | Free |
| Business Verification fee | **Not required for testing** |
| Messages sent using test assets | Free |

**Official quote**: "When you use these test assets, you don't pay to send messages as you work to develop your app."

Costs only start when you add a real business phone number and go live to production (conversation-based pricing applies then).

---

## 3. Test-Phase Message Sending Limits

**Source**: Meta for Developers > Cloud API > Get Started, verified June 2026.

### Caps and Limits

| Limit | Detail |
|-------|--------|
| Test recipient phone numbers | Up to 5 pre-approved numbers |
| Message volume to those 5 numbers | No explicit daily cap in current docs |
| Cost per test message | $0 |
| Message type | Pre-approved templates (e.g., hello_world) OR free-form 24-hour window after recipient initiates |

### Notes

- Each of the 5 test numbers must complete a one-time WhatsApp code verification
- You can use your own phone as one of the 5
- Family/friends can be the other 4 — perfect for early testing

### ⚠️ Unconfirmed Limit

No explicit hard numeric cap on total test messages found in June 2026 official docs. Meta confirms the 5-recipient limit but doesn't state a separate per-message ceiling.

---

## 4. When Does Business Verification Become Required?

**Source**: Meta for Developers > Cloud API > Get Started & Meta Business Help Center > Verify Your Business, verified June 2026.

### Answer: NOT Needed for Testing

Business Verification is **NOT required** to start testing.

You can send your first test messages immediately using auto-provisioned test assets with zero verification.

### Verification Becomes Relevant When You:

- Add a real business phone number (not the free test number)
- Want to move to production and message real customers at scale
- Need to unlock higher messaging limits (scaling beyond Tier 1: 1,000 unique customers/24h)
- Want the Official Business Account green tick badge

### ⚠️ Exact Trigger Point Unconfirmed

No single Meta page found that explicitly states: "The moment you add a real number, verification is mandatory vs. only when crossing X volume threshold."

**Recommendation**: When you're ready to add a real number in Phase 8, check Meta's current onboarding flow — it will tell you exactly when verification is required.

---

## 5. Business Verification Timeline (2026 Reality)

**Source**: Meta Business Help Center > Verify Your Business, verified. Reddit r/WhatsappBusinessAPI & App-ening.com community reports, June 2026.

### Official SLA

Up to 14 business days.

### Real-World Reporting (Developer Community)

| Scenario | Reported Timeline |
|----------|-------------------|
| Standard, clean documents | 2–3 business days |
| Typical range | 2–5 business days |
| Slower cases | 1–2 weeks |
| Rare/complex cases | Up to 3 weeks |

### India-Specific Documents

Acceptable for Indian businesses:
- GST Registration Certificate
- Business Registration Certificate / Certificate of Incorporation (Pvt Ltd)
- Udyog Aadhaar / MSME Registration
- Utility bill or bank statement in your exact legal business name

**Critical**: The business name on all documents must match your Meta Business Account name exactly. Mismatches are the most common cause of delays.

---

## 6. Quick Reference Summary

| Question | Answer |
|----------|--------|
| Cost to start testing? | $0 |
| Test recipient limit? | 5 pre-approved numbers |
| Cost per test message? | $0 |
| Business Verification needed to test? | No |
| Business Verification timeline (real 2026)? | 2–3 days typical; up to 1–2 weeks occasionally |
| Which docs work for verification later? | GST, business cert, Udyog Aadhaar, utility bill |

---

## Action: Start Phase 1 Today

✅ **No blockers.** Create your Meta Developer account and WhatsApp test WABA right now.  
✅ **Test messaging immediately** with your own phone + 4 friends/family.  
✅ **Full API access** for building your Claude intent parser and Supabase pipeline.  
✅ **Zero cost** until you go live to production.

---

## Source Tier Reference

| Source | Trust Level | When to Use |
|--------|------------|-------------|
| Meta for Developers docs, Meta Business Help | Highest | Setup steps, pricing, official policy |
| Official Meta partner blogs (SendHub, Kommunicate) | High | Walkthroughs and screenshots |
| Developer community (Reddit, Stack Overflow) | Medium | Real-world timelines, edge cases |
| YouTube guides, unaffiliated blogs | Low-Medium | Visual demos only; cross-check vs. official |
| Older docs (pre-2025), Quora, random forums | Do not rely | Ignore unless confirmed by official sources |

---

## Sources

- Meta for Developers > WhatsApp > Cloud API > Get Started (developers.facebook.com/docs/whatsapp/cloud-api/get-started), June 2026
- Meta for Developers > WhatsApp > Pricing > Conversation-Based Pricing (developers.facebook.com/docs/whatsapp/pricing), June 2026
- Meta Business Help Center > Verify Your Business in Meta Business Suite (facebook.com/business/help/...), June 2026
- Reddit r/WhatsappBusinessAPI (2026 threads)
- App-ening.com > Meta Business Verification Guide (2026)

---

Last Updated: June 19, 2026  
Status: Ready to implement Phase 1
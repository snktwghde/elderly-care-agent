# Razorpay Subscriptions API — June 2026

**Status**: Clear — No Phase 1–4 blockers, one detail to confirm before Phase 8 launch  
**Decision**: Use 2–3% transaction fee placeholder. Confirm exact % with Razorpay before going live.

---

## 1. Current Subscriptions API Flow (High-Level)

Official docs are split across four pages:
- https://razorpay.com/docs/payments/subscriptions/
- https://razorpay.com/docs/payments/subscriptions/workflow/
- https://razorpay.com/docs/api/payments/subscriptions/
- https://razorpay.com/docs/webhooks/subscriptions/

### Exact Flow for ₹199/Month Plan

```
1. Create a Plan
   - Amount: ₹199
   - Billing cycle: monthly
   - Trial period (optional): 7 days
   
2. Create a Subscription
   - Link customer to plan
   - Specify start date
   - Set billing cycles (how many months)
   - Auth preference: card or UPI Autopay
   
3. Customer Authorizes Instrument
   - Card: Razorpay checkout collects card details, tokenizes
   - UPI Autopay: Registration + one-time additional factor auth
   
4. Automatic Charging
   - Razorpay auto-generates invoices at billing cycle start
   - Charges saved instrument (card or UPI mandate)
   
5. Webhook Updates
   - subscription.charged → payment successful
   - subscription.pending → awaiting processing
   - subscription.halted → temporarily paused
   - subscription.cancelled → user cancelled
   - subscription.paused → manually paused by you
   - subscription.resumed → resumed after pause
```

Your app listens to webhooks and grants/revokes access based on subscription status.

---

## 2. Transaction Fees (2026) — ⚠️ Unconfirmed

**⚠️ IMPORTANT**: Razorpay's 2026 public pricing pages show internal inconsistencies. No single canonical source exists.

### Conflicting Official Claims

| Fee Type | Claim 1 | Claim 2 | Resolution |
|----------|---------|---------|-----------|
| UPI MDR | "0% UPI MDR" | "2% domestic including UPI" | Unclear |
| Subscription layer | Not mentioned | ~0.99% added on top | Unclear |
| Card recurring | ~2% | No separate mention | Likely 2% |
| GST | N/A | 18% on top of all fees | Confirmed |

### Safest Working Model (Until Confirmed)

For a ₹199/month UPI Autopay subscription:

```
Gross charge: ₹199
Transaction fee: ~2–3% of gross (use this placeholder)
Fee amount: ₹4–6
GST on fee: 18% of fee amount
Platform fee (if any): ~0.99% (unconfirmed)
Net to you: ₹199 - fee - GST on fee - (platform fee)
```

**Use 2–3% as your working margin model.** Confirm exact breakdown with Razorpay support before Phase 8 launch.

---

## 3. Minimum Business Registration Type

**✅ VERIFIED**: A sole proprietorship is supported. You do NOT need Pvt Ltd.

Razorpay's subscription product is available to:
- Sole proprietorships
- Partnerships
- Private Limited companies
- LLPs

No minimum business structure requirement.

---

## 4. RBI Regulatory Changes (2025–2026)

### New Framework: Digital Payments – E-mandate Framework, 2026

**Effective Date**: April 21, 2026 (immediate effect)  
**Impact**: Repeals earlier e-mandate circulars from 2019–2024

### What Remains Unchanged for ₹199/Month

| Aspect | Status |
|--------|--------|
| Auto-debit threshold | ₹15,000 per transaction (unchanged) |
| Mandate registration | One-time, with additional factor authentication |
| Customer controls | Still required (modification, withdrawal) |
| Advance debit notification | Still required before each charge |
| 24-hour notification rule | Still applies (exact granularity unconfirmed) |

### Impact on Your Product

**None.** At ₹199/month (well under ₹15K threshold), no additional friction triggers.

---

## 5. Exact API Flow — Code-Ready Reference

When you're ready for Phase 8, the official docs at https://razorpay.com/docs/api/payments/subscriptions/ provide:

### Create Plan (POST /plans)
```json
{
  "period": "monthly",
  "interval": 1,
  "amount": 19900,  // in paise (₹199)
  "currency": "INR",
  "description": "CareProxy Monthly Subscription"
}
```

### Create Subscription (POST /subscriptions)
```json
{
  "plan_id": "plan_xxx",
  "customer_notify": 1,
  "quantity": 1,
  "total_count": 12,  // 12 months
  "start_at": 1719999600  // Unix timestamp
}
```

### Listen for Webhooks

Key events:
- `payment.authorized` (card stored)
- `subscription.charged` (monthly charge successful)
- `subscription.pending` (temporary hold)
- `subscription.halted` (payment failed 3+ times)
- `subscription.cancelled`

---

## Immediate Actions (Phase 8 Prep)

Before going live:

1. **Email Razorpay support**: "Can you clarify the exact transaction fee % for UPI Autopay recurring ₹199/month subscriptions, including GST and any subscription-layer fees?"
2. **Wait for response** (usually 24–48 hours)
3. **Update financial model** with confirmed %
4. **Verify webhook event names** haven't changed since June 2026 (unlikely, but confirm)

---

## Sources

- Razorpay Docs: Subscriptions (https://razorpay.com/docs/payments/subscriptions/)
- Razorpay Docs: How Subscriptions Work (https://razorpay.com/docs/payments/subscriptions/workflow/)
- Razorpay Docs: Subscriptions APIs (https://razorpay.com/docs/api/payments/subscriptions/)
- Razorpay Docs: Subscriptions Webhooks (https://razorpay.com/docs/webhooks/subscriptions/)
- Razorpay Blog: Transparent Pricing (June 2026)
- Razorpay Blog: Payment Gateways Pricing & Fees Explained (Feb 2026)
- RBI: Digital Payments – E-mandate Framework, 2026 (Apr 21, 2026)

---

Last Updated: June 19, 2026
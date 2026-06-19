# Supabase Free Tier Analysis — June 2026

**Status**: Clear — No changes to architecture, no Phase 1–4 impact  
**Decision**: Proceed with free tier. Real bottleneck is Edge Function invocations (~8,300 users), well above V1 target of 500.

---

## 1. Current Free Tier Limits (Exact June 2026 Numbers)

| Resource | Quota |
|----------|-------|
| Database Storage | 500 MB |
| Monthly Active Users (Auth) | 50,000 MAU |
| Edge Function Invocations | 500,000 per month |
| Egress (Bandwidth) | 5 GB per month |
| File Storage | 1 GB |
| Realtime Messages | 2 million per month |
| Realtime Peak Connections | 200 concurrent |
| Active Projects | 2 per account |
| API Requests | Unlimited |
| Compute | Shared CPU, 500 MB RAM |

**No recent changes** from 2024–2025. These numbers confirmed as of June 2026.

---

## 2. Project Pause Policy for Inactive Free-Tier Projects

### Current Rule (June 2026)

| Aspect | Detail |
|--------|--------|
| Inactivity threshold | 7 days (1 week) |
| What counts as activity | API traffic OR dashboard login to project |
| What does NOT count | Cron jobs / scheduled database tasks |
| Unpausing | Manual via Supabase Dashboard (takes several minutes) |
| Auto-resume | Does NOT auto-resume on next API request |

### Important Edge Case

**Cron jobs do NOT count as API activity.** If you have a scheduled medication reminder cron running inside the database but zero external API requests for 7 days, your project will pause regardless.

**Impact on your product**: Early in testing, if you have zero real users for a week, the project pauses. First request after pause: ~5–10 second cold-start delay. Not a blocker, just something to expect.

### Change History

This policy has been in place since at least 2024. No recent changelog entry indicates a June 2026 change.

---

## 3. Realistic Active User Ceiling (Before Hitting Limits)

### Scenario

A health care app with WhatsApp webhook traffic storing ~3 rows per user:

| Row Type | Size |
|----------|------|
| User profile | ~1 KB |
| Appointments | ~0.5 KB |
| Medication schedule | ~0.5 KB |
| **Total per user** | **~2 KB** |

### Activity Model

- Each user sends 1 WhatsApp message per day
- Receives 1 reply per day
- = 2 webhook/API calls per day
- = 60 Edge Function invocations per user per month
- Average egress per interaction: ~5 KB

### Bottleneck Analysis

| Limit | Available | Estimated Users | Notes |
|-------|-----------|-----------------|-------|
| Database Storage | 500 MB (524K KB) | ~262,000 users | Not the blocker |
| Auth MAU | 50,000 users | 50,000 users | Significant but not primary |
| **Edge Function Invocations** | **500,000/month** | **~8,300 users** | **REAL BOTTLENECK** |
| Egress | 5 GB (5.3M KB) | ~17,900 users | Not the primary limit |

### Practical Ceiling

**~8,000–8,500 active users** before hitting the Edge Function invocation quota — well above your V1 target of 500 users.

If you optimize webhook traffic (batching, database triggers), the ceiling rises toward the 50K MAU limit.

---

## 4. Upgrade Path (When Needed)

### Pro Plan: $25/Month per Organization

Included:

| Resource | Quota | Overage Price |
|----------|-------|----------------|
| MAU | 100,000 | $0.00325 per MAU |
| Database Disk | 8 GB | $0.125 per GB |
| Egress | 250 GB | $0.09 per GB |
| Edge Function Invocations | 2 million | $2 per million |
| Compute Credit | $10/month | – |

**No auto-pause** on Pro tier. Daily backups retained 7 days (vs 1 day on free).

**Additional cost**: Each project beyond the first Micro instance adds compute cost (~$0.32/hour for a Micro).

---

## 5. Pricing Page Structure (June 2026)

The current Supabase pricing page presents a full feature comparison table:
- Free / Pro / Team / Enterprise columns
- Every platform feature listed row-by-row (Database, Auth, Storage, Functions, Realtime, etc.)
- Clear usage quotas and overage rates
- "Organization-based billing" model prominently explained

No simplified "just the essentials" view — all features are itemized.

---

## Timeline for Upgrade Decision

| Users | Status | Action |
|-------|--------|--------|
| 0–500 (V1 target) | Safe | Continue on free tier |
| 500–5,000 | Approaching ceiling | Plan upgrade decision |
| 5,000–8,000 | Near Edge Function limit | Upgrade to Pro ($25/month) |
| 8,000+ | Over limit | Definitely need Pro or Team |

**You have runway**: From 500 to 8,000 users is 16x growth. By the time you hit that, you'll have revenue from paid subscriptions to cover $25/month Pro tier.

---

## No Architecture Changes Needed

✅ Proceed with Supabase free tier for Phase 1–7.  
✅ No schema changes needed when/if you upgrade to Pro.  
✅ No vendor lock-in risk — data is portable.

---

## Sources

- Supabase Pricing page (supabase.com/pricing), June 2026
- Supabase Billing docs (supabase.com/docs/guides/platform/billing-on-supabase)
- Supabase Changelog (supabase.com/changelog) — no June 2026 changes to free tier limits

---

Last Updated: June 19, 2026
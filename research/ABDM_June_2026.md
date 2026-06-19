# ABDM Developer Ecosystem — June 2026

**Status**: Blocker — Physical appointment booking API not live  
**Decision**: Removed from Phase 1–4 scope. Voice calling is the only clinic booking mechanism for V1.

---

## 1. Sandbox Signup Status

**✅ VERIFIED**: Sandbox is open for free developer signup at https://sandbox.abdm.gov.in/

The National Health Authority (NHA) explicitly states any digital health service provider can register and test ABDM API integration at no cost.

**⚠️ Reality Check** (Feb 2026, LinkedIn builder report):
- OTP verification emails never arrived
- Sandbox credentials never issued
- Applications remained unresolved for 3+ months
- Application status switched between "rejected" and "in progress" on page refresh
- No clear support pathway when onboarding fails

Quote: *"Infrastructure that builders cannot reliably access remains infrastructure in principle, not infrastructure in practice."*

---

## 2. Appointment Booking API Status

**❌ NOT LIVE**: Appointment booking is handled by **UHI (Unified Health Interface)**, not core ABDM.

Within UHI, the relevant services are:
- **Health Service Provider Applications (HSPA)** — provider-side integration
- **End User Applications (EUA)** — citizen-facing apps

### Current Service Status (June 2026 UHI service list):
| Service | Status |
|---------|--------|
| Tele-consultation Booking | Live |
| Ambulance Discovery & Booking | Live |
| **Physical Consultation Booking** | **Coming Soon** ❌ |

**The in-person appointment booking API is not yet available** — neither in sandbox nor production.

---

## 3. Apollo, Fortis, Max — Reality Check

**❌ CANNOT VERIFY**: These hospitals are NOT queryable for live appointment slots via ABDM/UHI.

**What they DO have**:
- Safe-to-Host certificates from 2023
- ABHA ID creation/auth endpoints
- Health records (M1/M2/M3) API integration

**What they DON'T have** (as of June 2026):
- Live appointment slot querying
- Physical consultation booking endpoints

**Critical distinction**: Being a "registered facility" on HFR (Health Facility Registry) is not the same as having a working appointment booking endpoint.

---

## 4. Developer Friction — Real Accounts

### Account 1: Ayush (LinkedIn, Feb 2026)
Multiple onboarding attempts over 3+ months at India AI Summit 2026. Issues:
- OTP verification failures
- Credentials never issued
- Applications stuck in review with no support escalation path
- Status randomly switching on page refresh

### Account 2: ABDM Wrapper GitHub (2024–2025)
Official NHA-ABDM wrapper has open issues indicating real blockers:
- **Issue #148** (Jul 2024): POST method not allowed for verifyMobileOTP
- **Issue #154** (Apr 2025): Missing medications block in FHIR bundle
- **Issue #134** (May 2024): Patient record data loss in HIP-to-PHR pipeline

### Account 3: DreamSoft4U Integration (Apr 2026)
Production-grade ABDM deployment failures:
- ABHA ID creation: incomplete Aadhaar details cause OTP failures
- Driving License-based registration: incorrect image formatting breaks API

### Account 4: OpenMalo (2025)
Common integration blockers:
- FHIR profile mismatches
- Consent edge cases
- Timestamp tolerance (server clock drift)
- HFR linkage failures

---

## 5. Sandbox-to-Production Gap (Realistic Timeline)

The official promise is 1–2 weeks. Real-world integrators report **2–4 months** minimum.

### Five-Stage Process

| Stage | Timeline | Cost | Notes |
|-------|----------|------|-------|
| Sandbox Registration | 1–2 days official, 2–4 weeks real | $0 | Frequent failures, no support |
| Functional Testing (M1/M2/M3) | Concurrent | ₹1.5L–10L | Must use NHA-empaneled agencies (FIME, Suma Soft, Tata Comm) |
| Security Audit (VAPT/Safe-to-Host) | 10–15 business days | ₹80K–2.5L | STQC or CERT-IN empaneled only |
| NHA Final Approval | Unclear | - | Submit WASA, Safe-to-Host cert, functional approvals |
| Production Credentials | After approval | - | Only then can you go live |

### Real-World Example
**UHI.app** (2026): "Sandbox approved, currently in pre-final stage, working towards production approval in 3 months."

---

## Cost & Timeline Summary

| Integration Path | Setup Cost | Time to Go Live |
|------------------|-----------|-----------------|
| Basic M1 (HPR/HFR) | ₹1.5L–3L | 2–8 weeks |
| Full M1–M3 (FHIR) | ₹3L–10L | 8–16 weeks |
| Custom Development | ₹10L–25L | 3–6 months |
| VAPT/Safe-to-Host | ₹80K–2.5L | 10–15 business days |

---

## Decision: Why It's Removed from Phase 1–4

1. **Physical Consultation Booking API is not live** — marked "Coming Soon" with no ETA
2. **Zero evidence** that Apollo/Fortis/Max have working appointment endpoints
3. **Sandbox onboarding is unreliable** — Feb 2026 report of months-long credential delays
4. **Compliance cost is high** — ₹80K–2.5L for mandatory security audit alone
5. **Build timeline balloons** — minimum 2–4 months if you start today

**Alternative (V1)**: Use voice calling via Vapi to reach clinics directly. All clinics get called the same way — no API shortcut needed.

---

## Revisit Criteria

Add ABDM back to roadmap if/when:
- UHI's "Physical Consultation Booking" status changes to "Live"
- You have a paying customer base of 1,000+ who specifically request API-integrated hospital booking
- You've confirmed Apollo/Fortis/Max have live appointment endpoints working in production

Until then: **Voice calling is your clinic booking mechanism.**

---

## Sources

- [web:1] PIB Press Release (2022) — sandbox.abdm.gov.in signup
- [web:5] ABDM Developer Forum — official sandbox timeline
- [web:11] ABDM Guidelines PDF — sandbox registration process
- [web:17] NHA-ABDM/ABDM-wrapper GitHub Issues — real technical blockers
- [web:18] Astra/GetAstra blog (2025) — VAPT costs and exit requirements
- [web:26] abdm.gov.in/uhi (2026) — UHI service status
- [web:28] Coronasafe network docs — NHA-empaneled testing agencies
- [web:37] LinkedIn (Ayush, Feb 2026) — first-hand sandbox failure account

---

Last Updated: June 19, 2026
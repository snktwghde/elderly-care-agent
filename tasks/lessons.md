# CareProxy — Lessons Log

Each lesson = a real bug or mistake that happened + the rule to prevent it from happening again.
Review this at the start of every session.

---

## Language / i18n

**L19 — Two-way ternaries silently drop the third language**
`lang === 'hindi' ? hindiText : marathiText` was copy-pasted across 9 locations (reminders.js lang derivation + message text, whatsapp.js family notifications and SOS messages). Every one silently routed English-preferred users to Marathi text, since English was never checked for — only assumed to be the "else" of hindi.
Rule: Any 3-language message must use `lang === 'hindi' ? x : lang === 'english' ? y : z` (or a `{ hindi, english, marathi }[lang]` object lookup, which is self-documenting and can't silently omit a branch). Never write a 2-way ternary for a 3-value field. When adding a new bilingual-looking ternary, grep the file for the same pattern first — it's usually been copy-pasted from an existing (possibly already-broken) one.

## Regex / Intent Matching

**L1 — Word boundary vs exact match**
Using `=== 'add'` or `^add$` breaks when users type the full button label ("Add new medicines").
Rule: Use `/^keyword\b/i.test(text)` — anchored at start, word boundary at end. Never exact equality for user-typed action keywords.

**L2 — SOS regex must cover vernacular**
Initial SOS regex missed common phrases. Always test with Marathi and Hindi variations, not just English.
Rule: SOS and intent patterns need a vernacular test pass before shipping.

**L3 — Specialty keyword mapper gaps**
"Dentist" wasn't in the mapper, fell through to generic. Any new specialty added in conversation must immediately be added to the mapper.
Rule: After adding a new specialist type to bot replies, add it to the keyword mapper in the same commit.

---

## WhatsApp API

**L4 — 24-hour window kills scheduled reminders**
Free-form messages fail silently if user hasn't messaged in 24 hours. Medication reminders were dropping with no error visible.
Rule: ALL scheduled outbound messages (reminders, notifications) must use WhatsApp Message Templates, not free-form text. Free-form is only for replies to incoming messages.

**L5 — Template variables can't be at start or end**
Meta rejects templates where `{{1}}` is the first or last token. Always wrap variables in surrounding text.
Rule: Draft template body with variable in the middle of the sentence. Test submit before coding the send call.

**L6 — Meta URL crawler caches aggressively**
After fixing a 404, Meta's crawler kept showing the old error for hours. Use Sharing Debugger "Scrape Again" to force re-check immediately.
Rule: After any URL/webhook change, immediately scrape with Meta Sharing Debugger, don't wait.

---

## Flow State / Pending Action

**L7 — `pending_action` can hijack unrelated messages**
The `isNewCommandOverride` guard determines if an incoming message is a new command or continuation of current state. A weak regex here causes new commands to be swallowed by the current flow.
Rule: When adding a new pending_action state, always test: (a) completing it normally, (b) sending a totally unrelated message mid-flow — it should break out cleanly.

**L8 — Double reminder bug on replace/continue**
The medication conflict flow was sending two reminders because the replace path didn't properly cancel the existing schedule before adding the new one.
Rule: Any "replace" flow must explicitly remove the old record before inserting the new one. Never assume the old one auto-expires.

---

## Time / Language Parsing

**L9 — Marathi time words need explicit mapping**
"vajta", "dupari", "sakali" weren't all covered. Partial coverage caused silent wrong-time scheduling.
Rule: Time word mappings must be exhaustive per language. After adding one Marathi time word, check if the full set is covered.

**L10 — Duration strings vs clock strings**
"2 divas" (2 days duration) was confused with a clock time in some paths.
Rule: Parse duration (days/weeks) and clock time (HH:MM) in separate passes. Never run both regexes on the same input without a type check first.

---

## Deployment / Infrastructure

**L11 — Railway restarts don't cause reminder failures**
Initial diagnosis blamed a Railway restart for a missed 9am reminder. The real cause was the WhatsApp 24-hour window. Restart doesn't matter — the cron re-runs on boot.
Rule: Before blaming infrastructure, check if the API call itself would have worked. Check WhatsApp delivery logs first.

**L12 — Root route must return 200**
Meta's app crawler checks the "Website" URL on every publish attempt. A missing root route (`GET /`) causes "Broken URL detected" and blocks publishing.
Rule: Always keep `app.get('/', ...)` returning 200. Verify it works before submitting Meta app for review.

---

## International / Overseas Users

**L15 — SOS numbers are India-specific**
`tel:108` (ambulance) and `tel:100` (police) are hardcoded in `handleSOS()` in `src/webhook/whatsapp.js` lines 1741–1742 and 1770–1772. They don't work outside India (e.g., Malaysia = 999/112).
Fix: Detect country from `recipient.home_address` or add a `country` field during onboarding. Return correct emergency numbers per country.

**L16 — Maps URL hardcodes ", Pune" for reminders**
`src/services/reminders.js:74` appends `, Pune` to every clinic name in the 1-hour appointment reminder link. Completely wrong for users outside Pune.
Fix: Remove `, Pune`. Use `appt.clinic_address` if stored, or just the clinic name without city suffix.

**L17 — All timezones assume IST for reminder scheduling**
`processMedicationReminders()` and all `toIST()` calls assume UTC+5:30. Malaysian users (MYT = UTC+8) get reminders 2.5 hours late.
Fix: Store `timezone` (IANA string e.g. "Asia/Kuala_Lumpur") during onboarding. Use it in the scheduler instead of hardcoded IST offset.

**L18 — Razorpay international payments need manual enablement**
Razorpay accepts international Visa/Mastercard but the setting is off by default. Go to Razorpay Dashboard → Settings → International Payments → Enable. Without this, overseas users cannot pay even if they have a Visa card.
Note: All charges are in INR — overseas users see ₹199 on the payment page, their bank converts to local currency. Razorpay subscriptions support recurring international card charges.

## General

**L13 — Hospitalisation is a different intent from clinic booking**
"Hospitalisation" messages were routing to clinic finder. It's a distinct intent requiring direct ambulance/hospital numbers.
Rule: High-urgency medical intents (hospitalisation, ICU, emergency admission) must be checked BEFORE the generic clinic booking path.

**L14 — "More clinics" pagination needs permanent offset, not page tokens**
Google Places `pagetoken` is time-sensitive and expires. Using it as a persistent offset caused failures on "Show more" after any delay.
Rule: Use numeric offset-based pagination (skip N results) for anything the user can trigger with a delay. Never rely on time-expiring tokens for paginated state.

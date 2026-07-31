import { Router } from 'express';
import { config } from '../config/env.js';
import { parseIntentSafe as parseIntent, parseAppointmentDetails } from '../services/claude.js';
import { createAppointment, updateCareRecipient, acknowledgeMedicationLog, getOrCreateAccount, updateAccount, getConversationHistory, saveMessage, getPrimaryCareRecipient, logMessage, countUnknownIntentsLastHour } from '../services/supabase.js';
import { sendTextMessage } from '../services/whatsapp.js';
import { handleOnboarding } from '../services/onboarding.js';
import { createSubscription, getPaymentLink } from '../services/razorpay.js';
import { generateHealthCard, sendHealthCardOffer, startHealthCardSetup, handleHealthCardSetup, startHealthCardFieldUpdate, handleHealthCardUpdate } from '../services/health-card.js';
import { findNearbyClinics, findMoreClinics } from '../services/maps.js';
import {
  updateClinicInsight, updateMedicationInsight, updateLanguageInsight,
  updateMessagePattern, updateAffirmativePattern, updateNegativePattern,
  removeMedicationFromInsight, extractBaseName,
} from '../services/intelligence.js';

const router = Router();

// Per-phone rate limit — 15 messages/min max to protect Claude API costs
const phoneRateMap = new Map();

function isPhoneRateLimited(phone) {
  const now = Date.now();
  const WINDOW_MS = 60 * 1000;
  const MAX_PER_WINDOW = 15;
  const record = phoneRateMap.get(phone) || { count: 0, windowStart: now };
  if (now - record.windowStart > WINDOW_MS) {
    phoneRateMap.set(phone, { count: 1, windowStart: now });
    return false;
  }
  if (record.count >= MAX_PER_WINDOW) return true;
  record.count++;
  phoneRateMap.set(phone, record);
  return false;
}

// Deduplicate Meta webhook retries — store processed message IDs for 60s
const processedMessageIds = new Set();

const HEALTH_CARD_SETUP_STATES = [
  'health_card_offer_pending',
  'health_card_blood_group',
  'health_card_current_meds',
  'health_card_allergies',
  'health_card_illnesses',
  'health_card_surgeries',
  'health_card_history',
  'health_card_hospitalization_when',
  'health_card_hospitalization_reason',
];

const HEALTH_CARD_UPDATE_STATES = [
  'health_card_update_blood_group',
  'health_card_update_allergies',
  'health_card_update_illnesses',
  'health_card_update_surgeries',
  'health_card_update_history',
];

const HEALTH_CARD_FIELDS = ['blood_group', 'allergies', 'major_illnesses', 'surgeries', 'medical_history'];

function markProcessed(messageId) {
  processedMessageIds.add(messageId);
  setTimeout(() => processedMessageIds.delete(messageId), 60000);
}

// Meta webhook verification (one-time setup)
router.get('/', (req, res) => {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];

  if (mode === 'subscribe' && token === config.whatsapp.verifyToken) {
    return res.status(200).send(challenge);
  }

  res.status(403).send('Forbidden');
});

// Incoming messages from WhatsApp
router.post('/', async (req, res) => {
  res.status(200).send('OK');

  try {
    const entry = req.body?.entry?.[0];
    const change = entry?.changes?.[0];
    const value = change?.value;

    if (!value?.messages?.length) return;

    const message = value.messages[0];
    if (message.type !== 'text') return;

    // Deduplicate — Meta sometimes sends the same message twice
    if (processedMessageIds.has(message.id)) return;
    markProcessed(message.id);

    const senderPhone = message.from.startsWith('+') ? message.from : `+${message.from}`;
    if (!/^\+[1-9]\d{6,14}$/.test(senderPhone)) return;
    if (isPhoneRateLimited(senderPhone)) {
      console.warn(`[Rate limit] ${senderPhone.slice(0, 5)}*** exceeded 15 messages/min`);
      return;
    }

    const messageText = message.text.body;

    let account = await getOrCreateAccount(senderPhone);
    await saveMessage(senderPhone, 'user', messageText);

    let reply;

    if (!account.onboarding_complete) {
      reply = await handleOnboarding(account, messageText);
      await sendTextMessage(senderPhone, reply);
      await saveMessage(senderPhone, 'assistant', reply);
      const updated = await getOrCreateAccount(senderPhone);
      if (updated.onboarding_complete) {
        await sendTrialStartedMessage(senderPhone);
        const newRecipient = await getPrimaryCareRecipient(senderPhone);
        const offerLang = newRecipient?.preferred_language || 'english';
        await sendHealthCardOffer(senderPhone, offerLang).catch(e => console.error('[Health card offer failed]', e.message));
      }
      return;
    }

    const recipient = await getPrimaryCareRecipient(senderPhone);
    const lang = recipient?.preferred_language || 'english';

    if (isSOS(messageText)) {
      reply = await handleSOS(account, lang, recipient);
      logMessage({ accountPhone: senderPhone, incomingMessage: messageText, parsedIntent: 'sos', parsedLanguage: lang, parsedConfidence: 'high', outgoingReply: reply }).catch(() => {});
    } else if (getSubscriptionStatus(account) === 'expired') {
      reply = await getExpiredReply(account, lang);
      logMessage({ accountPhone: senderPhone, incomingMessage: messageText, parsedIntent: 'expired_subscription', parsedLanguage: lang, parsedConfidence: 'high', outgoingReply: reply }).catch(() => {});
    } else if (account.pending_action && !isNewCommandOverride(messageText, account)) {
      reply = await handlePendingAction(account, messageText, lang, recipient);
      logMessage({
        accountPhone: senderPhone,
        incomingMessage: (
          HEALTH_CARD_SETUP_STATES.includes(account.pending_action) ||
          HEALTH_CARD_UPDATE_STATES.includes(account.pending_action)
        )
          ? '[health card input]'
          : messageText,
        parsedIntent: account.pending_action,
        parsedLanguage: lang,
        parsedConfidence: 'high',
        outgoingReply: (
          HEALTH_CARD_SETUP_STATES.includes(account.pending_action) ||
          HEALTH_CARD_UPDATE_STATES.includes(account.pending_action)
        )
          ? '[health card operation]'
          : reply,
      }).catch(() => {});
    } else if (isClinicSelection(messageText, account) && !isNewCommandOverride(messageText, account)) {
      reply = await handleClinicSelection(account, messageText, lang, recipient);
      logMessage({ accountPhone: senderPhone, incomingMessage: messageText, parsedIntent: 'clinic_selection', parsedLanguage: lang, parsedConfidence: 'high', outgoingReply: reply }).catch(() => {});
    } else if (isMoreRequest(messageText)) {
      reply = await handleMoreClinics(account, lang);
      logMessage({ accountPhone: senderPhone, incomingMessage: messageText, parsedIntent: 'more_clinics', parsedLanguage: lang, parsedConfidence: 'high', outgoingReply: reply }).catch(() => {});
    } else {
      // Clear stale pending_action if user sent a new command that overrode it
      if (account.pending_action && isNewCommandOverride(messageText, account)) {
        await updateAccount(senderPhone, { pending_action: null, pending_data: null });
        account = { ...account, pending_action: null, pending_data: null };
      }

      let parsedIntentResult = null;

      if (isMedicationAck(messageText)) {
        reply = await handleMedicationAck(account, lang);
        if (!reply) {
          // "okay/done" with no pending medication — treat as acknowledgment, don't invoke Claude
          if (/^(ok|okay|done|theek|accha|achha|alright|noted|ठीक|ठीक आहे)$/i.test(messageText.trim())) {
            reply = {
              english: 'Here\'s what I can help with:\n• *find doctor* — nearby clinic\n• *medication reminders* — set medicine reminders\n• *my medicines* — view current medicines\n• *health card* — your medical info\n• *help* — emergency',
              marathi: 'मी कशात मदत करू शकतो:\n• *find doctor* — जवळचे clinic\n• *medication reminders* — औषध reminders\n• *my medicines* — सध्याची औषधे\n• *health card* — वैद्यकीय माहिती\n• *help* — आपत्काल',
              hindi:   'मैं इनमें मदद कर सकता हूँ:\n• *find doctor* — नज़दीकी clinic\n• *medication reminders* — दवाई reminders\n• *my medicines* — मौजूदा दवाइयाँ\n• *health card* — medical जानकारी\n• *help* — emergency',
            }[lang];
          } else {
            const history = await getConversationHistory(senderPhone, 3);
            parsedIntentResult = await parseIntent(messageText, history, recipient?.user_insights);
            reply = await buildReply(parsedIntentResult, account, lang, recipient, messageText);
          }
        }
      } else {
        const history = await getConversationHistory(senderPhone, 3);
        parsedIntentResult = await parseIntent(messageText, history, recipient?.user_insights);
        reply = await buildReply(parsedIntentResult, account, lang, recipient, messageText);
      }

      await sendTextMessage(senderPhone, reply);
      await saveMessage(senderPhone, 'assistant', reply);

      if (parsedIntentResult) {
        updateMessagePattern(senderPhone, messageText, parsedIntentResult.intent).catch(() => {});
        updateLanguageInsight(senderPhone, parsedIntentResult.language).catch(() => {});

        logMessage({
          accountPhone: senderPhone,
          incomingMessage: messageText,
          parsedIntent: parsedIntentResult.intent,
          parsedLanguage: parsedIntentResult.language,
          parsedConfidence: parsedIntentResult.confidence,
          outgoingReply: (
            parsedIntentResult.intent === 'show_health_card' ||
            parsedIntentResult.intent === 'update_health_card'
          )
            ? '[health card operation]'
            : reply,
        }).catch(() => {});

        if (parsedIntentResult.intent === 'unknown') {
          countUnknownIntentsLastHour(senderPhone).then(count => {
            if (count >= 5) {
              console.error(`[ALERT] ${senderPhone.slice(0, 5)}*** has ${count} unknown intents in the last hour — possible parsing failure. Message length: ${messageText.length}`);
            }
          }).catch(() => {});
        }
      }
      return;
    }

    await sendTextMessage(senderPhone, reply);
    await saveMessage(senderPhone, 'assistant', reply);
  } catch (err) {
    console.error('Webhook handler error:', err.message);
    if (err.response?.data) console.error('API error detail:', JSON.stringify(err.response.data));
  }
});

// ─── New command override — breaks out of stale pending_action ────────────────

function isNewCommandOverride(text, account) {
  if (!account?.pending_action) return false;
  const { pending_action } = account;

  // Greetings always reset any pending state and show the menu
  if (/^(hi|hello|hey|helo|namaste|नमस्ते|नमस्कार|हाय|hy|hii|helo)$/i.test(text.trim())) {
    return true;
  }

  // Time/date input states: only break out for medication-related commands, not appointment keywords
  if (pending_action === 'awaiting_appointment_time_input' || pending_action === 'awaiting_appointment_date_input') {
    return /\b(medication|reminder|औषध|दवाई|cancel|रद्द|start over)\b/i.test(text.trim());
  }

  // Post-appointment state: only skip and prescribed medicines stay in handler; everything else goes to intent detection
  if (pending_action === 'awaiting_post_appointment') {
    return !/^(skip|prescribed medicines?|prescribed medicine|नको|नहीं|prescription)$/i.test(text.trim());
  }

  // Post-course-complete state: only yes/skip stay in handler; everything else (e.g. "book appointment") goes to intent detection
  if (pending_action === 'awaiting_post_course_response') {
    return !/^(yes|हो|ho|haan|हाँ|ha|हा|ok|okay|sure|हां|bilkul|skip|नको|नहीं)$/i.test(text.trim());
  }

  // Mid-medication-flow states: break out on appointment-domain keywords only
  // ('medication'/'reminder' intentionally excluded — they appear in valid answers like "7 din ki medication")
  if (['awaiting_medication_duration', 'awaiting_medication_frequency', 'awaiting_medication_times'].includes(pending_action)) {
    return /\b(book|appointment|doctor|clinic|डॉक्टर|अपॉइंटमेंट|cancel|रद्द|start over)\b/i.test(text.trim());
  }

  // Medication action menu: only known actions stay; everything else goes to intent detection
  if (pending_action === 'awaiting_medication_action') {
    return !/^(add|replace|update)$/i.test(text.trim());
  }

  // Medication conflict: only replace/continue stay; everything else goes to intent detection
  if (pending_action === 'medication_conflict') {
    return !/^(replace|continue)$/i.test(text.trim());
  }

  // Numeric-reply states: break out on broader command keywords
  const numericStates = ['returning_clinic_choice', 'appointment_type', 'saved_doctor_choice', 'awaiting_replace_selection', 'awaiting_update_selection'];
  if (!numericStates.includes(pending_action)) return false;
  return /\b(book|appointment|doctor|clinic|डॉक्टर|अपॉइंटमेंट|medication|reminder|औषध|दवाई|cancel|रद्द|start over)\b/i.test(text.trim());
}

// ─── Clinic selection (user replies 1–5 after seeing clinic list) ─────────────

function isClinicSelection(text, account) {
  return account.pending_data?.clinics?.length > 0 && /^[1-5]$/.test(text.trim());
}

async function handleClinicSelection(account, messageText, lang, recipient) {
  const index = parseInt(messageText.trim()) - 1;
  const clinics = account.pending_data?.clinics || [];
  const clinic = clinics[index];
  const isSelf = true;
  const recipientName = recipient?.recipient_name || 'them';

  if (!clinic) {
    return {
      english: 'Please reply with a number between 1 and 5.',
      marathi: 'कृपया 1 ते 5 मधील संख्या उत्तर द्या.',
      hindi:   'कृपया 1 से 5 के बीच संख्या में जवाब दें।',
    }[lang];
  }

  if (!clinic.phone) {
    await updateAccount(account.account_phone, {
      pending_action: 'awaiting_no_phone_clinic_type',
      pending_data: { selected_clinic: clinic, next_page_token: account.pending_data?.next_page_token || null },
    });
    return {
      english: isSelf
        ? `📍 *${clinic.name}*\n\n${clinic.address}\n\nNo phone number listed — you can walk in directly.\n\nDid you:\n\n1. Visited the doctor today (walk-in)?\n2. Skip this. Find another clinic with contact available\n\nReply 1 or 2`
        : `📍 *${clinic.name}*\n\n${clinic.address}\n\nNo phone number listed — ask ${recipientName} to walk in directly.\n\nDid ${recipientName}:\n\n1. Visit the doctor today (walk-in)?\n2. Skip this. Find another clinic with contact available\n\nReply 1 or 2`,
      marathi: isSelf
        ? `📍 *${clinic.name}*\n\n${clinic.address}\n\nफोन नंबर उपलब्ध नाही — थेट walk-in करता येईल.\n\nतुम्ही:\n\n1. आज Doctor ला भेटलात (walk-in)?\n2. हे सोडा. फोन नंबर असलेले दुसरे clinic शोधा\n\n1 किंवा 2 reply करा`
        : `📍 *${clinic.name}*\n\n${clinic.address}\n\nफोन नंबर उपलब्ध नाही — ${recipientName} यांना थेट walk-in करायला सांगा.\n\n${recipientName} यांनी:\n\n1. आज Doctor ला भेटले (walk-in)?\n2. हे सोडा. फोन नंबर असलेले दुसरे clinic शोधा\n\n1 किंवा 2 reply करा`,
      hindi: isSelf
        ? `📍 *${clinic.name}*\n\n${clinic.address}\n\nफ़ोन नंबर उपलब्ध नहीं — सीधे walk-in किया जा सकता है।\n\nक्या आपने:\n\n1. आज Doctor से मिले (walk-in)?\n2. यह छोड़ें। फ़ोन नंबर वाला दूसरा clinic खोजें\n\n1 या 2 reply करें`
        : `📍 *${clinic.name}*\n\n${clinic.address}\n\nफ़ोन नंबर उपलब्ध नहीं — ${recipientName} को सीधे walk-in करने कहें।\n\nक्या ${recipientName} ने:\n\n1. आज Doctor से मिले (walk-in)?\n2. यह छोड़ें। फ़ोन नंबर वाला दूसरा clinic खोजें\n\n1 या 2 reply करें`,
    }[lang];
  }

  if (clinic.name) updateClinicInsight(account.account_phone, clinic).catch(() => {});

  await updateAccount(account.account_phone, {
    pending_action: 'awaiting_booking_confirmation',
    pending_data: {
      selected_clinic: clinic,
      next_page_token: account.pending_data?.next_page_token || null,
    },
  });

  return {
    english: `📞 *${clinic.name}*\n\n${clinic.phone}\n\n📍 ${clinic.address}\n\nReply *Yes* once you've called and booked.\nPrefer to walk in? Just go directly — after your visit, type *prescribed medicines* to set your reminders.\nNeed more options? Type *more*.`,
    marathi: `📞 *${clinic.name}*\n\n${clinic.phone}\n\n📍 ${clinic.address}\n\nCall करून appointment घेतली का? *हो* म्हणा.\nStraight जाणार? भेटीनंतर *prescribed medicines* टाइप करा reminders साठी.\nआणखी पर्याय? *more* टाइप करा.`,
    hindi:   `📞 *${clinic.name}*\n\n${clinic.phone}\n\n📍 ${clinic.address}\n\nCall करके appointment ली? *हाँ* कहें।\nStraight जाना है? Visit के बाद *prescribed medicines* लिखें reminders के लिए।\nAur options? *more* लिखें।`,
  }[lang];
}

// ─── More clinics ─────────────────────────────────────────────────────────────

function isMoreRequest(text) {
  const t = text.trim().toLowerCase();
  return ['more', 'more options', 'aur dikhao', 'aur batao', 'अजून दाखवा', 'अजून', 'और दिखाओ'].includes(t);
}

async function handleMoreClinics(account, lang) {
  const token = account.pending_data?.next_page_token;

  if (!token) {
    return {
      english: 'No more clinics available nearby.',
      marathi: 'जवळपास आणखी क्लिनिक उपलब्ध नाहीत.',
      hindi:   'आस-पास और कोई क्लिनिक उपलब्ध नहीं है।',
    }[lang];
  }

  const { clinics, nextPageToken } = await findMoreClinics(token);
  await updateAccount(account.account_phone, {
    pending_data: {
      clinics,
      next_page_token: nextPageToken || null,
    },
  });

  const recipient = await getPrimaryCareRecipient(account.account_phone);
  return formatClinicList(clinics, null, lang, !!nextPageToken, true, recipient?.recipient_name || '');
}

// ─── Appointment save + medication handoff ────────────────────────────────────

async function confirmAndSaveAppointment({ account, account_phone, recipient, lang, clinic, appointmentTime, dateDisplay, datetimeIso }) {
  const isSelf = true;
  const recipientName = recipient?.recipient_name || 'them';

  await createAppointment({
    account_phone,
    recipient_name: recipient.recipient_name,
    clinic_name: clinic.name || 'Doctor',
    clinic_phone: clinic.phone || null,
    status: 'confirmed',
    appointment_date: dateDisplay || null,
    appointment_time: appointmentTime,
    appointment_datetime: datetimeIso || null,
  });

  const toE164 = p => p.startsWith('+') ? p : `+${p.replace(/\D/g, '')}`;
  const familyContacts = (recipient.family_contacts || []).filter(p => toE164(p) !== account_phone);
  if (familyContacts.length > 0) {
    const familyMsg = lang === 'hindi'
      ? `📅 ${recipient.recipient_name} की appointment confirm हो गई.\n\n🏥 ${clinic.name || 'Doctor'}\n🕐 ${appointmentTime}${dateDisplay ? '\n📅 ' + dateDisplay : ''}\n\n— CareProxy`
      : `📅 ${recipient.recipient_name} यांची appointment confirm झाली.\n\n🏥 ${clinic.name || 'Doctor'}\n🕐 ${appointmentTime}${dateDisplay ? '\n📅 ' + dateDisplay : ''}\n\n— CareProxy`;
    await Promise.all(familyContacts.map(p => sendTextMessage(toE164(p), familyMsg).catch(e => console.error(`Family notify failed to ${p.slice(0, 5)}***:`, e.message))));
  }

  try {
    await updateAccount(account_phone, {
      pending_action: 'awaiting_post_appointment',
      pending_data: { is_prescription: true },
    });
  } catch (e) {
    console.error('[confirmAndSaveAppointment] updateAccount failed:', e.message);
  }

  if (clinic.name) updateClinicInsight(account_phone, clinic).catch(() => {});

  const dateStr = dateDisplay ? `\n📅 ${dateDisplay}` : '';
  return {
    english: `✅ Appointment confirmed at *${clinic.name || 'doctor'}*!\n🕐 ${appointmentTime}${dateStr}${familyContacts.length > 0 ? '\nFamily has been notified. 👨‍👩‍👧' : ''} I'll remind ${isSelf ? 'you' : recipientName} 1 hour before. 🔔\n\nAfter the doctor visit, come back to CareProxy and type *prescribed medicines* to set reminders for any new medications.\n\nType *skip* if no prescription given.`,
    marathi: `✅ *${clinic.name || 'Doctor'}* येथे appointment नोंदवली!\n🕐 ${appointmentTime}${dateStr}${familyContacts.length > 0 ? '\nकुटुंबाला कळवले. 👨‍👩‍👧' : ''} 1 तास आधी reminder येईल. 🔔\n\nDoctor ला भेटल्यानंतर CareProxy वर परत या आणि *prescribed medicines* टाइप करा — नवीन औषधांचे reminders सेट करण्यासाठी.\n\nprescription नसल्यास *skip* टाइप करा.`,
    hindi:   `✅ *${clinic.name || 'Doctor'}* में appointment दर्ज हो गई!\n🕐 ${appointmentTime}${dateStr}${familyContacts.length > 0 ? '\nपरिवार को बता दिया। 👨‍👩‍👧' : ''} 1 घंटे पहले reminder आएगा। 🔔\n\nDoctor से मिलने के बाद CareProxy पर वापस आएं और *prescribed medicines* लिखें — नई दवाइयों के reminders के लिए.\n\nprescription नहीं मिली तो *skip* लिखें।`,
  }[lang];
}

// ─── Pending action handler (post-onboarding follow-up replies) ───────────────

async function handlePendingAction(account, messageText, lang, recipient) {
  const choice = messageText.trim().toLowerCase();
  const { pending_action, account_phone } = account;

  if (pending_action === 'awaiting_no_phone_clinic_type') {
    const clinic = account.pending_data?.selected_clinic || {};
    const clinicName = clinic.name || 'the clinic';
    const toE164 = p => p.startsWith('+') ? p : `+${p.replace(/\D/g, '')}`;

    if (choice === '1') {
      const isSelf = true;
      const familyContacts = (recipient?.family_contacts || []).filter(p => toE164(p) !== account_phone);
      if (familyContacts.length > 0) {
        const name = recipient.recipient_name;
        const familyMsg = lang === 'hindi'
          ? `🏥 ${name} ने आज ${clinicName} में doctor से मिले। उनसे पूछें visit कैसी रही। — CareProxy`
          : `🏥 ${name} आज ${clinicName} मध्ये doctor ला भेटले. त्यांना विचारा visit कशी गेली. — CareProxy`;
        await Promise.all(familyContacts.map(p => sendTextMessage(toE164(p), familyMsg).catch(e => console.error(`Family notify failed to ${p.slice(0, 5)}***:`, e.message))));
      }
      await updateAccount(account_phone, { pending_action: 'awaiting_medication_names', pending_data: { is_prescription: true } });

      return {
        english: `Got it! Glad ${isSelf ? 'you' : 'they'} saw the doctor. 😊\n\nDid the doctor prescribe any new medications? Tell me the names and I'll set reminders.\n\nOr type *skip* if none.`,
        marathi: `ठीक आहे! Doctor ला भेटले, छान! 😊\n\nDoctor ने नवीन औषधे दिली का? नावे सांगा, मी reminders सेट करतो.\n\nनसल्यास *skip* टाइप करा.`,
        hindi:   `ठीक है! Doctor से मिले, अच्छा हुआ। 😊\n\nDoctor ने कोई नई दवाइयाँ दी हैं? नाम बताएं, मैं reminders सेट कर दूंगा।\n\nनहीं दी तो *skip* लिखें।`,
      }[lang];
    }

    if (choice === '2') {
      await updateAccount(account_phone, { pending_action: null, pending_data: null });
      return await searchAndFormatClinics(recipient, null, lang, true);
    }

    return {
      english: `Please reply *1* if they saw the doctor today, or *2* to find another clinic.`,
      marathi: `कृपया *1* म्हणा जर आज Doctor ला भेटले, किंवा *2* दुसरे clinic शोधण्यासाठी.`,
      hindi:   `कृपया *1* लिखें अगर आज Doctor से मिले, या *2* दूसरा clinic खोजने के लिए।`,
    }[lang];
  }

  if (pending_action === 'awaiting_booking_confirmation') {
    const isYes    = /^(yes|हो|ho|haan|हाँ|ha|हा|ok|okay|confirmed|done|zali|झाली|book zali)$/i.test(choice);
    const isNo     = /^(no|nahi|नाही|नहीं|cancel)$/i.test(choice);
    const isWalkIn = /^(walk.?in|walkin|walk in|came|visited|आज|आलो|आले|भेटलो|भेटले|मिले|आया)$/i.test(choice)
      || /\bprescri(bed?|ption)\b/i.test(choice);

    if (isWalkIn) {
      updateAffirmativePattern(account_phone, choice).catch(() => {});
      const isSelf = true;
      const clinic = account.pending_data?.selected_clinic;
      const toE164 = p => p.startsWith('+') ? p : `+${p.replace(/\D/g, '')}`;
      const familyContacts = (recipient?.family_contacts || []).filter(p => toE164(p) !== account_phone);
      if (familyContacts.length > 0) {
        const familyMsg = {
          english: `🏥 ${recipient.recipient_name} visited the doctor at *${clinic?.name || 'a clinic'}* today. — CareProxy`,
          marathi: `🏥 ${recipient.recipient_name} आज *${clinic?.name || 'doctor'}* मध्ये doctor ला भेटले. — CareProxy`,
          hindi:   `🏥 ${recipient.recipient_name} ने आज *${clinic?.name || 'doctor'}* में doctor से मिले। — CareProxy`,
        }[lang] || `🏥 ${recipient.recipient_name} visited the doctor at *${clinic?.name || 'a clinic'}* today. — CareProxy`;
        await Promise.all(familyContacts.map(p => sendTextMessage(toE164(p), familyMsg).catch(() => {})));
      }
      await updateAccount(account_phone, { pending_action: 'awaiting_medication_names', pending_data: { is_prescription: true } });
      return {
        english: `Got it! Glad ${isSelf ? 'you' : 'they'} saw the doctor. 😊\n\nDid the doctor prescribe any new medications? Tell me the names and I'll set reminders.\n\nOr type *skip* if none.`,
        marathi: `ठीक आहे! Doctor ला भेटले, छान! 😊\n\nDoctor ने नवीन औषधे दिली का? नावे सांगा, मी reminders सेट करतो.\n\nनसल्यास *skip* टाइप करा.`,
        hindi:   `ठीक है! Doctor से मिले, अच्छा हुआ। 😊\n\nDoctor ने कोई नई दवाइयाँ दी हैं? नाम बताएं, मैं reminders सेट कर दूंगा।\n\nनहीं दी तो *skip* लिखें।`,
      }[lang];
    }

    if (isNo) {
      updateNegativePattern(account_phone, choice).catch(() => {});
      await updateAccount(account_phone, { pending_action: null, pending_data: null });
      return {
        english: 'No problem. Here\'s what I can help with:\n• *find doctor* — nearby clinic\n• *medication reminders* — set medicine reminders\n• *my medicines* — view current medicines\n• *health card* — your medical info\n• *help* — emergency',
        marathi: 'ठीक आहे. मी कशात मदत करू शकतो:\n• *find doctor* — जवळचे clinic\n• *medication reminders* — औषध reminders\n• *my medicines* — सध्याची औषधे\n• *health card* — वैद्यकीय माहिती\n• *help* — आपत्काल',
        hindi:   'कोई बात नहीं। मैं इनमें मदद कर सकता हूँ:\n• *find doctor* — नज़दीकी clinic\n• *medication reminders* — दवाई reminders\n• *my medicines* — मौजूदा दवाइयाँ\n• *health card* — medical जानकारी\n• *help* — emergency',
      }[lang];
    }

    if (!isYes) {
      const clinic = account.pending_data?.selected_clinic;
      return {
        english: `Did you book the appointment at *${clinic?.name || 'the clinic'}*? Reply *Yes*, *No*, or *Walk-in* if you visited today.`,
        marathi: `*${clinic?.name || 'क्लिनिक'}* येथे appointment book झाली का? *हो*, *नाही* किंवा आज भेटलात तर *Walk-in* म्हणा.`,
        hindi:   `*${clinic?.name || 'क्लिनिक'}* में appointment book हुई? *हाँ*, *नहीं* या आज मिले तो *Walk-in* कहें।`,
      }[lang];
    }

    updateAffirmativePattern(account_phone, choice).catch(() => {});
    const clinic = account.pending_data?.selected_clinic;
    await updateAccount(account_phone, {
      pending_action: 'awaiting_appointment_time_input',
      pending_data: account.pending_data,
    });
    return {
      english: `Great! What time is the appointment at *${clinic?.name || 'the clinic'}*?`,
      marathi: `छान! *${clinic?.name || 'क्लिनिक'}* येथे appointment किती वाजता आहे?`,
      hindi:   `बढ़िया! *${clinic?.name || 'क्लिनिक'}* में appointment कितने बजे है?`,
    }[lang];
  }

  if (pending_action === 'awaiting_appointment_time_input') {
    const clinic = account.pending_data?.selected_clinic || {};
    const details = await parseAppointmentDetails(`appointment at ${clinic.name || 'doctor'} at ${messageText.trim()}`);
    const appointmentTime = details.time_display;

    if (!appointmentTime) {
      return {
        english: `I didn't catch that time. What time is the appointment at *${clinic.name || 'the clinic'}*?\n\nFor example: *3pm*, *10:30 AM*, *morning*.`,
        marathi: `वेळ समजली नाही. *${clinic.name || 'clinic'}* येथे appointment कधी आहे?\n\nउदा: *3 वाजता*, *सकाळी 10:30*.`,
        hindi:   `समय समझ नहीं आया। *${clinic.name || 'clinic'}* में appointment कितने बजे है?\n\nजैसे: *3 बजे*, *सुबह 10:30*.`,
      }[lang];
    }

    if (!details.date_display) {
      await updateAccount(account_phone, {
        pending_action: 'awaiting_appointment_date_input',
        pending_data: { ...account.pending_data, pending_time: appointmentTime },
      });
      return {
        english: `Got it — *${appointmentTime}*. Which date is the appointment?\n\nYou can say *today*, *tomorrow*, or a specific date like *Monday* or *12 July*.`,
        marathi: `*${appointmentTime}* — ठीक आहे. appointment कोणत्या तारखेला आहे?\n\n*आज*, *उद्या*, किंवा *सोमवार* / *12 जुलै* असे सांगा.`,
        hindi:   `*${appointmentTime}* — ठीक है। appointment किस दिन है?\n\n*आज*, *कल*, या *सोमवार* / *12 जुलाई* बताएं।`,
      }[lang];
    }

    return await confirmAndSaveAppointment({
      account, account_phone, recipient, lang, clinic,
      appointmentTime, dateDisplay: details.date_display, datetimeIso: details.datetime_iso,
    });
  }

  if (pending_action === 'awaiting_appointment_date_input') {
    const clinic = account.pending_data?.selected_clinic || {};
    const pendingTime = account.pending_data?.pending_time || '';
    const combined = `appointment at ${clinic.name || 'doctor'} on ${messageText.trim()} at ${pendingTime}`;
    const details = await parseAppointmentDetails(combined);
    const dateDisplay = details.date_display;

    if (!dateDisplay) {
      return {
        english: `I didn't catch that date. What date is the appointment?\n\nYou can say *today*, *tomorrow*, or a date like *Monday* or *15 July*.`,
        marathi: `तारीख समजली नाही. appointment कोणत्या दिवशी आहे?\n\n*आज*, *उद्या*, किंवा *सोमवार* / *15 जुलै* असे सांगा.`,
        hindi:   `तारीख समझ नहीं आई। appointment किस दिन है?\n\n*आज*, *कल*, या *सोमवार* / *15 जुलाई* बताएं।`,
      }[lang];
    }

    return await confirmAndSaveAppointment({
      account, account_phone, recipient, lang, clinic,
      appointmentTime: pendingTime, dateDisplay, datetimeIso: details.datetime_iso,
    });
  }

  if (pending_action === 'appointment_type') {
    if (choice === '1') {
      await updateAccount(account_phone, { pending_action: null });
      return await searchAndFormatClinics(recipient, null, lang, true);
    }
    if (choice === '2') {
      const isSelfApptType = true;
      const rNameApptType = recipient?.recipient_name || 'them';
      await updateAccount(account_phone, { pending_action: 'specialist_type' });
      return {
        english: `Which type of specialist ${isSelfApptType ? 'do you' : `does ${rNameApptType}`} need?\n\nFor example: eye, heart, bones, skin, ENT, teeth`,
        marathi: `${isSelfApptType ? 'तुम्हाला' : `${rNameApptType} यांना`} कोणत्या प्रकारचे तज्ज्ञ डॉक्टर हवे आहेत?\n\nउदाहरण: डोळे, हृदय, हाडे, त्वचा, कान-नाक-घसा, दात`,
        hindi:   `${isSelfApptType ? 'आपको' : `${rNameApptType} को`} किस प्रकार के विशेषज्ञ डॉक्टर चाहिए?\n\nउदाहरण: आँख, दिल, हड्डी, त्वचा, कान-नाक-गला, दाँत`,
      }[lang];
    }
  }

  if (pending_action === 'saved_doctor_choice') {
    const isSelf = true;
    const recipientName = recipient?.recipient_name || 'them';
    if (choice === '1') {
      await updateAccount(account_phone, { pending_action: null });
      const doctor = recipient?.saved_doctors?.[0];
      return {
        english: `Calling ${doctor?.info || (isSelf ? 'your saved doctor' : `${recipientName}'s saved doctor`)} to book ${isSelf ? 'your' : `${recipientName}'s`} appointment. (Coming in Phase 4)`,
        marathi: `${doctor?.info || (isSelf ? 'तुमच्या नेहमीच्या डॉक्टर' : `${recipientName} यांच्या नेहमीच्या डॉक्टर`)}कडे appointment बुक करण्यासाठी call करत आहोत. (लवकरच येणार)`,
        hindi:   `${doctor?.info || (isSelf ? 'आपके डॉक्टर' : `${recipientName} के डॉक्टर`)} को appointment बुक करने के लिए call कर रहे हैं. (जल्द आएगा)`,
      }[lang];
    }
    if (choice === '2') {
      await updateAccount(account_phone, { pending_action: null });
      return await searchAndFormatClinics(recipient, null, lang, isSelf);
    }
  }

  if (pending_action === 'specialist_type') {
    await updateAccount(account_phone, { pending_action: null });
    return await searchAndFormatClinics(recipient, messageText.trim(), lang, true);
  }

  if (pending_action === 'awaiting_post_appointment') {
    const isSkip = /^(skip|नको|नहीं)$/i.test(messageText.trim());
    const isPrescription = /\b(prescribed medicines?|prescribed medicine|prescription)\b/i.test(messageText.trim());
    if (isSkip) {
      await updateAccount(account_phone, { pending_action: null, pending_data: null });
      return {
        english: 'Okay! Message me anytime for:\n• *find doctor* — nearby clinic\n• *medication reminders* — set medicine reminders\n• *my medicines* — view current medicines\n• *health card* — your medical info\n• *help* — emergency',
        marathi: 'ठीक आहे! कधीही message करा:\n• *find doctor* — जवळचे clinic\n• *medication reminders* — औषध reminders\n• *my medicines* — सध्याची औषधे पाहा\n• *health card* — तुमची वैद्यकीय माहिती\n• *help* — emergency',
        hindi:   'ठीक है! कभी भी message करें:\n• *find doctor* — नज़दीकी clinic\n• *medication reminders* — दवाई reminders\n• *my medicines* — मौजूदा दवाइयाँ देखें\n• *health card* — आपकी medical जानकारी\n• *help* — emergency',
      }[lang];
    }
    if (isPrescription) {
      await updateAccount(account_phone, { pending_action: 'awaiting_medication_names', pending_data: { is_prescription: true } });
      const isSelf = true;
      const rName = recipient?.recipient_name || 'them';
      return {
        english: `What are the names of the medicines the doctor prescribed? (e.g. Amoxicillin, Metformin)\n\nYou can list multiple — I'll set reminders for each.`,
        marathi: isSelf
          ? `Doctor ने कोणती औषधे दिली? (उदा. Amoxicillin, Metformin)\n\nएकापेक्षा जास्त असल्यास सर्व सांगा — प्रत्येकासाठी reminder सेट करतो.`
          : `Doctor ने ${rName} यांना कोणती औषधे दिली? (उदा. Amoxicillin, Metformin)\n\nएकापेक्षा जास्त असल्यास सर्व सांगा — प्रत्येकासाठी reminder सेट करतो.`,
        hindi: isSelf
          ? `Doctor ने कौन सी दवाइयाँ दी हैं? (जैसे Amoxicillin, Metformin)\n\nएक से ज़्यादा हैं तो सब बताएं — हर एक के लिए reminder सेट करूंगा।`
          : `Doctor ने ${rName} को कौन सी दवाइयाँ दी हैं? (जैसे Amoxicillin, Metformin)\n\nएक से ज़्यादा हैं तो सब बताएं — हर एक के लिए reminder सेट करूंगा।`,
      }[lang];
    }
    // Shouldn't reach here (isNewCommandOverride routes everything else to intent detection)
    return {
      english: 'After the doctor visit, type *prescribed medicines* to set reminders, or *skip* if no prescription given.',
      marathi: 'Doctor ला भेटल्यानंतर *prescribed medicines* टाइप करा, किंवा prescription नसल्यास *skip* टाइप करा.',
      hindi:   'Doctor से मिलने के बाद *prescribed medicines* लिखें, या prescription नहीं मिली तो *skip* लिखें।',
    }[lang];
  }

  if (pending_action === 'awaiting_medication_action') {
    const { med_schedule = [] } = account.pending_data || {};
    const action = messageText.trim().toLowerCase();

    if (action === 'add') {
      await updateAccount(account_phone, { pending_action: 'awaiting_medication_names', pending_data: { is_prescription: false } });
      return {
        english: `What new medicines would you like to add? Tell me the names.`,
        marathi: `कोणती नवीन औषधे जोडायची आहेत? नावे सांगा.`,
        hindi:   `कौन सी नई दवाइयाँ जोड़नी हैं? नाम बताएं।`,
      }[lang];
    }

    if (action === 'replace') {
      const medList = med_schedule.map((s, i) => `${i + 1}. *${s.name}*`).join('\n');
      await updateAccount(account_phone, { pending_action: 'awaiting_replace_selection', pending_data: { med_schedule } });
      return {
        english: `Which medicine would you like to replace?\n\n${medList}\n\nReply with a number (1–${med_schedule.length}).`,
        marathi: `कोणते औषध बदलायचे आहे?\n\n${medList}\n\n1–${med_schedule.length} मधील नंबर reply करा.`,
        hindi:   `कौन सी दवाई बदलनी है?\n\n${medList}\n\n1–${med_schedule.length} में से नंबर से reply करें।`,
      }[lang];
    }

    if (action === 'update') {
      const medList = med_schedule.map((s, i) => {
        if (!s.frequency || !(s.times || []).length) {
          return `${i + 1}. *${s.name}* _(reminder not set yet)_`;
        }
        const times = (s.times || []).map(displayTime).join(', ');
        return `${i + 1}. *${s.name}* (${s.frequency}x daily, ${times})`;
      }).join('\n');
      await updateAccount(account_phone, { pending_action: 'awaiting_update_selection', pending_data: { med_schedule } });
      return {
        english: `Which medicine's schedule would you like to update?\n\n${medList}\n\nReply with a number (1–${med_schedule.length}).`,
        marathi: `कोणत्या औषधाचे वेळापत्रक बदलायचे आहे?\n\n${medList}\n\n1–${med_schedule.length} मधील नंबर reply करा.`,
        hindi:   `किस दवाई का समय बदलना है?\n\n${medList}\n\n1–${med_schedule.length} में से नंबर से reply करें।`,
      }[lang];
    }

    return {
      english: `Please reply with:\n*add* — Add new medicines\n*replace* — Replace a medicine (doctor changed the drug)\n*update* — Update the schedule of a medicine (e.g., 1x daily → 2x daily)`,
      marathi: `कृपया reply करा:\n*add* — नवीन औषधे जोडा\n*replace* — औषध बदला (doctor ने वेगळे सांगितले)\n*update* — वेळापत्रक बदला (उदा. दिवसातून 1 वेळ → 2 वेळा)`,
      hindi:   `कृपया reply करें:\n*add* — नई दवाइयाँ जोड़ें\n*replace* — दवाई बदलें (doctor ने दूसरी दी)\n*update* — समय बदलें (जैसे दिन में 1 बार → 2 बार)`,
    }[lang];
  }

  if (pending_action === 'awaiting_replace_selection') {
    const { med_schedule = [] } = account.pending_data || {};
    const idx = parseInt(messageText.trim()) - 1;

    if (isNaN(idx) || idx < 0 || idx >= med_schedule.length) {
      return {
        english: `Please reply with a number between 1 and ${med_schedule.length}.`,
        marathi: `कृपया 1 ते ${med_schedule.length} मधील नंबर reply करा.`,
        hindi:   `कृपया 1 से ${med_schedule.length} के बीच नंबर से reply करें।`,
      }[lang];
    }

    const removed = med_schedule[idx];
    const fresh = await getPrimaryCareRecipient(account_phone);
    const freshSchedule = fresh?.medication_schedule || [];
    const newSchedule = freshSchedule.filter(s => s.name.toLowerCase() !== removed.name.toLowerCase());
    await updateCareRecipient(account_phone, { medication_schedule: newSchedule });
    removeMedicationFromInsight(account_phone, removed.name).catch(() => {});
    await updateAccount(account_phone, { pending_action: 'awaiting_medication_names', pending_data: { is_prescription: false } });
    return {
      english: `*${removed.name}* removed. What is the new medicine the doctor has prescribed? Tell me the name.`,
      marathi: `*${removed.name}* काढले. Doctor ने नवीन कोणते औषध सांगितले? नाव सांगा.`,
      hindi:   `*${removed.name}* हटा दिया। Doctor ने नई कौन सी दवाई दी? नाम बताएं।`,
    }[lang];
  }

  if (pending_action === 'awaiting_update_selection') {
    const { med_schedule = [] } = account.pending_data || {};
    const indices = [...messageText.matchAll(/\d+/g)]
      .map(m => parseInt(m[0]) - 1)
      .filter(i => i >= 0 && i < med_schedule.length);
    const uniqueIndices = [...new Set(indices)];

    if (uniqueIndices.length === 0) {
      return {
        english: `Please reply with a number (1–${med_schedule.length}).`,
        marathi: `कृपया 1–${med_schedule.length} मधील नंबर reply करा.`,
        hindi:   `कृपया 1–${med_schedule.length} में से नंबर से reply करें।`,
      }[lang];
    }

    const selectedMeds = uniqueIndices.map(i => med_schedule[i].name);
    await updateAccount(account_phone, {
      pending_action: 'awaiting_medication_frequency',
      pending_data: { medicines: selectedMeds, current_index: 0, collected_schedules: [], is_prescription: false },
    });
    return {
      english: `Updating *${selectedMeds[0]}*. How many times a day do you take it now?`,
      marathi: `*${selectedMeds[0]}* update करत आहे. आता दिवसातून किती वेळा घेता?`,
      hindi:   `*${selectedMeds[0]}* update हो रहा है। अब दिन में कितनी बार लेते हैं?`,
    }[lang];
  }

  if (pending_action === 'awaiting_unscheduled_setup_response') {
    const { unscheduled_names = [] } = account.pending_data || {};
    const isYes = /^(yes|हो|ho|haan|हाँ|ha|हा|sure|हां|bilkul|yeah|yep)$/i.test(messageText.trim());
    if (isYes && unscheduled_names.length > 0) {
      await updateAccount(account_phone, {
        pending_action: 'awaiting_medication_frequency',
        pending_data: { medicines: unscheduled_names, current_index: 0, collected_schedules: [], is_prescription: false },
      });
      return {
        english: `How many times a day do you take *${unscheduled_names[0]}*?`,
        marathi: `तुम्ही *${unscheduled_names[0]}* दिवसातून किती वेळा घेता?`,
        hindi:   `आप *${unscheduled_names[0]}* दिन में कितनी बार लेते हैं?`,
      }[lang];
    }
    await updateAccount(account_phone, { pending_action: null, pending_data: null });
    return {
      english: `No problem! Type *my medicines* anytime to view your schedule.`,
      marathi: `ठीक आहे! *my medicines* टाइप करा कधीही schedule पाहण्यासाठी.`,
      hindi:   `कोई बात नहीं! *my medicines* लिखें कभी भी schedule देखने के लिए।`,
    }[lang];
  }

  if (pending_action === 'awaiting_medication_names') {
    if (/^(yes|हो|ho|haan|हाँ|ha|हा|sure|हां|bilkul|yeah|yep)$/i.test(messageText.trim())) {
      return {
        english: `Please tell me the medicine names, e.g. Amoxicillin, Metformin`,
        marathi: `कृपया औषधांची नावे सांगा, उदा. Amoxicillin, Metformin`,
        hindi:   `कृपया दवाइयों के नाम बताएं, जैसे Amoxicillin, Metformin`,
      }[lang];
    }
    if (/^(skip|नको|नहीं|no thanks|nope|later|ok|okay|done|fine|alright|theek|thik)$/i.test(messageText.trim())) {
      await updateAccount(account_phone, { pending_action: null, pending_data: null });
      return {
        english: 'Okay! Message me anytime for:\n• *find doctor* — nearby clinic\n• *medication reminders* — set medicine reminders\n• *my medicines* — view current medicines\n• *health card* — your medical info\n• *help* — emergency',
        marathi: 'ठीक आहे! कधीही message करा:\n• *find doctor* — जवळचे clinic\n• *medication reminders* — औषध reminders\n• *my medicines* — सध्याची औषधे पाहा\n• *health card* — तुमची वैद्यकीय माहिती\n• *help* — emergency',
        hindi:   'ठीक है! कभी भी message करें:\n• *find doctor* — नज़दीकी clinic\n• *medication reminders* — दवाई reminders\n• *my medicines* — मौजूदा दवाइयाँ देखें\n• *health card* — आपकी medical जानकारी\n• *help* — emergency',
      }[lang];
    }
    // If user re-sent the trigger phrase instead of medicine names, re-ask
    if (/\b(reminder|set medication|औषध आठवण|दवाई reminder)\b/i.test(messageText.trim())) {
      return {
        english: `Please tell me the medicine names, e.g. Amoxicillin, Metformin`,
        marathi: `कृपया औषधांची नावे सांगा, उदा. Amoxicillin, Metformin`,
        hindi:   `कृपया दवाइयों के नाम बताएं, जैसे Amoxicillin, Metformin`,
      }[lang];
    }
    const medicines = messageText.split(/[,\n]|\band\b/i).map(m => m.trim()).filter(Boolean);
    if (medicines.length === 0) {
      return {
        english: `Please tell me the medicine names, e.g. Amoxicillin, Metformin`,
        marathi: `कृपया औषधांची नावे सांगा, उदा. Amoxicillin, Metformin`,
        hindi:   `कृपया दवाइयों के नाम बताएं, जैसे Amoxicillin, Metformin`,
      }[lang];
    }
    // Check for medication conflicts against learned active_medications
    const isSelf = true;
    const rName = recipient?.recipient_name || 'they';
    const activeMeds = recipient?.user_insights?.active_medications || [];
    const conflictPair = medicines.reduce((found, newMed) => {
      if (found) return found;
      const newBase = extractBaseName(newMed);
      const oldMed = activeMeds.find(m => extractBaseName(m) === newBase && m.toLowerCase() !== newMed.toLowerCase());
      return oldMed ? { oldMed, newMed } : null;
    }, null);

    if (conflictPair) {
      await updateAccount(account_phone, {
        pending_action: 'medication_conflict',
        pending_data: { conflict_old: conflictPair.oldMed, conflict_new: conflictPair.newMed, medicines, current_index: 0, collected_schedules: [] },
      });
      return {
        english: `${isSelf ? 'You are' : `${rName} is`} already taking *${conflictPair.oldMed}*. What did the doctor say?\n\n*replace* — Stop ${conflictPair.oldMed}, start ${conflictPair.newMed}\n*continue* — Keep ${conflictPair.oldMed} as-is, no change needed`,
        marathi: `${isSelf ? 'तुम्ही' : rName} आधीच *${conflictPair.oldMed}* घेत ${isSelf ? 'आहात' : 'आहेत'}. Doctor नी काय सांगितलं?\n\n*replace* — ${conflictPair.oldMed} बंद करा, ${conflictPair.newMed} सुरू करा\n*continue* — ${conflictPair.oldMed} तशीच चालू ठेवा, बदल नाही`,
        hindi:   `${isSelf ? 'आप' : rName} पहले से *${conflictPair.oldMed}* ले ${isSelf ? 'रहे हैं' : 'रहे हैं'}। Doctor ने क्या कहा?\n\n*replace* — ${conflictPair.oldMed} बंद करें, ${conflictPair.newMed} शुरू करें\n*continue* — ${conflictPair.oldMed} वैसे ही चलती रहे, कोई बदलाव नहीं`,
      }[lang];
    }

    const isPrescription = account.pending_data?.is_prescription || false;
    await updateAccount(account_phone, {
      pending_action: 'awaiting_medication_frequency',
      pending_data: { medicines, current_index: 0, collected_schedules: [], is_prescription: isPrescription },
    });
    return isPrescription ? {
      english: `How many times a day has the doctor advised to take *${medicines[0]}*?`,
      marathi: `Doctor ने *${medicines[0]}* दिवसातून किती वेळा घेण्यास सांगितले?`,
      hindi:   `Doctor ने *${medicines[0]}* दिन में कितनी बार लेने की सलाह दी?`,
    }[lang] : {
      english: `How many times a day do ${isSelf ? 'you' : recipient?.recipient_name || 'they'} take *${medicines[0]}*?`,
      marathi: isSelf
        ? `तुम्ही *${medicines[0]}* दिवसातून किती वेळा घेता?`
        : `${recipient?.recipient_name || 'ते'} *${medicines[0]}* दिवसातून किती वेळा घेतात?`,
      hindi: isSelf
        ? `आप *${medicines[0]}* दिन में कितनी बार लेते हैं?`
        : `${recipient?.recipient_name || 'वे'} *${medicines[0]}* दिन में कितनी बार लेते हैं?`,
    }[lang];
  }

  if (pending_action === 'awaiting_medication_frequency') {
    if (!account.pending_data?.medicines) {
      await updateAccount(account_phone, { pending_action: null, pending_data: null });
      return {
        english: 'Something went wrong. Please start again — what medications do you take?',
        marathi: 'काहीतरी चुकले. पुन्हा सुरू करा — कोणती औषधे घेता?',
        hindi:   'कुछ गलत हुआ। फिर से शुरू करें — कौन सी दवाइयाँ लेते हैं?',
      }[lang];
    }
    const { medicines, current_index, collected_schedules } = account.pending_data;
    const currentMedicine = medicines[current_index];
    const freq = Math.min(Math.max(parseInt(messageText.trim()) || 1, 1), 3);
    await updateAccount(account_phone, {
      pending_action: 'awaiting_medication_times',
      pending_data: { ...account.pending_data, current_frequency: freq },
    });
    const isPrescription = account.pending_data?.is_prescription || false;
    return isPrescription ? {
      english: {
        1: `At what time would you prefer to take *${currentMedicine}*? (e.g. 10am)`,
        2: `At what time would you prefer to take *${currentMedicine}*? (e.g. 10am, 9pm)`,
        3: `At what time would you prefer to take *${currentMedicine}*? (e.g. 8am, 1pm, 9pm)`,
      }[freq],
      marathi: {
        1: `*${currentMedicine}* कधी घ्यायचे? (उदा. सकाळी 10)`,
        2: `*${currentMedicine}* कधी घ्यायचे? (उदा. सकाळी 10, रात्री 9)`,
        3: `*${currentMedicine}* कधी घ्यायचे? (उदा. सकाळी 8, दुपारी 1, रात्री 9)`,
      }[freq],
      hindi: {
        1: `*${currentMedicine}* कब लेना है? (जैसे 10am)`,
        2: `*${currentMedicine}* कब-कब लेना है? (जैसे 10am, 9pm)`,
        3: `*${currentMedicine}* कब-कब लेना है? (जैसे 8am, 1pm, 9pm)`,
      }[freq],
    }[lang] : {
      english: {
        1: `At what time do you usually take *${currentMedicine}*?`,
        2: `At what times do you usually take *${currentMedicine}*? (morning and night)`,
        3: `At what times do you usually take *${currentMedicine}*? (morning, afternoon and night)`,
      }[freq],
      marathi: {
        1: `*${currentMedicine}* साधारण कोणत्या वेळी घेता?`,
        2: `*${currentMedicine}* साधारण कोणत्या वेळी घेता? (सकाळी आणि रात्री)`,
        3: `*${currentMedicine}* साधारण कोणत्या वेळी घेता? (सकाळी, दुपारी आणि रात्री)`,
      }[freq],
      hindi: {
        1: `*${currentMedicine}* आमतौर पर किस समय लेते हैं?`,
        2: `*${currentMedicine}* आमतौर पर किस समय लेते हैं? (सुबह और रात)`,
        3: `*${currentMedicine}* आमतौर पर किस समय लेते हैं? (सुबह, दोपहर और रात)`,
      }[freq],
    }[lang];
  }

  if (pending_action === 'awaiting_medication_times') {
    if (!account.pending_data?.medicines) {
      await updateAccount(account_phone, { pending_action: null, pending_data: null });
      return {
        english: 'Something went wrong. Please start again — what medications do you take?',
        marathi: 'काहीतरी चुकले. पुन्हा सुरू करा — कोणती औषधे घेता?',
        hindi:   'कुछ गलत हुआ। फिर से शुरू करें — कौन सी दवाइयाँ लेते हैं?',
      }[lang];
    }
    const { medicines, current_index, collected_schedules, current_frequency } = account.pending_data;
    const currentMedicine = medicines[current_index];
    const freq = current_frequency || 1;
    const newTimes = parseTimeInput(messageText, freq);
    const partialTimes = account.pending_data.partial_times || [];
    const allTimes = [...new Set([...partialTimes, ...newTimes])].slice(0, freq);

    if (allTimes.length === 0) {
      return {
        english: `Couldn't understand the time. Please send like: ${freq === 1 ? '8am' : freq === 2 ? '8am and 9pm' : '8am, 1pm and 9pm'}`,
        marathi: `वेळ समजली नाही. उदा: ${freq === 1 ? 'सकाळी 8' : freq === 2 ? 'सकाळी 8 आणि रात्री 9' : 'सकाळी 8, दुपारी 1 आणि रात्री 9'}`,
        hindi:   `समय समझ नहीं आया। जैसे: ${freq === 1 ? '8am' : freq === 2 ? '8am और 9pm' : '8am, 1pm और 9pm'}`,
      }[lang];
    }

    if (allTimes.length < freq) {
      const needed = freq - allTimes.length;
      await updateAccount(account_phone, {
        pending_action: 'awaiting_medication_times',
        pending_data: { ...account.pending_data, partial_times: allTimes },
      });
      return {
        english: `Got ${allTimes.length} time${allTimes.length !== 1 ? 's' : ''} so far (${allTimes.map(displayTime).join(', ')}). Need ${needed} more — send the remaining time${needed !== 1 ? 's' : ''}.`,
        marathi: `आतापर्यंत ${allTimes.length} वेळ मिळाल्या (${allTimes.map(displayTime).join(', ')}). अजून ${needed} हव्यात — उर्वरित वेळ पाठवा.`,
        hindi:   `अब तक ${allTimes.length} समय मिले (${allTimes.map(displayTime).join(', ')}). अभी ${needed} और चाहिए — बाकी समय भेजें.`,
      }[lang];
    }

    const times = allTimes;

    const updatedSchedules = [...collected_schedules, { name: currentMedicine, frequency: freq, times }];
    const nextIndex = current_index + 1;
    const isPrescription = account.pending_data?.is_prescription || false;
    const isSelf23 = true;

    await updateAccount(account_phone, {
      pending_action: 'awaiting_medication_duration',
      pending_data: { medicines, current_index, next_index: nextIndex, collected_schedules: updatedSchedules, is_prescription: isPrescription },
    });

    return isPrescription ? {
      english: `Got it! How many days has the doctor advised to take *${currentMedicine}*? (e.g. 7 days, 2 weeks, 1 month, or type *lifetime* if ongoing)`,
      marathi: `ठीक आहे! Doctor ने *${currentMedicine}* किती दिवस घेण्यास सांगितले? (उदा. 7 दिवस, 2 आठवडे, 1 महिना, किंवा *lifetime* टाइप करा नेहमीसाठी)`,
      hindi:   `ठीक है! Doctor ने *${currentMedicine}* कितने दिन लेने की सलाह दी? (जैसे 7 दिन, 2 हफ्ते, 1 महीना, या *lifetime* लिखें अगर हमेशा के लिए)`,
    }[lang] : isSelf23 ? {
      english: `Got it! How long are you advised to take *${currentMedicine}*? (e.g. 7 days, 2 weeks, 1 month, or type *lifetime* if ongoing)`,
      marathi: `ठीक आहे! *${currentMedicine}* किती दिवस घ्यायचे? (उदा. 7 दिवस, 2 आठवडे, 1 महिना, किंवा *lifetime* टाइप करा नेहमीसाठी)`,
      hindi:   `ठीक है! *${currentMedicine}* कितने दिन लेना है? (जैसे 7 दिन, 2 हफ्ते, 1 महीना, या *lifetime* लिखें अगर हमेशा के लिए)`,
    }[lang] : {
      english: `Got it! How long is ${recipient?.recipient_name || 'they'} advised to take *${currentMedicine}*? (e.g. 7 days, 2 weeks, 1 month, or type *lifetime* if ongoing)`,
      marathi: `ठीक आहे! ${recipient?.recipient_name || 'ते'} *${currentMedicine}* किती दिवस घेणार आहेत? (उदा. 7 दिवस, 2 आठवडे, 1 महिना, किंवा *lifetime* टाइप करा नेहमीसाठी)`,
      hindi:   `ठीक है! ${recipient?.recipient_name || 'वे'} *${currentMedicine}* कितने दिन लेंगे? (जैसे 7 दिन, 2 हफ्ते, 1 महीना, या *lifetime* लिखें अगर हमेशा के लिए)`,
    }[lang];
  }

  if (pending_action === 'awaiting_medication_duration') {
    if (!account.pending_data?.medicines) {
      await updateAccount(account_phone, { pending_action: null, pending_data: null });
      return {
        english: 'Something went wrong. Please start again.',
        marathi: 'काहीतरी चुकले. पुन्हा सुरू करा.',
        hindi:   'कुछ गलत हुआ। फिर से शुरू करें।',
      }[lang];
    }

    const { medicines, current_index, next_index: nextIndex, collected_schedules, is_prescription: isPrescription } = account.pending_data;
    const durationDays = parseDuration(messageText);

    if (durationDays === -1) {
      return {
        english: `Couldn't understand that. Please say something like: *7 days*, *2 weeks*, *1 month*, or *lifetime*.`,
        marathi: `समजले नाही. उदा: *7 दिवस*, *2 आठवडे*, *1 महिना*, किंवा *lifetime*.`,
        hindi:   `समझ नहीं आया। जैसे: *7 दिन*, *2 हफ्ते*, *1 महीना*, या *lifetime*.`,
      }[lang];
    }

    const today = new Date().toISOString().slice(0, 10);
    const endDate = durationDays === null ? null : addDays(today, durationDays);

    // Attach start/end dates to the last medicine in collected_schedules
    const updatedSchedules = collected_schedules.map((s, i) =>
      i === collected_schedules.length - 1 ? { ...s, start_date: today, end_date: endDate } : s
    );

    const isSelf = true;
    const rName = recipient?.recipient_name || 'they';

    // More medicines to collect
    if (nextIndex < medicines.length) {
      await updateAccount(account_phone, {
        pending_action: 'awaiting_medication_frequency',
        pending_data: { medicines, current_index: nextIndex, collected_schedules: updatedSchedules, is_prescription: isPrescription },
      });
      return isPrescription ? {
        english: `Got it! How many times a day has the doctor advised to take *${medicines[nextIndex]}*?`,
        marathi: `ठीक आहे! Doctor ने *${medicines[nextIndex]}* दिवसातून किती वेळा घेण्यास सांगितले?`,
        hindi:   `ठीक है! Doctor ने *${medicines[nextIndex]}* दिन में कितनी बार लेने की सलाह दी?`,
      }[lang] : {
        english: `Got it! Now, how many times a day do ${isSelf ? 'you' : rName} take *${medicines[nextIndex]}*?`,
        marathi: isSelf
          ? `ठीक आहे! आता, *${medicines[nextIndex]}* दिवसातून किती वेळा घेता?`
          : `ठीक आहे! आता, ${rName} *${medicines[nextIndex]}* दिवसातून किती वेळा घेतात?`,
        hindi: isSelf
          ? `ठीक है! अब, *${medicines[nextIndex]}* दिन में कितनी बार लेते हैं?`
          : `ठीक है! अब, ${rName} *${medicines[nextIndex]}* दिन में कितनी बार लेते हैं?`,
      }[lang];
    }

    // All medicines collected — save
    const existingRecipient = await getPrimaryCareRecipient(account_phone);
    const existingSchedule = existingRecipient?.medication_schedule || [];
    const newNames = new Set(updatedSchedules.map(s => s.name.toLowerCase()));
    const merged = [
      ...existingSchedule.filter(s => !newNames.has(s.name.toLowerCase())),
      ...updatedSchedules,
    ];
    await updateCareRecipient(account_phone, { medication_schedule: merged });
    updateMedicationInsight(account_phone, merged).catch(() => {});

    const toE164Med = p => p.startsWith('+') ? p : `+${p.replace(/\D/g, '')}`;
    const familyContacts = (recipient?.family_contacts || []).filter(p => toE164Med(p) !== account_phone);
    if (familyContacts.length > 0) {
      const summary = updatedSchedules.map(s => {
        const durLabel = s.end_date
          ? ` until ${s.end_date}`
          : s.end_date === null ? ' (lifetime)' : '';
        return `• ${s.name}: ${s.times.map(displayTime).join(', ')} (${s.frequency}x daily${durLabel})`;
      }).join('\n');
      const familyMsg = lang === 'hindi'
        ? `💊 ${recipient.recipient_name} की दवाइयों के reminders सेट हो गए।\n\n${summary}\n\n— CareProxy`
        : `💊 ${recipient.recipient_name} यांच्या औषधांचे reminders सेट झाले.\n\n${summary}\n\n— CareProxy`;
      await Promise.all(familyContacts.map(p => sendTextMessage(toE164Med(p), familyMsg).catch(e => console.error(`Send failed to ${p}:`, e.message))));
    }

    const confirmSummary = updatedSchedules.map(s => {
      let durLabel = '';
      if (s.end_date === null) durLabel = ' (lifetime)';
      else if (s.end_date && s.start_date) {
        const days = Math.round((new Date(s.end_date) - new Date(s.start_date)) / 86400000);
        const durText = days % 30 === 0 ? `${days / 30} month${days / 30 > 1 ? 's' : ''}` : days % 7 === 0 ? `${days / 7} week${days / 7 > 1 ? 's' : ''}` : `${days} day${days !== 1 ? 's' : ''}`;
        durLabel = ` (${durText})`;
      }
      return `💊 *${s.name}* — ${s.times.map(displayTime).join(', ')}${durLabel}`;
    }).join('\n');

    const familyNote = familyContacts.length > 0 ? { english: '\n\nFamily has been informed.', marathi: '\n\nकुटुंबाला यादी कळवली.', hindi: '\n\nपरिवार को सूची भेज दी।' }[lang] : '';

    if (isPrescription) {
      const recipientName = recipient?.recipient_name || (isSelf ? 'you' : 'they');
      await updateAccount(account_phone, { pending_action: 'awaiting_post_prescription_prompt', pending_data: null });
      return {
        english: `✅ Prescription reminders set!\n\n${confirmSummary}${familyNote}\n\nWould you also like to add any other regular medications ${isSelf ? 'you take' : `${recipientName} takes`} daily? Reply *Yes* or *No*.`,
        marathi: `✅ Prescription reminders सेट झाले!\n\n${confirmSummary}${familyNote}\n\n${isSelf ? 'तुम्ही' : recipientName} नियमित आणखी औषधे घेतात का? त्यांचेही reminders सेट करायचे आहेत का? *हो* किंवा *नाही* म्हणा.`,
        hindi:   `✅ Prescription reminders सेट हो गए!\n\n${confirmSummary}${familyNote}\n\n${isSelf ? 'आप' : recipientName} और कोई regular दवाइयाँ लेते हैं? उनके reminders भी लगाने हैं? *हाँ* या *नहीं* कहें।`,
      }[lang];
    }

    await updateAccount(account_phone, { pending_action: null, pending_data: null });
    const closingMsg = {
      english: `\n\nAll set! Type *my medicines* to view your schedule, *health card* for medical info, or *find doctor* for a clinic.`,
      marathi: `\n\nसर्व तयार! *my medicines* — schedule पाहा, *health card* — medical माहिती, *find doctor* — clinic शोधा.`,
      hindi:   `\n\nसब तैयार! *my medicines* — schedule देखें, *health card* — medical जानकारी, *find doctor* — clinic खोजें।`,
    }[lang];
    return {
      english: `✅ All reminders set!\n\n${confirmSummary}${familyNote}${closingMsg}`,
      marathi: `✅ सर्व reminders सेट झाले!\n\n${confirmSummary}${familyNote}${closingMsg}`,
      hindi:   `✅ सभी reminders सेट हो गए!\n\n${confirmSummary}${familyNote}${closingMsg}`,
    }[lang];
  }

  if (pending_action === 'awaiting_post_course_response') {
    const isYes = /^(yes|हो|ho|haan|हाँ|ha|हा|ok|okay|sure|हां|bilkul)$/i.test(choice);
    if (isYes) {
      const isSelf = true;
      await updateAccount(account_phone, { pending_action: 'awaiting_medication_names', pending_data: { is_prescription: false } });
      return {
        english: `What medications do ${isSelf ? 'you' : (recipient?.recipient_name || 'they')} take regularly? Tell me the names.`,
        marathi: `${isSelf ? 'तुम्ही' : recipient?.recipient_name || 'ते'} कोणती औषधे नियमित घेतात? नावे सांगा.`,
        hindi:   `${isSelf ? 'आप' : recipient?.recipient_name || 'वे'} नियमित कौन सी दवाइयाँ लेते हैं? नाम बताएं।`,
      }[lang];
    }
    await updateAccount(account_phone, { pending_action: null, pending_data: null });
    return {
      english: `No problem! Type *my medicines* to view your schedule, *health card* for medical info, or *find doctor* for a clinic.`,
      marathi: `ठीक आहे! *my medicines* — schedule पाहा, *health card* — medical माहिती, *find doctor* — clinic शोधा.`,
      hindi:   `कोई बात नहीं! *my medicines* — schedule देखें, *health card* — medical जानकारी, *find doctor* — clinic खोजें।`,
    }[lang];
  }

  if (pending_action === 'awaiting_post_prescription_prompt') {
    const isYes = /^(yes|हो|ho|haan|हाँ|ha|हा|ok|okay|sure|हां|bilkul)$/i.test(choice);
    if (isYes) {
      const isSelf = true;
      await updateAccount(account_phone, { pending_action: 'awaiting_medication_names', pending_data: { is_prescription: false } });
      return {
        english: `What other medications do ${isSelf ? 'you' : (recipient?.recipient_name || 'they')} take regularly? Tell me the names.`,
        marathi: `${isSelf ? 'तुम्ही' : recipient?.recipient_name || 'ते'} नियमित आणखी कोणती औषधे घेतात? नावे सांगा.`,
        hindi:   `${isSelf ? 'आप' : recipient?.recipient_name || 'वे'} नियमित और कौन सी दवाइयाँ लेते हैं? नाम बताएं।`,
      }[lang];
    }
    await updateAccount(account_phone, { pending_action: null, pending_data: null });
    return {
      english: `All set! Type *my medicines* to view your schedule, *health card* for medical info, or *find doctor* for a clinic.`,
      marathi: `सर्व तयार! *my medicines* — schedule पाहा, *health card* — medical माहिती, *find doctor* — clinic शोधा.`,
      hindi:   `सब तैयार! *my medicines* — schedule देखें, *health card* — medical जानकारी, *find doctor* — clinic खोजें।`,
    }[lang];
  }

  if (pending_action === 'returning_clinic_choice') {
    const returningClinic = account.pending_data?.returning_clinic;
    const isSelf = true;
    const recipientName = recipient?.recipient_name || 'them';

    if (choice === '1') {
      if (!returningClinic?.phone) {
        await updateAccount(account_phone, { pending_action: null, pending_data: null });
        return await searchAndFormatClinics(recipient, null, lang, isSelf);
      }
      if (returningClinic.name) updateClinicInsight(account_phone, returningClinic).catch(() => {});
      await updateAccount(account_phone, {
        pending_action: 'awaiting_booking_confirmation',
        pending_data: { selected_clinic: returningClinic },
      });
      return {
        english: `📞 *${returningClinic.name}*\n\n${returningClinic.phone}\n\n📍 ${returningClinic.address}\n\nCall to book ${isSelf ? 'your' : `${recipientName}'s`} appointment. Once done, reply *Yes* to confirm.\nVisited today instead? Reply *Walk-in*.`,
        marathi: `📞 *${returningClinic.name}*\n\n${returningClinic.phone}\n\n📍 ${returningClinic.address}\n\n${isSelf ? 'तुमच्या' : `${recipientName} यांच्या`} appointment साठी call करा. झाल्यावर *हो* म्हणा.\nआज भेटलात? *Walk-in* म्हणा.`,
        hindi:   `📞 *${returningClinic.name}*\n\n${returningClinic.phone}\n\n📍 ${returningClinic.address}\n\n${isSelf ? 'आपकी' : `${recipientName} की`} appointment के लिए call करें। हो जाने पर *हाँ* कहें।\nआज मिले? *Walk-in* कहें।`,
      }[lang];
    }

    await updateAccount(account_phone, { pending_action: null, pending_data: null });
    return await searchAndFormatClinics(recipient, null, lang, isSelf);
  }

  if (pending_action === 'medication_conflict') {
    const { conflict_old, conflict_new, medicines, current_index, collected_schedules } = account.pending_data;
    const isSelf = true;
    const rNameConflict = recipient?.recipient_name || 'they';

    if (choice !== 'replace' && choice !== 'continue') {
      return {
        english: `Please reply *replace* or *continue*.`,
        marathi: `कृपया *replace* किंवा *continue* reply करा.`,
        hindi:   `कृपया *replace* या *continue* reply करें।`,
      }[lang];
    }

    if (choice === 'replace') {
      const existingRecipient = await getPrimaryCareRecipient(account_phone);
      const oldBase = extractBaseName(conflict_old);
      const updatedSchedule = (existingRecipient?.medication_schedule || []).filter(
        m => extractBaseName(m.name) !== oldBase
      );
      const insights = existingRecipient?.user_insights || {};
      const updatedMeds = (insights.active_medications || []).filter(m => extractBaseName(m) !== oldBase);
      await updateCareRecipient(account_phone, {
        medication_schedule: updatedSchedule,
        user_insights: { ...insights, active_medications: updatedMeds },
      });
      await updateAccount(account_phone, {
        pending_action: 'awaiting_medication_frequency',
        pending_data: { medicines, current_index, collected_schedules },
      });
      return {
        english: `Got it, *${conflict_old}* removed. How many times a day do ${isSelf ? 'you' : rNameConflict} take *${medicines[current_index]}*?`,
        marathi: isSelf
          ? `ठीक आहे, *${conflict_old}* बंद केली. तुम्ही *${medicines[current_index]}* दिवसातून किती वेळा घेता?`
          : `ठीक आहे, *${conflict_old}* बंद केली. ${rNameConflict} *${medicines[current_index]}* दिवसातून किती वेळा घेतात?`,
        hindi: isSelf
          ? `ठीक है, *${conflict_old}* बंद कर दी। आप *${medicines[current_index]}* दिन में कितनी बार लेते हैं?`
          : `ठीक है, *${conflict_old}* बंद कर दी। ${rNameConflict} *${medicines[current_index]}* दिन में कितनी बार लेते हैं?`,
      }[lang];
    }

    // continue: keep old medicine as-is, skip the conflicting new entry
    const remainingMedicines = medicines.filter(m => m.toLowerCase() !== conflict_new.toLowerCase());
    if (remainingMedicines.length === 0) {
      await updateAccount(account_phone, { pending_action: null, pending_data: null });
      return {
        english: `Got it, keeping *${conflict_old}* as-is. Reminders continue unchanged.`,
        marathi: `ठीक आहे, *${conflict_old}* तशीच चालू आहे. Reminders बदलले नाहीत.`,
        hindi:   `ठीक है, *${conflict_old}* वैसे ही चलती रहेगी। Reminders में कोई बदलाव नहीं।`,
      }[lang];
    }
    await updateAccount(account_phone, {
      pending_action: 'awaiting_medication_frequency',
      pending_data: { medicines: remainingMedicines, current_index: 0, collected_schedules },
    });
    return {
      english: `Got it, keeping *${conflict_old}* as-is. How many times a day do ${isSelf ? 'you' : rNameConflict} take *${remainingMedicines[0]}*?`,
      marathi: isSelf
        ? `ठीक आहे, *${conflict_old}* तशीच चालू ठेवली. तुम्ही *${remainingMedicines[0]}* दिवसातून किती वेळा घेता?`
        : `ठीक आहे, *${conflict_old}* तशीच चालू ठेवली. ${rNameConflict} *${remainingMedicines[0]}* दिवसातून किती वेळा घेतात?`,
      hindi: isSelf
        ? `ठीक है, *${conflict_old}* वैसे ही रहेगी। आप *${remainingMedicines[0]}* दिन में कितनी बार लेते हैं?`
        : `ठीक है, *${conflict_old}* वैसे ही रहेगी। ${rNameConflict} *${remainingMedicines[0]}* दिन में कितनी बार लेते हैं?`,
    }[lang];
  }

  if (pending_action === 'health_card_declined_next_step') {
    const choice = messageText.trim();
    if (choice === '1') {
      await updateAccount(account_phone, { pending_action: null, pending_data: null });
      return await handleBookAppointment({ details: {} }, account, lang, recipient);
    }
    if (choice === '2') {
      await updateAccount(account_phone, { pending_action: 'awaiting_medication_names', pending_data: null });
      return {
        english: `What medications would you like to set reminders for? List the names separated by commas.`,
        marathi: `कोणत्या औषधांसाठी reminders सेट करायचे आहेत? नावे स्वल्पविरामाने विभागून लिहा.`,
        hindi:   `किन दवाइयों के लिए reminders सेट करने हैं? नाम comma से अलग करके लिखें.`,
      }[lang];
    }
    if (choice === '3') {
      return await startHealthCardSetup(account_phone, lang);
    }
    return {
      english: `Please reply 1, 2, or 3:\n\n1. Find a clinic\n2. Set medication reminder\n3. Set up health card`,
      marathi: `कृपया 1, 2, किंवा 3 reply करा:\n\n1. Clinic शोधा\n2. औषध reminder सेट करा\n3. Health card सेट करा`,
      hindi:   `कृपया 1, 2, या 3 reply करें:\n\n1. Clinic खोजें\n2. दवाई reminder सेट करें\n3. Health card सेट करें`,
    }[lang];
  }

  if (HEALTH_CARD_SETUP_STATES.includes(pending_action)) {
    return await handleHealthCardSetup(account, messageText, lang, recipient);
  }

  if (HEALTH_CARD_UPDATE_STATES.includes(pending_action)) {
    return await handleHealthCardUpdate(account, messageText, lang, recipient);
  }

  // Unknown pending state — reset and re-prompt
  await updateAccount(account_phone, { pending_action: null });
  return {
    english: 'What would you like to do?\n• *find doctor* — nearby clinic\n• *medication reminders* — set medicine reminders\n• *my medicines* — view current medicines\n• *health card* — your medical info\n• *help* — emergency',
    marathi: 'काय करायचे आहे?\n• *find doctor* — जवळचे clinic\n• *medication reminders* — औषध reminders\n• *my medicines* — सध्याची औषधे\n• *health card* — वैद्यकीय माहिती\n• *help* — आपत्काल',
    hindi:   'क्या करना है?\n• *find doctor* — नज़दीकी clinic\n• *medication reminders* — दवाई reminders\n• *my medicines* — मौजूदा दवाइयाँ\n• *health card* — medical जानकारी\n• *help* — emergency',
  }[lang];
}

// ─── Intent reply builder ─────────────────────────────────────────────────────

async function buildReply(parsed, account, lang, recipient, messageText) {
  if (/^(find\s*(doctor|clinic|nearest)|nearest\s*(doctor|clinic)|doctor\s*near|clinic\s*near)/i.test(messageText.trim())) {
    return await handleBookAppointment({ intent: 'book_appointment', details: {} }, account, lang, recipient);
  }

  if (/^specialised$/i.test(messageText.trim())) {
    const isSelfSpec = true;
    const rNameSpec = recipient?.recipient_name || 'them';
    await updateAccount(account.account_phone, { pending_action: 'specialist_type' });
    return {
      english: `Which type of specialist ${isSelfSpec ? 'do you' : `does ${rNameSpec}`} need?\n\nFor example: eye, heart, bones, skin, ENT, teeth`,
      marathi: `${isSelfSpec ? 'तुम्हाला' : `${rNameSpec} यांना`} कोणत्या प्रकारचे तज्ज्ञ डॉक्टर हवे आहेत?\n\nउदाहरण: डोळे, हृदय, हाडे, त्वचा, कान-नाक-घसा, दात`,
      hindi:   `${isSelfSpec ? 'आपको' : `${rNameSpec} को`} किस प्रकार के विशेषज्ञ डॉक्टर चाहिए?\n\nउदाहरण: आँख, दिल, हड्डी, त्वचा, कान-नाक-गला, दाँत`,
    }[lang];
  }

  if (parsed.intent === 'book_appointment') {
    return await handleBookAppointment(parsed, account, lang, recipient);
  }

  if (parsed.intent === 'confirm_appointment') {
    return await handleConfirmAppointment(messageText, account, lang, recipient);
  }

  if (parsed.intent === 'medication_reminder') {
    const isSelf = true;
    const name = isSelf ? (lang === 'english' ? 'you' : null) : recipient?.recipient_name || 'they';
    const medSchedule = recipient?.medication_schedule || [];

    if (medSchedule.length > 0) {
      await updateAccount(account.account_phone, { pending_action: 'awaiting_medication_action', pending_data: { med_schedule: medSchedule } });
      const medList = medSchedule.map((s, i) => `${i + 1}. *${s.name}*`).join('\n');
      const menuHeader = isSelf
        ? { english: 'Your current medicines:', marathi: 'सध्याची औषधे:', hindi: 'आपकी मौजूदा दवाइयाँ:' }[lang]
        : { english: `${name}'s current medicines:`, marathi: `${name} यांची सध्याची औषधे:`, hindi: `${name} की मौजूदा दवाइयाँ:` }[lang];
      return {
        english: `${menuHeader}\n${medList}\n\nWhat would you like to do?\n*add* — Add new medicines\n*replace* — Replace a medicine (doctor changed the drug)\n*update* — Update the schedule of a medicine (e.g., 1x daily → 2x daily)`,
        marathi: `${menuHeader}\n${medList}\n\nकाय करायचे आहे?\n*add* — नवीन औषधे जोडा\n*replace* — औषध बदला (doctor ने वेगळे सांगितले)\n*update* — वेळापत्रक बदला (उदा. दिवसातून 1 वेळ → 2 वेळा)`,
        hindi:   `${menuHeader}\n${medList}\n\nक्या करना है?\n*add* — नई दवाइयाँ जोड़ें\n*replace* — दवाई बदलें (doctor ने दूसरी दी)\n*update* — समय बदलें (जैसे दिन में 1 बार → 2 बार)`,
      }[lang];
    }

    await updateAccount(account.account_phone, { pending_action: 'awaiting_medication_names', pending_data: null });
    return {
      english: `What medications do ${isSelf ? 'you' : name} currently take?`,
      marathi: isSelf ? `तुम्ही सध्या कोणती औषधे घेता?` : `${name} सध्या कोणती औषधे घेतात?`,
      hindi:   isSelf ? `आप अभी कौन सी दवाइयाँ लेते हैं?` : `${name} अभी कौन सी दवाइयाँ लेते हैं?`,
    }[lang];
  }

  if (parsed.intent === 'view_medicines') {
    const medSchedule = recipient?.medication_schedule || [];
    if (medSchedule.length === 0) {
      return {
        english: `You haven't set up any medication reminders yet.\n\nType *medication reminders* to add your medicines.`,
        marathi: `कोणतेही औषध reminders सेट केलेले नाहीत.\n\n*medication reminders* टाइप करा औषधे जोडण्यासाठी.`,
        hindi:   `कोई दवाई reminder सेट नहीं है।\n\n*medication reminders* लिखें दवाइयाँ जोड़ने के लिए।`,
      }[lang];
    }
    const unscheduled = medSchedule.filter(s => !s.frequency || !(s.times || []).length);
    const medList = medSchedule.map((s, i) => {
      if (!s.frequency || !(s.times || []).length) {
        return `${i + 1}. 💊 *${s.name}* — _(reminder not set)_`;
      }
      const times = s.times.map(displayTime).join(', ');
      let durLabel = '';
      if (s.end_date === null) {
        durLabel = ' — ongoing';
      } else if (s.end_date && s.start_date) {
        const remaining = Math.round((new Date(s.end_date) - new Date()) / 86400000);
        durLabel = remaining > 0 ? ` — ${remaining} day${remaining !== 1 ? 's' : ''} left` : ' — course complete';
      }
      return `${i + 1}. 💊 *${s.name}* — ${times} (${s.frequency}x daily${durLabel})`;
    }).join('\n');

    if (unscheduled.length > 0) {
      const names = unscheduled.map(s => `*${s.name}*`).join(' and ');
      await updateAccount(account.account_phone, {
        pending_action: 'awaiting_unscheduled_setup_response',
        pending_data: { unscheduled_names: unscheduled.map(s => s.name) },
      });
      return {
        english: `Your current medicines:\n\n${medList}\n\n${names} don't have a reminder schedule yet. Reply *yes* to set them up now, or *skip*.`,
        marathi: `सध्याची औषधे:\n\n${medList}\n\n${names} साठी reminder अजून सेट केलेले नाही. आत्ता सेट करायचे असल्यास *yes* म्हणा, किंवा *skip*.`,
        hindi:   `आपकी मौजूदा दवाइयाँ:\n\n${medList}\n\n${names} का reminder अभी set नहीं है। अभी set करना हो तो *yes* कहें, या *skip*.`,
      }[lang];
    }

    return {
      english: `Your current medicines:\n\n${medList}\n\nType *medication reminders* to add or update medicines.`,
      marathi: `सध्याची औषधे:\n\n${medList}\n\nऔषधे जोडण्यासाठी किंवा बदलण्यासाठी *medication reminders* टाइप करा.`,
      hindi:   `आपकी मौजूदा दवाइयाँ:\n\n${medList}\n\nदवाइयाँ जोड़ने या बदलने के लिए *medication reminders* लिखें।`,
    }[lang];
  }

  if (parsed.intent === 'show_health_card') {
    if (!recipient) {
      return {
        english: 'I could not find your profile. Please complete onboarding first.',
        marathi: 'तुमचे profile सापडले नाही. कृपया आधी onboarding पूर्ण करा.',
        hindi:   'आपकी profile नहीं मिली। पहले onboarding पूरा करें।',
      }[lang];
    }
    const hasHealthCardData = recipient.blood_group ||
      (recipient.medication_schedule || []).length > 0 ||
      (recipient.allergies || []).length > 0 ||
      (recipient.major_illnesses || []).length > 0 ||
      recipient.medical_history;
    if (!hasHealthCardData) {
      const isSelf15 = true;
      const rName15 = recipient?.recipient_name || 'them';
      await updateAccount(account.account_phone, { pending_action: 'health_card_offer_pending' });
      return {
        english: isSelf15
          ? `You haven't set up your health card yet.\n\nWould you like to set it up now? Reply *Yes* to start or *Skip* to do it later.`
          : `${rName15}'s health card hasn't been set up yet.\n\nWould you like to set it up now? Reply *Yes* to start or *Skip* to do it later.`,
        marathi: isSelf15
          ? `तुमचे health card अजून सेट केलेले नाही.\n\nआत्ता सेट करायचे आहे का? सुरू करण्यासाठी *Yes* म्हणा किंवा नंतर करायचे असल्यास *Skip* म्हणा.`
          : `${rName15} यांचे health card अजून सेट केलेले नाही.\n\nआत्ता सेट करायचे आहे का? सुरू करण्यासाठी *Yes* म्हणा किंवा नंतर करायचे असल्यास *Skip* म्हणा.`,
        hindi: isSelf15
          ? `आपका health card अभी सेट नहीं हुआ है.\n\nअभी सेट करना चाहते हैं? शुरू करने के लिए *Yes* कहें या बाद में करना हो तो *Skip* लिखें.`
          : `${rName15} का health card अभी सेट नहीं हुआ है.\n\nअभी सेट करना चाहते हैं? शुरू करने के लिए *Yes* कहें या बाद में करना हो तो *Skip* लिखें.`,
      }[lang];
    }
    return generateHealthCard(recipient);
  }

  if (parsed.intent === 'setup_health_card') {
    return await startHealthCardSetup(account.account_phone, lang);
  }

  if (parsed.intent === 'update_health_card') {
    const field = parsed.details?.health_card_field;
    const value = parsed.details?.health_card_value;

    if (field && HEALTH_CARD_FIELDS.includes(field) && value) {
      const stateKey = field === 'major_illnesses' ? 'illnesses' : field === 'medical_history' ? 'history' : field;
      await updateAccount(account.account_phone, { pending_action: `health_card_update_${stateKey}` });
      const fakeAccount = { ...account, pending_action: `health_card_update_${stateKey}` };
      return await handleHealthCardUpdate(fakeAccount, value, lang, recipient);
    }

    if (field && HEALTH_CARD_FIELDS.includes(field)) {
      const question = await startHealthCardFieldUpdate(account.account_phone, field, lang);
      if (question) return question;
    }

    const isSelf16 = true;
    const rName16 = recipient?.recipient_name || 'them';
    return {
      english: `Which part of ${isSelf16 ? 'your' : `${rName16}'s`} health card would you like to update?\n\n• Blood group\n• Allergy (add)\n• Illness (add)\n• Surgery (add)\n• Medical history\n\nE.g., type *update blood group* or *add allergy Penicillin*`,
      marathi: `${isSelf16 ? 'तुमच्या' : `${rName16} यांच्या`} health card मध्ये काय update करायचे आहे?\n\n• Blood group\n• Allergy (add)\n• Illness (add)\n• Surgery (add)\n• Medical history\n\nउदा. *blood group update करा* किंवा *allergy add करा Penicillin*`,
      hindi:   `${isSelf16 ? 'आपके' : `${rName16} के`} health card में क्या update करना है?\n\n• Blood group\n• Allergy (add)\n• Illness (add)\n• Surgery (add)\n• Medical history\n\nजैसे *blood group update karo* या *allergy add karo Penicillin*`,
    }[lang];
  }

  if (parsed.intent === 'unknown' && /^(no|nope|no\s?thanks|nahi|nako|nahin|नाही|नको|नहीं|theek\s?hai|thik\s?ahe|ठीक\s?है|ठीक\s?आहे)$/i.test(messageText.trim())) {
    return {
      english: `Got it! Message me anytime for appointments, reminders, emergency or health card.`,
      marathi: `ठीक आहे! appointment, reminder, emergency किंवा health card साठी केव्हाही सांगा.`,
      hindi:   `ठीक है! appointment, reminder, emergency या health card के लिए कभी भी बताएं.`,
    }[lang];
  }

  const REPLIES = {
    sos: {
      english: 'Emergency noted! Alerting your family now.',
      marathi: 'आपत्कालीन परिस्थिती समजली! कुटुंबाला संदेश पाठवत आहोत.',
      hindi:   'आपातकाल समझ गए! परिवार को सूचित कर रहे हैं।',
    },
    default: {
      english: 'What would you like to do?\n• *find doctor* — nearby clinic\n• *medication reminders* — set medicine reminders\n• *my medicines* — view current medicines\n• *health card* — your medical info\n• *help* — emergency',
      marathi: 'काय करायचे आहे?\n• *find doctor* — जवळचे clinic\n• *medication reminders* — औषध reminders\n• *my medicines* — सध्याची औषधे\n• *health card* — वैद्यकीय माहिती\n• *help* — आपत्काल',
      hindi:   'क्या करना है?\n• *find doctor* — नज़दीकी clinic\n• *medication reminders* — दवाई reminders\n• *my medicines* — मौजूदा दवाइयाँ\n• *health card* — medical जानकारी\n• *help* — emergency',
    },
  };

  return (REPLIES[parsed.intent] ?? REPLIES.default)[lang];
}

async function handleConfirmAppointment(messageText, account, lang, recipient) {
  const details = await parseAppointmentDetails(messageText);

  // No time provided — ask before saving or notifying anyone
  if (!details.time_display) {
    await updateAccount(account.account_phone, {
      pending_action: 'awaiting_appointment_time_input',
      pending_data: { selected_clinic: { name: details.clinic_name || 'Doctor' } },
    });
    return {
      english: `Got it! What time is the appointment at *${details.clinic_name || 'the doctor'}*?`,
      marathi: `ठीक आहे! *${details.clinic_name || 'Doctor'}* येथे appointment किती वाजता आहे?`,
      hindi:   `ठीक है! *${details.clinic_name || 'Doctor'}* में appointment कितने बजे है?`,
    }[lang];
  }

  await createAppointment({
    account_phone: account.account_phone,
    recipient_name: recipient.recipient_name,
    clinic_name: details.clinic_name || 'Doctor',
    clinic_phone: null,
    status: 'confirmed',
    appointment_date: details.date_display,
    appointment_time: details.time_display,
    appointment_datetime: details.datetime_iso,
  });

  const isSelf = true;
  const recipientName = recipient?.recipient_name || 'them';
  const toE164Confirm = p => p.startsWith('+') ? p : `+${p.replace(/\D/g, '')}`;
  const familyContacts = (recipient.family_contacts || []).filter(p => toE164Confirm(p) !== account.account_phone);
  if (familyContacts.length > 0) {
    const familyMsg = {
      marathi: `📅 ${recipient.recipient_name} यांची appointment confirm झाली.\n\n🏥 ${details.clinic_name || 'Doctor'}${details.date_display ? '\n📅 ' + details.date_display : ''}\n🕐 ${details.time_display}\n\n— CareProxy`,
      hindi:   `📅 ${recipient.recipient_name} की appointment confirm हो गई।\n\n🏥 ${details.clinic_name || 'Doctor'}${details.date_display ? '\n📅 ' + details.date_display : ''}\n🕐 ${details.time_display}\n\n— CareProxy`,
    }[lang] || `📅 ${recipient.recipient_name} has confirmed a doctor appointment at ${details.clinic_name || 'a clinic'}${details.date_display ? ' on ' + details.date_display : ''} at ${details.time_display}.`;

    await Promise.all(familyContacts.map(p => sendTextMessage(toE164Confirm(p), familyMsg).catch(e => console.error(`Family notify failed to ${p.slice(0, 5)}***:`, e.message))));
  }

  await updateAccount(account.account_phone, { pending_action: 'awaiting_post_appointment', pending_data: { is_prescription: true } });

  const familyNote = familyContacts.length > 0 ? { english: ' Family has been notified.', marathi: ' कुटुंबाला कळवले.', hindi: ' परिवार को बता दिया।' }[lang] : '';
  return {
    english: `✅ Appointment noted at *${details.clinic_name || 'doctor'}*${details.date_display ? ' on ' + details.date_display : ''} at ${details.time_display}.${familyNote} I'll remind ${isSelf ? 'you' : recipientName} 1 hour before. 🔔\n\nAfter the doctor visit, come back to CareProxy and type *prescribed medicines* to set reminders for any new medications.\n\nType *skip* if no prescription given.`,
    marathi: `✅ *${details.clinic_name || 'Doctor'}* येथे${details.date_display ? ' ' + details.date_display + ' ला' : ''} ${details.time_display} ची appointment नोंदवली.${familyNote} 1 तास आधी reminder येईल. 🔔\n\nDoctor ला भेटल्यानंतर CareProxy वर परत या आणि *prescribed medicines* टाइप करा — नवीन औषधांचे reminders सेट करण्यासाठी.\n\nprescription नसल्यास *skip* टाइप करा.`,
    hindi:   `✅ *${details.clinic_name || 'Doctor'}* में${details.date_display ? ' ' + details.date_display + ' को' : ''} ${details.time_display} की appointment दर्ज हुई।${familyNote} 1 घंटे पहले reminder आएगा। 🔔\n\nDoctor से मिलने के बाद CareProxy पर वापस आएं और *prescribed medicines* लिखें — नई दवाइयों के reminders के लिए.\n\nprescription नहीं मिली तो *skip* लिखें।`,
  }[lang];
}

async function handleBookAppointment(parsed, account, lang, recipient) {
  const appointmentType = parsed.details?.appointment_type;
  const isSelf = true;
  const recipientName = recipient?.recipient_name || 'them';

  // No address — can't search
  if (!recipient?.home_address) {
    return {
      english: isSelf
        ? 'I could not find your home address. Please complete your profile setup first.'
        : `I could not find ${recipientName}'s home address. Please complete the profile setup first.`,
      marathi: isSelf
        ? 'तुमचा पत्ता सापडला नाही. कृपया आधी प्रोफाइल सेटअप पूर्ण करा.'
        : `${recipientName} यांचा पत्ता सापडला नाही. कृपया आधी प्रोफाइल सेटअप पूर्ण करा.`,
      hindi: isSelf
        ? 'आपका पता नहीं मिला। पहले प्रोफाइल सेटअप पूर्ण करें।'
        : `${recipientName} का पता नहीं मिला। पहले प्रोफाइल सेटअप पूर्ण करें।`,
    }[lang];
  }

  // Type unclear — ask GP or specialist
  if (!appointmentType || appointmentType === 'null') {
    await updateAccount(account.account_phone, { pending_action: 'appointment_type' });
    return {
      english: `${isSelf ? 'Do you' : `Does ${recipientName}`} need a general check-up at a nearby clinic, or a specialist at a hospital?\n\n1. Nearby clinic (general)\n2. Specialist at hospital\n\nReply 1 or 2`,
      marathi: `${isSelf ? 'तुम्हाला' : `${recipientName} यांना`} जवळच्या क्लिनिकमध्ये सामान्य तपासणी हवी आहे, की हॉस्पिटलमध्ये तज्ज्ञ डॉक्टर?\n\n1. जवळचे क्लिनिक (सामान्य)\n2. हॉस्पिटलमध्ये तज्ज्ञ\n\n1 किंवा 2 reply करा`,
      hindi:   `${isSelf ? 'क्या आपको' : `क्या ${recipientName} को`} नज़दीकी क्लिनिक में सामान्य जांच चाहिए, या अस्पताल में विशेषज्ञ?\n\n1. नज़दीकी क्लिनिक (सामान्य)\n2. अस्पताल में विशेषज्ञ\n\n1 या 2 reply करें`,
    }[lang];
  }

  // Specialist — ask which type
  if (appointmentType === 'specialist' && !parsed.details?.specialty) {
    await updateAccount(account.account_phone, { pending_action: 'specialist_type' });
    return {
      english: `Which type of specialist ${isSelf ? 'do you' : `does ${recipientName}`} need?\n\nFor example: eye, heart, bones, skin, ENT, teeth`,
      marathi: `${isSelf ? 'तुम्हाला' : `${recipientName} यांना`} कोणत्या प्रकारचे तज्ज्ञ डॉक्टर हवे आहेत?\n\nउदाहरण: डोळे, हृदय, हाडे, त्वचा, कान-नाक-घसा, दात`,
      hindi:   `${isSelf ? 'आपको' : `${recipientName} को`} किस प्रकार के विशेषज्ञ डॉक्टर चाहिए?\n\nउदाहरण: आँख, दिल, हड्डी, त्वचा, कान-नाक-गला, दाँत`,
    }[lang];
  }

  // Returning clinic shortcut — if same clinic booked 2+ times
  if (appointmentType === 'gp') {
    const clinicHistory = recipient?.user_insights?.clinic_history || [];
    const returningClinic = clinicHistory.find(c => c.count >= 2);
    if (returningClinic) {
      await updateAccount(account.account_phone, {
        pending_action: 'returning_clinic_choice',
        pending_data: { returning_clinic: returningClinic },
      });
      return {
        english: `${isSelf ? 'You have' : `${recipientName} has`} visited *${returningClinic.name}* before.\nWould you like to go there again?\n\n1. Yes, ${returningClinic.name}\n2. No, find a different clinic\n\nReply 1 or 2`,
        marathi: isSelf
          ? `पूर्वी *${returningClinic.name}* येथे गेला होतात.\nपुन्हा तेथेच जायचे आहे का?\n\n1. हो, ${returningClinic.name}\n2. नाही, नवीन clinic शोधा\n\n1 किंवा 2 reply करा`
          : `${recipientName} पूर्वी *${returningClinic.name}* येथे गेले होते.\nपुन्हा तेथेच जायचे आहे का?\n\n1. हो, ${returningClinic.name}\n2. नाही, नवीन clinic शोधा\n\n1 किंवा 2 reply करा`,
        hindi: isSelf
          ? `पहले *${returningClinic.name}* में गए थे।\nवहीं जाना है?\n\n1. हाँ, ${returningClinic.name}\n2. नहीं, नई clinic खोजें\n\n1 या 2 reply करें`
          : `${recipientName} पहले *${returningClinic.name}* में गए थे।\nवहीं जाना है?\n\n1. हाँ, ${returningClinic.name}\n2. नहीं, नई clinic खोजें\n\n1 या 2 reply करें`,
      }[lang];
    }
  }

  // GP with saved doctor — offer choice
  const savedDoctors = recipient.saved_doctors || [];
  const hasValidSavedDoctor = savedDoctors.length > 0 && savedDoctors[0]?.info &&
    !/^\d+$/.test(savedDoctors[0].info.replace(/\s/g, ''));

  if (hasValidSavedDoctor && appointmentType === 'gp') {
    await updateAccount(account.account_phone, { pending_action: 'saved_doctor_choice' });
    const doctor = savedDoctors[0];
    return {
      english: `Do you want to book at ${isSelf ? 'your' : `${recipientName}'s`} saved doctor (${doctor.info}), or find a nearby clinic?\n\n1. ${isSelf ? 'My' : `${recipientName}'s`} saved doctor\n2. Find nearby clinic\n\nReply 1 or 2`,
      marathi: `${isSelf ? 'तुमच्या' : `${recipientName} यांच्या`} नेहमीच्या डॉक्टरकडे (${doctor.info}) appointment बुक करायची आहे, की जवळचे क्लिनिक शोधायचे?\n\n1. ${isSelf ? 'माझे' : `${recipientName} यांचे`} नेहमीचे डॉक्टर\n2. जवळचे क्लिनिक शोधा\n\n1 किंवा 2 reply करा`,
      hindi:   `${isSelf ? 'आप अपने' : `${recipientName} के`} पुराने डॉक्टर (${doctor.info}) के यहाँ appointment बुक करना चाहते हैं, या नज़दीकी क्लिनिक खोजें?\n\n1. ${isSelf ? 'मेरे' : `${recipientName} के`} पुराने डॉक्टर\n2. नज़दीकी क्लिनिक खोजें\n\n1 या 2 reply करें`,
    }[lang];
  }

  // Search clinics directly
  const specialty = appointmentType === 'specialist' ? parsed.details?.specialty : null;
  return await searchAndFormatClinics(recipient, specialty, lang, isSelf);
}

async function searchAndFormatClinics(recipient, specialty, lang, isSelf = true) {
  let clinics, nextPageToken;
  try {
    ({ clinics, nextPageToken } = await findNearbyClinics(recipient.home_address, specialty));
  } catch (e) {
    console.error('[Maps API error]', e.message);
    return {
      english: 'Sorry, I am having trouble finding clinics right now. Please try again in a few minutes.',
      marathi: 'माफ करा, सध्या clinic शोधणे शक्य होत नाही. काही मिनिटांनी पुन्हा प्रयत्न करा.',
      hindi:   'माफ़ करें, अभी clinic खोजना संभव नहीं है। कुछ मिनट बाद फिर कोशिश करें।',
    }[lang];
  }

  if (!clinics.length) {
    return {
      english: `Sorry, I could not find any clinics near ${isSelf ? 'your' : `${recipient?.recipient_name || 'the saved'}`} address. Please try again.`,
      marathi: `माफ करा, ${isSelf ? 'तुमच्या' : `${recipient?.recipient_name || 'नोंदवलेल्या'} यांच्या`} पत्त्याजवळ क्लिनिक सापडले नाही. कृपया पुन्हा प्रयत्न करा.`,
      hindi:   `माफ़ करें, ${isSelf ? 'आपके' : `${recipient?.recipient_name || 'दर्ज'} के`} पते के पास कोई क्लिनिक नहीं मिला। कृपया फिर से प्रयास करें।`,
    }[lang];
  }

  await updateAccount(recipient.account_phone, {
    pending_data: {
      clinics,
      next_page_token: nextPageToken || null,
    },
  });

  return formatClinicList(clinics, specialty, lang, !!nextPageToken, isSelf, recipient?.recipient_name || '');
}

function formatClinicList(clinics, specialty, lang, hasMore, isSelf = true, recipientName = '') {
  const header = {
    english: `Here are the nearest ${specialty ? specialty + ' hospitals' : 'clinics'} near ${isSelf ? 'you' : `${recipientName}'s home`}:\n\n`,
    marathi: `${isSelf ? 'तुमच्या' : `${recipientName} यांच्या`} जवळचे ${specialty ? specialty + ' हॉस्पिटल' : 'क्लिनिक'}:\n\n`,
    hindi:   `${isSelf ? 'आपके' : `${recipientName} के`} पास के ${specialty ? specialty + ' अस्पताल' : 'क्लिनिक'}:\n\n`,
  }[lang];

  const list = clinics.map((c, i) => {
    const rating = c.rating ? ` ⭐ ${c.rating}` : '';
    const reviews = c.reviews ? ` (${c.reviews} reviews)` : '';
    const phone = c.phone ? `\n📞 ${c.phone}` : '';
    return `${i + 1}. *${c.name}*${rating}${reviews}\n${c.address}${phone}`;
  }).join('\n\n');

  const footer = {
    english: `\n\nSelect a number 1–5 to get clinic details and book. Type *more* for more options.\nNeed a specialist? Just say — e.g. "eye doctor" or "heart doctor"`,
    marathi: `\n\nClinic details आणि booking साठी 1–5 नंबर निवडा. *more* टाइप करा अजून पर्यायांसाठी.\nतज्ज्ञ डॉक्टर हवे? सांगा — उदा. "डोळ्यांचे डॉक्टर"`,
    hindi:   `\n\nClinic details और booking के लिए 1–5 नंबर चुनें। *more* लिखें और options के लिए।\nविशेषज्ञ चाहिए? बताएं — जैसे "आँख का डॉक्टर"`,
  }[lang];

  const noMore = {
    english: `\n\nSelect a number 1–5 to get clinic details and book.\nNeed a specialist? Just say — e.g. "eye doctor" or "heart doctor"`,
    marathi: `\n\nClinic details आणि booking साठी 1–5 नंबर निवडा.\nतज्ज्ञ डॉक्टर हवे? सांगा — उदा. "डोळ्यांचे डॉक्टर"`,
    hindi:   `\n\nClinic details और booking के लिए 1–5 नंबर चुनें।\nविशेषज्ञ चाहिए? बताएं — जैसे "आँख का डॉक्टर"`,
  }[lang];

  return header + list + (hasMore ? footer : noMore);
}

// ─── SOS ─────────────────────────────────────────────────────────────────────

function isSOS(text) {
  return /\b(help|emergenc(y|ies)|sos|madad|bachao|bachav|मदत|आपत्काल|मदद|बचाओ)\b/i.test(text.trim());
}

async function handleSOS(account, lang, recipient) {
  const isSelf = true;
  const name = recipient?.recipient_name || 'Your family member';
  const address = recipient?.home_address || 'their home';
  const toE164 = p => p.startsWith('+') ? p : `+${p.replace(/\D/g, '')}`;
  const familyContacts = [...new Set(
    (recipient?.family_contacts || [])
      .filter(p => toE164(p) !== account.account_phone)
      .map(toE164)
  )];

  const hasHealthCard = !!(
    recipient?.blood_group ||
    (Array.isArray(recipient?.allergies) && recipient.allergies.length > 0) ||
    (Array.isArray(recipient?.major_illnesses) && recipient.major_illnesses.length > 0) ||
    (Array.isArray(recipient?.surgeries) && recipient.surgeries.length > 0) ||
    recipient?.medical_history
  );

  const recipientPhone = recipient?.recipient_phone ? toE164(recipient.recipient_phone) : null;

  if (familyContacts.length > 0) {
    const callLine = recipientPhone
      ? (lang === 'hindi' ? `📞 उन्हें अभी call करें: ${recipientPhone}` : `📞 आत्ता call करा: ${recipientPhone}`)
      : (lang === 'hindi' ? `📞 उन्हें अभी call करें।` : `📞 आत्ता call करा.`);
    const alertMsg = lang === 'hindi'
      ? `🆘 *${name}* को मदद चाहिए!\n\n${callLine}\n\n— CareProxy`
      : `🆘 *${name}* यांना मदत हवी आहे!\n\n${callLine}\n\n— CareProxy`;

    const ambulanceMsg = lang === 'hindi'
      ? `🚑 एम्बुलेंस नंबर:\n\n• सरकारी एम्बुलेंस: tel:108\n• पुलिस + आपातकाल: tel:112`
      : `🚑 Ambulance नंबर:\n\n• सरकारी Ambulance: tel:108\n• पोलीस + आपत्काल: tel:112`;

    await Promise.all(familyContacts.flatMap(p => [
      sendTextMessage(p, alertMsg).catch(e => console.error(`SOS alert failed to ${p.slice(0, 5)}***:`, e.message)),
      sendTextMessage(p, ambulanceMsg).catch(e => console.error(`SOS ambulance failed to ${p.slice(0, 5)}***:`, e.message)),
    ]));

    if (hasHealthCard) {
      const healthCard = generateHealthCard(recipient);
      await Promise.all(familyContacts.map(p =>
        sendTextMessage(p, healthCard).catch(e => console.error(`SOS health card failed to ${p.slice(0, 5)}***:`, e.message))
      ));
    }
  }

  const cardNote = !hasHealthCard ? {
    english: '\n\nNote: Health card is not set up yet. Type *health card* to set it up.',
    marathi: '\n\nटीप: Health card अजून सेट केलेले नाही. सेट करण्यासाठी *health card* टाइप करा.',
    hindi:   '\n\nनोट: Health card अभी सेट नहीं है। सेट करने के लिए *health card* लिखें.',
  }[lang] : '';

  const familyAlerted = familyContacts.length > 0
    ? { english: 'Family has been alerted.', marathi: 'कुटुंबाला कळवले.', hindi: 'परिवार को सूचित किया।' }[lang]
    : '';

  return {
    english: `🆘 Emergency helplines:\n\n• Ambulance: tel:108\n• Police & Emergency: tel:112\n\n${familyAlerted}${cardNote}`,
    marathi: `🆘 आपत्कालीन helplines:\n\n• Ambulance: tel:108\n• पोलीस आणि आपत्काल: tel:112\n\n${familyAlerted}${cardNote}`,
    hindi:   `🆘 आपातकालीन helplines:\n\n• Ambulance: tel:108\n• पुलिस और आपातकाल: tel:112\n\n${familyAlerted}${cardNote}`,
  }[lang];
}

// ─── Medication helpers ───────────────────────────────────────────────────────

function isMedicationAck(text) {
  const t = text.trim();
  if (/^👍[\u{1F3FB}-\u{1F3FF}]?$/u.test(t)) return true;
  return /^(done|taken|yes|हो|ha|घेतलं|ghetal|le liya|ले लिया|ok|okay|हाँ|haan|लिया|घेतले)$/i.test(t);
}

async function handleMedicationAck(account, lang) {
  const acked = await acknowledgeMedicationLog(account.account_phone);
  if (!acked) return null;
  return {
    english: '✅ Noted, medicines taken!',
    marathi: '✅ नोंद झाली, औषधे घेतली!',
    hindi:   '✅ दर्ज हो गया, दवाई ले ली!',
  }[lang];
}

function displayTime(hhmm) {
  const [h, m] = hhmm.split(':').map(Number);
  const period = h < 12 ? 'AM' : 'PM';
  const displayH = h % 12 || 12;
  return `${displayH}${m ? ':' + String(m).padStart(2, '0') : ''}${period}`;
}

function parseTimeInput(text, frequency) {
  const cleaned = text.replace(/सकाळी|दुपारी|संध्याकाळी|रात्री|subah|dopahar|raat|sandhya|वाजता|बजे/gi, ' ').trim();
  const matches = [];
  const re = /(\d{1,2})(?::(\d{2}))?\s*(am|pm)?/gi;
  let m;
  while ((m = re.exec(cleaned)) !== null) {
    let h = parseInt(m[1]);
    const min = m[2] ? parseInt(m[2]) : 0;
    const period = m[3]?.toLowerCase();
    if (period === 'pm' && h < 12) h += 12;
    else if (period === 'am' && h === 12) h = 0;
    else if (!period && h >= 1 && h <= 6) h += 12; // 1–6 without AM/PM → PM
    if (h >= 0 && h <= 23) matches.push(`${String(h).padStart(2, '0')}:${String(min).padStart(2, '0')}`);
  }
  return [...new Set(matches)].slice(0, frequency);
}

function parseDuration(text) {
  const t = text.trim().toLowerCase();
  if (/^(lifetime|always|ongoing|forever|हमेशा|आजीवन|कायमचे|जीवनभर|सदा)$/i.test(t)) return null;
  const weeks = t.match(/(\d+)\s*(week|आठवड|हफ्त|hafta)/i);
  if (weeks) return parseInt(weeks[1]) * 7;
  const months = t.match(/(\d+)\s*(month|महिन|mahina|महीन)/i);
  if (months) return parseInt(months[1]) * 30;
  const days = t.match(/(\d+)\s*(day|din|दिन|दिवस|divas)/i);
  if (days) return parseInt(days[1]);
  const num = t.match(/^\d+$/);
  if (num) return parseInt(num[0]);
  return -1;
}

function addDays(dateStr, days) {
  const d = new Date(dateStr);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

// ─── Subscription helpers ─────────────────────────────────────────────────────

function getSubscriptionStatus(account) {
  if (account.subscription_status === 'active') return 'active';
  const trialStart = new Date(account.created_at);
  if (isNaN(trialStart.getTime())) return 'trial';
  const trialEnd = new Date(trialStart);
  trialEnd.setDate(trialEnd.getDate() + 7);
  return new Date() < trialEnd ? 'trial' : 'expired';
}

async function sendTrialStartedMessage(phone) {
  try {
    const account = await getOrCreateAccount(phone);
    if (account.razorpay_subscription_id) return;
    const { id, paymentUrl } = await createSubscription(phone);
    await updateAccount(phone, { razorpay_subscription_id: id });
    const msg = `🎉 Your 7-day free trial has started!\n\nAfter your trial, subscribe for ₹499/month to keep using CareProxy:\n\n${paymentUrl}\n\n_No action needed right now. Enjoy your trial!_`;
    await sendTextMessage(phone, msg);
    await saveMessage(phone, 'assistant', msg);
  } catch (e) {
    console.error('Failed to send trial started message:', e.message);
  }
}

async function getExpiredReply(account, lang) {
  let paymentUrl = '';
  try {
    if (account.razorpay_subscription_id) {
      paymentUrl = await getPaymentLink(account.razorpay_subscription_id);
    } else {
      const result = await createSubscription(account.account_phone);
      await updateAccount(account.account_phone, { razorpay_subscription_id: result.id });
      paymentUrl = result.paymentUrl;
    }
  } catch (e) {
    console.error('Failed to get payment link for expired user:', e.message);
  }
  const linkLine = paymentUrl ? `\n\n${paymentUrl}` : '';
  return {
    english: `Your 7-day free trial has ended.\n\n⚠️ Only emergency help (*help* anytime) remains active.\n\nSubscribe for ₹499/month to restore clinic search, medication reminders, and family alerts:${linkLine}`,
    marathi: `तुमचा ७ दिवसांचा free trial संपला.\n\n⚠️ फक्त emergency help (*help* टाइप करा) सुरू आहे.\n\nClinic search, औषध reminders आणि family alerts परत सुरू करण्यासाठी ₹499/महिना subscribe करा:${linkLine}`,
    hindi:   `आपका ७ दिन का free trial खत्म हो गया।\n\n⚠️ केवल emergency help (*help* लिखें) अभी भी active है।\n\n₹499/महीना subscribe करके clinic search, दवाई reminders और family alerts वापस पाएं:${linkLine}`,
  }[lang];
}

export default router;

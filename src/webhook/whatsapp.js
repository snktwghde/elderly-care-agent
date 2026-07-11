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
  'health_card_allergies',
  'health_card_illnesses',
  'health_card_surgeries',
  'health_card_history',
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
        await sendHealthCardOffer(senderPhone, offerLang).catch(e =>
          console.error('[Health card offer failed]', e.message)
        );
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
              english: 'Let me know if you need help with appointments, medication reminders, or emergencies.',
              marathi: 'काही लागलं तर सांगा — appointment, औषध reminder किंवा आपत्काल.',
              hindi:   'कुछ चाहिए तो बताएं — appointment, दवाई reminder या आपातकाल।',
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

  // Numeric-reply states: break out on broader command keywords
  const numericStates = ['returning_clinic_choice', 'appointment_type', 'saved_doctor_choice', 'medication_conflict'];
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
      english: `📍 *${clinic.name}*\n\n${clinic.address}\n\nNo phone number listed. Did you:\n\n1. Visit the doctor today (walk-in)\n2. Plan to visit later\n\nReply 1 or 2`,
      marathi: `📍 *${clinic.name}*\n\n${clinic.address}\n\nफोन नंबर उपलब्ध नाही. तुम्ही:\n\n1. आज Doctor ला भेटलात (walk-in)\n2. नंतर जाण्याचा विचार आहे\n\n1 किंवा 2 reply करा`,
      hindi:   `📍 *${clinic.name}*\n\n${clinic.address}\n\nफ़ोन नंबर उपलब्ध नहीं। क्या आपने:\n\n1. आज Doctor से मिले (walk-in)\n2. बाद में जाने का plan है\n\n1 या 2 reply करें`,
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
    english: `📞 *${clinic.name}*\n\n${clinic.phone}\n\n📍 ${clinic.address}\n\nCall to book your appointment. Once done, reply *Yes* to confirm.\nVisited today instead? Reply *Walk-in*.\nNeed more options? Type *more*.`,
    marathi: `📞 *${clinic.name}*\n\n${clinic.phone}\n\n📍 ${clinic.address}\n\nAppointment साठी call करा. झाल्यावर *हो* म्हणा.\nआज भेटलात? *Walk-in* म्हणा.\nआणखी पर्याय? *more* टाइप करा.`,
    hindi:   `📞 *${clinic.name}*\n\n${clinic.phone}\n\n📍 ${clinic.address}\n\nAppointment के लिए call करें। हो जाने पर *हाँ* कहें।\nआज मिले? *Walk-in* कहें।\nAur options? *more* लिखें।`,
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

  return formatClinicList(clinics, null, lang, !!nextPageToken);
}

// ─── Appointment save + medication handoff ────────────────────────────────────

async function confirmAndSaveAppointment({ account, account_phone, recipient, lang, clinic, appointmentTime, dateDisplay, datetimeIso }) {
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

  const familyContacts = recipient.family_contacts || [];
  if (familyContacts.length > 0) {
    const familyMsg = lang === 'hindi'
      ? `📅 ${recipient.recipient_name} की appointment confirm हो गई.\n\n🏥 ${clinic.name || 'Doctor'}\n🕐 ${appointmentTime}${dateDisplay ? '\n📅 ' + dateDisplay : ''}\n\n— CareProxy`
      : `📅 ${recipient.recipient_name} यांची appointment confirm झाली.\n\n🏥 ${clinic.name || 'Doctor'}\n🕐 ${appointmentTime}${dateDisplay ? '\n📅 ' + dateDisplay : ''}\n\n— CareProxy`;
    const toE164 = p => p.startsWith('+') ? p : `+${p.replace(/\D/g, '')}`;
    await Promise.all(familyContacts.map(p => sendTextMessage(toE164(p), familyMsg)));
  }

  await updateAccount(account_phone, {
    pending_action: 'awaiting_medication_names',
    pending_data: account.pending_data?.next_page_token
      ? { next_page_token: account.pending_data.next_page_token }
      : null,
  });

  if (clinic.name) updateClinicInsight(account_phone, clinic).catch(() => {});

  const dateStr = dateDisplay ? `\n📅 ${dateDisplay}` : '';
  return {
    english: `✅ Appointment confirmed at *${clinic.name || 'doctor'}*!\n🕐 ${appointmentTime}${dateStr}${familyContacts.length > 0 ? '\nYour family has been notified. 👨‍👩‍👧' : ''} I'll remind you 1 hour before. 🔔\n\nDid the doctor prescribe any new medications? Tell me the names and I'll set reminders.\n\nOr type *skip* if none.`,
    marathi: `✅ *${clinic.name || 'Doctor'}* येथे appointment नोंदवली!\n🕐 ${appointmentTime}${dateStr}${familyContacts.length > 0 ? '\nकुटुंबाला कळवले. 👨‍👩‍👧' : ''} 1 तास आधी reminder येईल. 🔔\n\nDoctor ने नवीन औषधे दिली का? नावे सांगा, मी reminders सेट करतो.\n\nनसल्यास *skip* टाइप करा.`,
    hindi:   `✅ *${clinic.name || 'Doctor'}* में appointment दर्ज हो गई!\n🕐 ${appointmentTime}${dateStr}${familyContacts.length > 0 ? '\nपरिवार को बता दिया। 👨‍👩‍👧' : ''} 1 घंटे पहले reminder आएगा। 🔔\n\nDoctor ने कोई नई दवाइयाँ दी हैं? नाम बताएं, मैं reminders सेट कर दूंगा।\n\nनहीं दी तो *skip* लिखें।`,
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
      const familyContacts = recipient?.family_contacts || [];
      if (familyContacts.length > 0) {
        const name = recipient.recipient_name;
        const familyMsg = lang === 'hindi'
          ? `🏥 ${name} ने आज ${clinicName} में doctor से मिले। उनसे पूछें visit कैसी रही। — CareProxy`
          : `🏥 ${name} आज ${clinicName} मध्ये doctor ला भेटले. त्यांना विचारा visit कशी गेली. — CareProxy`;
        await Promise.all(familyContacts.map(p => sendTextMessage(toE164(p), familyMsg).catch(e => console.error(`Family notify failed to ${p.slice(0, 5)}***:`, e.message))));
      }
      await updateAccount(account_phone, { pending_action: 'awaiting_medication_names', pending_data: null });

      return {
        english: `Got it! Glad they saw the doctor. 😊\n\nDid the doctor prescribe any new medications? Tell me the names and I'll set reminders.\n\nOr type *skip* if none.`,
        marathi: `ठीक आहे! Doctor ला भेटले, छान! 😊\n\nDoctor ने नवीन औषधे दिली का? नावे सांगा, मी reminders सेट करतो.\n\nनसल्यास *skip* टाइप करा.`,
        hindi:   `ठीक है! Doctor से मिले, अच्छा हुआ। 😊\n\nDoctor ने कोई नई दवाइयाँ दी हैं? नाम बताएं, मैं reminders सेट कर दूंगा।\n\nनहीं दी तो *skip* लिखें।`,
      }[lang];
    }

    if (choice === '2') {
      await updateAccount(account_phone, {
        pending_action: 'awaiting_appointment_time_input',
        pending_data: { selected_clinic: clinic },
      });
      return {
        english: `Got it! What time is the appointment at *${clinicName}*?`,
        marathi: `ठीक आहे! *${clinicName}* येथे appointment कधी आहे?`,
        hindi:   `ठीक है! *${clinicName}* में appointment कितने बजे है?`,
      }[lang];
    }

    return {
      english: `Please reply *1* if you met the doctor today, or *2* if you booked an appointment for later.`,
      marathi: `कृपया *1* म्हणा जर आज Doctor ला भेटलात, किंवा *2* जर नंतरसाठी appointment book केली.`,
      hindi:   `कृपया *1* लिखें अगर आज Doctor से मिले, या *2* अगर बाद की appointment book की।`,
    }[lang];
  }

  if (pending_action === 'awaiting_booking_confirmation') {
    const isYes    = /^(yes|हो|ho|haan|हाँ|ha|हा|ok|okay|confirmed|done|zali|झाली|book zali)$/i.test(choice);
    const isNo     = /^(no|nahi|नाही|नहीं|cancel)$/i.test(choice);
    const isWalkIn = /^(walk.?in|walkin|walk in|came|visited|आज|आलो|आले|भेटलो|भेटले|मिले|आया)$/i.test(choice);

    if (isWalkIn) {
      updateAffirmativePattern(account_phone, choice).catch(() => {});
      const clinic = account.pending_data?.selected_clinic;
      const toE164 = p => p.startsWith('+') ? p : `+${p.replace(/\D/g, '')}`;
      const familyContacts = recipient?.family_contacts || [];
      if (familyContacts.length > 0) {
        const familyMsg = lang === 'hindi'
          ? `🏥 ${recipient.recipient_name} ने आज *${clinic?.name || 'doctor'}* में doctor से मिले। — CareProxy`
          : `🏥 ${recipient.recipient_name} आज *${clinic?.name || 'doctor'}* मध्ये doctor ला भेटले. — CareProxy`;
        await Promise.all(familyContacts.map(p => sendTextMessage(toE164(p), familyMsg).catch(() => {})));
      }
      await updateAccount(account_phone, { pending_action: null, pending_data: null });
      return {
        english: `Got it! Glad they saw the doctor.\n\nIf the doctor prescribed new medicines, type *set medication reminders* to set reminders.`,
        marathi: `ठीक आहे! Doctor ला भेटले, छान!\n\nDoctor ने नवीन औषधे दिली असल्यास, *set medication reminders* टाइप करा.`,
        hindi:   `ठीक है! Doctor से मिले, अच्छा हुआ।\n\nDoctor ने नई दवाइयाँ दी हों तो *set medication reminders* लिखें।`,
      }[lang];
    }

    if (isNo) {
      updateNegativePattern(account_phone, choice).catch(() => {});
      await updateAccount(account_phone, { pending_action: null, pending_data: null });
      return {
        english: 'No problem. Let me know if you need anything else.',
        marathi: 'ठीक आहे. काही लागलं तर सांगा.',
        hindi:   'कोई बात नहीं। कुछ चाहिए तो बताएं।',
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
      return await searchAndFormatClinics(recipient, null, lang);
    }
    if (choice === '2') {
      await updateAccount(account_phone, { pending_action: 'specialist_type' });
      return {
        english: 'Which type of specialist do you need?\n\nFor example: eye, heart, bones, skin, ENT, teeth',
        marathi: 'कोणत्या प्रकारचे तज्ज्ञ डॉक्टर हवे आहेत?\n\nउदाहरण: डोळे, हृदय, हाडे, त्वचा, कान-नाक-घसा, दात',
        hindi:   'किस प्रकार के विशेषज्ञ डॉक्टर चाहिए?\n\nउदाहरण: आँख, दिल, हड्डी, त्वचा, कान-नाक-गला, दाँत',
      }[lang];
    }
  }

  if (pending_action === 'saved_doctor_choice') {
    if (choice === '1') {
      await updateAccount(account_phone, { pending_action: null });
      const doctor = recipient?.saved_doctors?.[0];
      return {
        english: `Calling ${doctor?.info || 'your saved doctor'} to book your appointment. (Coming in Phase 4)`,
        marathi: `${doctor?.info || 'तुमच्या नेहमीच्या डॉक्टर'}कडे appointment बुक करण्यासाठी call करत आहोत. (लवकरच येणार)`,
        hindi:   `${doctor?.info || 'आपके डॉक्टर'} को appointment बुक करने के लिए call कर रहे हैं. (जल्द आएगा)`,
      }[lang];
    }
    if (choice === '2') {
      await updateAccount(account_phone, { pending_action: null });
      return await searchAndFormatClinics(recipient, null, lang);
    }
  }

  if (pending_action === 'specialist_type') {
    await updateAccount(account_phone, { pending_action: null });
    return await searchAndFormatClinics(recipient, messageText.trim(), lang);
  }

  if (pending_action === 'awaiting_medication_names') {
    if (/^(skip|नको|नहीं|no thanks|nope|later|ok|okay|done|fine|alright|theek|thik)$/i.test(messageText.trim())) {
      await updateAccount(account_phone, { pending_action: null, pending_data: null });
      return {
        english: 'Okay! Message me anytime for appointments, medication reminders, or emergencies.',
        marathi: 'ठीक आहे! appointments, औषध reminders किंवा emergency साठी कधीही message करा.',
        hindi:   'ठीक है! appointments, दवाई reminders, या emergency के लिए कभी भी message करें।',
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
        english: `You're already taking *${conflictPair.oldMed}*. Has the doctor asked you to stop it and take *${conflictPair.newMed}* instead?\n\n1. Yes, stop ${conflictPair.oldMed}\n2. No, take both\n\nReply 1 or 2`,
        marathi: `तुम्ही आधीच *${conflictPair.oldMed}* घेत आहात. Doctor नी ती बंद करून *${conflictPair.newMed}* घ्यायला सांगितली का?\n\n1. हो, ${conflictPair.oldMed} बंद करा\n2. नाही, दोन्ही घ्यायच्या\n\n1 किंवा 2 reply करा`,
        hindi:   `आप पहले से *${conflictPair.oldMed}* ले रहे हैं। क्या Doctor ने इसे बंद करके *${conflictPair.newMed}* लेने को कहा?\n\n1. हाँ, ${conflictPair.oldMed} बंद करें\n2. नहीं, दोनों लेनी हैं\n\n1 या 2 reply करें`,
      }[lang];
    }

    await updateAccount(account_phone, {
      pending_action: 'awaiting_medication_frequency',
      pending_data: { medicines, current_index: 0, collected_schedules: [] },
    });
    const isSelf = account.account_type === 'self';
    return {
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
    return {
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
    const times = parseTimeInput(messageText, freq);

    if (times.length === 0) {
      return {
        english: `Couldn't understand the time. Please send like: ${freq === 1 ? '8am' : freq === 2 ? '8am and 9pm' : '8am, 1pm and 9pm'}`,
        marathi: `वेळ समजली नाही. उदा: ${freq === 1 ? 'सकाळी 8' : freq === 2 ? 'सकाळी 8 आणि रात्री 9' : 'सकाळी 8, दुपारी 1 आणि रात्री 9'}`,
        hindi:   `समय समझ नहीं आया। जैसे: ${freq === 1 ? '8am' : freq === 2 ? '8am और 9pm' : '8am, 1pm और 9pm'}`,
      }[lang];
    }

    const updatedSchedules = [...collected_schedules, { name: currentMedicine, frequency: freq, times }];
    const nextIndex = current_index + 1;

    // More medicines to collect
    if (nextIndex < medicines.length) {
      await updateAccount(account_phone, {
        pending_action: 'awaiting_medication_frequency',
        pending_data: { medicines, current_index: nextIndex, collected_schedules: updatedSchedules },
      });
      return {
        english: `Got it! Now, how many times a day do you take *${medicines[nextIndex]}*?`,
        marathi: `ठीक आहे! आता, *${medicines[nextIndex]}* दिवसातून किती वेळा घेता?`,
        hindi:   `ठीक है! अब, *${medicines[nextIndex]}* दिन में कितनी बार लेते हैं?`,
      }[lang];
    }

    // All medicines collected — merge with existing schedule (don't overwrite)
    const existingRecipient = await getPrimaryCareRecipient(account_phone);
    const existingSchedule = existingRecipient?.medication_schedule || [];
    const newNames = new Set(updatedSchedules.map(s => s.name.toLowerCase()));
    const merged = [
      ...existingSchedule.filter(s => !newNames.has(s.name.toLowerCase())),
      ...updatedSchedules,
    ];
    await updateCareRecipient(account_phone, { medication_schedule: merged });
    await updateAccount(account_phone, { pending_action: null, pending_data: null });
    updateMedicationInsight(account_phone, merged).catch(() => {});

    const familyContacts = recipient?.family_contacts || [];
    if (familyContacts.length > 0) {
      const summary = updatedSchedules.map(s =>
        `• ${s.name}: ${s.times.map(displayTime).join(', ')} (${s.frequency}x daily)`
      ).join('\n');
      const familyMsg = lang === 'hindi'
        ? `💊 ${recipient.recipient_name} की दवाइयों के reminders सेट हो गए।\n\n${summary}\n\n— CareProxy`
        : `💊 ${recipient.recipient_name} यांच्या औषधांचे reminders सेट झाले.\n\n${summary}\n\n— CareProxy`;
      const toE164 = p => p.startsWith('+') ? p : `+${p.replace(/\D/g, '')}`;
      await Promise.all(familyContacts.map(p => sendTextMessage(toE164(p), familyMsg).catch(e => console.error(`Send failed to ${p}:`, e.message))));
    }

    const confirmSummary = updatedSchedules.map(s =>
      `💊 *${s.name}* — ${s.times.map(displayTime).join(', ')}`
    ).join('\n');

    const closingMsg = {
      english: `\n\nAll set! Message me anytime for appointments, medication reminders, or emergencies.`,
      marathi: `\n\nसर्व तयार! कधीही appointment, औषध reminder किंवा आपत्काल — फक्त message करा.`,
      hindi:   `\n\nसब तैयार है! कभी भी appointment, दवाई reminder या आपातकाल के लिए message करें।`,
    }[lang];

    return {
      english: `✅ All reminders set!\n\n${confirmSummary}${familyContacts.length > 0 ? '\n\nFamily has been informed of the medication list.' : ''}${closingMsg}`,
      marathi: `✅ सर्व reminders सेट झाले!\n\n${confirmSummary}${familyContacts.length > 0 ? '\n\nकुटुंबाला औषधांची यादी कळवली.' : ''}${closingMsg}`,
      hindi:   `✅ सभी reminders सेट हो गए!\n\n${confirmSummary}${familyContacts.length > 0 ? '\n\nपरिवार को दवाइयों की सूची भेज दी।' : ''}${closingMsg}`,
    }[lang];
  }

  if (pending_action === 'returning_clinic_choice') {
    const returningClinic = account.pending_data?.returning_clinic;

    if (choice === '1') {
      if (!returningClinic?.phone) {
        await updateAccount(account_phone, { pending_action: null, pending_data: null });
        return await searchAndFormatClinics(recipient, null, lang);
      }
      if (returningClinic.name) updateClinicInsight(account_phone, returningClinic).catch(() => {});
      await updateAccount(account_phone, {
        pending_action: 'awaiting_booking_confirmation',
        pending_data: { selected_clinic: returningClinic },
      });
      return {
        english: `📞 *${returningClinic.name}*\n\n${returningClinic.phone}\n\n📍 ${returningClinic.address}\n\nCall to book your appointment. Once done, reply *Yes* to confirm.\nVisited today instead? Reply *Walk-in*.`,
        marathi: `📞 *${returningClinic.name}*\n\n${returningClinic.phone}\n\n📍 ${returningClinic.address}\n\nAppointment साठी call करा. झाल्यावर *हो* म्हणा.\nआज भेटलात? *Walk-in* म्हणा.`,
        hindi:   `📞 *${returningClinic.name}*\n\n${returningClinic.phone}\n\n📍 ${returningClinic.address}\n\nAppointment के लिए call करें। हो जाने पर *हाँ* कहें।\nआज मिले? *Walk-in* कहें।`,
      }[lang];
    }

    await updateAccount(account_phone, { pending_action: null, pending_data: null });
    return await searchAndFormatClinics(recipient, null, lang);
  }

  if (pending_action === 'medication_conflict') {
    const { conflict_old, conflict_new, medicines, current_index, collected_schedules } = account.pending_data;

    if (choice !== '1' && choice !== '2') {
      return {
        english: `Please reply with 1 or 2.`,
        marathi: `कृपया 1 किंवा 2 reply करा.`,
        hindi:   `कृपया 1 या 2 reply करें।`,
      }[lang];
    }

    if (choice === '1') {
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
    }

    await updateAccount(account_phone, {
      pending_action: 'awaiting_medication_frequency',
      pending_data: { medicines, current_index, collected_schedules },
    });
    const isSelf = account.account_type === 'self';
    return choice === '1'
      ? {
          english: `Got it, *${conflict_old}* removed. How many times a day do ${isSelf ? 'you' : recipient?.recipient_name || 'they'} take *${medicines[current_index]}*?`,
          marathi: `ठीक आहे, *${conflict_old}* बंद केली. तुम्ही *${medicines[current_index]}* दिवसातून किती वेळा घेता?`,
          hindi:   `ठीक है, *${conflict_old}* बंद कर दी। आप *${medicines[current_index]}* दिन में कितनी बार लेते हैं?`,
        }[lang]
      : {
          english: `Understood, taking both. How many times a day do ${isSelf ? 'you' : recipient?.recipient_name || 'they'} take *${medicines[current_index]}*?`,
          marathi: `समजलं, दोन्ही घ्यायच्या. तुम्ही *${medicines[current_index]}* दिवसातून किती वेळा घेता?`,
          hindi:   `समझ गया, दोनों लेनी हैं। आप *${medicines[current_index]}* दिन में कितनी बार लेते हैं?`,
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
    english: 'I can help you with doctor appointments, medication reminders, or emergency help. What do you need?',
    marathi: 'मी डॉक्टर अपॉइंटमेंट, औषधांची आठवण किंवा आपत्कालीन मदतीसाठी मदत करू शकतो. काय हवे आहे?',
    hindi:   'मैं डॉक्टर अपॉइंटमेंट, दवाई रिमाइंडर या आपातकाल में मदद कर सकता हूं। क्या चाहिए?',
  }[lang];
}

// ─── Intent reply builder ─────────────────────────────────────────────────────

async function buildReply(parsed, account, lang, recipient, messageText) {
  if (/^(find\s*(doctor|clinic|nearest)|nearest\s*(doctor|clinic)|doctor\s*near|clinic\s*near)/i.test(messageText.trim())) {
    return await handleBookAppointment({ intent: 'book_appointment', details: {} }, account, lang, recipient);
  }

  if (parsed.intent === 'book_appointment') {
    return await handleBookAppointment(parsed, account, lang, recipient);
  }

  if (parsed.intent === 'confirm_appointment') {
    return await handleConfirmAppointment(messageText, account, lang, recipient);
  }

  if (parsed.intent === 'medication_reminder') {
    await updateAccount(account.account_phone, { pending_action: 'awaiting_medication_names' });
    const isSelf = account.account_type === 'self';
    return {
      english: `What medications do ${isSelf ? 'you' : recipient?.recipient_name || 'they'} currently take?`,
      marathi: isSelf
        ? `तुम्ही सध्या कोणती औषधे घेता?`
        : `${recipient?.recipient_name || 'ते'} सध्या कोणती औषधे घेतात?`,
      hindi: isSelf
        ? `आप अभी कौन सी दवाइयाँ लेते हैं?`
        : `${recipient?.recipient_name || 'वे'} अभी कौन सी दवाइयाँ लेते हैं?`,
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

    return {
      english: `Which part of your health card would you like to update?\n\n• Blood group\n• Allergy (add)\n• Illness (add)\n• Surgery (add)\n• Medical history\n\nE.g., type *update blood group* or *add allergy Penicillin*`,
      marathi: `तुमच्या health card मध्ये काय update करायचे आहे?\n\n• Blood group\n• Allergy (add)\n• Illness (add)\n• Surgery (add)\n• Medical history\n\nउदा. *blood group update करा* किंवा *allergy add करा Penicillin*`,
      hindi:   `आपके health card में क्या update करना है?\n\n• Blood group\n• Allergy (add)\n• Illness (add)\n• Surgery (add)\n• Medical history\n\nजैसे *blood group update karo* या *allergy add karo Penicillin*`,
    }[lang];
  }

  const REPLIES = {
    sos: {
      english: 'Emergency noted! Alerting your family now.',
      marathi: 'आपत्कालीन परिस्थिती समजली! कुटुंबाला संदेश पाठवत आहोत.',
      hindi:   'आपातकाल समझ गए! परिवार को सूचित कर रहे हैं।',
    },
    status_check: {
      english: 'Checking your appointment status.',
      marathi: 'तुमच्या अपॉइंटमेंटची स्थिती तपासत आहोत.',
      hindi:   'आपकी अपॉइंटमेंट का स्टेटस चेक कर रहे हैं।',
    },
    default: {
      english: 'I can help you with doctor appointments, medication reminders, or emergency help. What do you need?',
      marathi: 'मी डॉक्टर अपॉइंटमेंट, औषधांची आठवण किंवा आपत्कालीन मदतीसाठी मदत करू शकतो. काय हवे आहे?',
      hindi:   'मैं डॉक्टर अपॉइंटमेंट, दवाई रिमाइंडर या आपातकाल में मदद कर सकता हूं। क्या चाहिए?',
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

  const familyContacts = recipient.family_contacts || [];
  if (familyContacts.length > 0) {
    const familyMsg = {
      marathi: `📅 ${recipient.recipient_name} यांची appointment confirm झाली.\n\n🏥 ${details.clinic_name || 'Doctor'}${details.date_display ? '\n📅 ' + details.date_display : ''}\n🕐 ${details.time_display}\n\n— CareProxy`,
      hindi:   `📅 ${recipient.recipient_name} की appointment confirm हो गई।\n\n🏥 ${details.clinic_name || 'Doctor'}${details.date_display ? '\n📅 ' + details.date_display : ''}\n🕐 ${details.time_display}\n\n— CareProxy`,
    }[lang] || `📅 ${recipient.recipient_name} has confirmed a doctor appointment at ${details.clinic_name || 'a clinic'}${details.date_display ? ' on ' + details.date_display : ''} at ${details.time_display}.`;

    const toE164 = p => p.startsWith('+') ? p : `+${p.replace(/\D/g, '')}`;
    await Promise.all(familyContacts.map(p => sendTextMessage(toE164(p), familyMsg)));
  }

  await updateAccount(account.account_phone, { pending_action: 'awaiting_medication_names' });

  return {
    english: `✅ Appointment noted at *${details.clinic_name || 'doctor'}*${details.date_display ? ' on ' + details.date_display : ''} at ${details.time_display}. Your family has been notified. I'll remind you 1 hour before. 🔔\n\nDid the doctor prescribe any new medications? Tell me the names and I'll set reminders.\n\nOr type *skip* if none.`,
    marathi: `✅ *${details.clinic_name || 'Doctor'}* येथे${details.date_display ? ' ' + details.date_display + ' ला' : ''} ${details.time_display} ची appointment नोंदवली. कुटुंबाला कळवले. 1 तास आधी reminder येईल. 🔔\n\nDoctor ने नवीन औषधे दिली का? नावे सांगा, मी reminders सेट करतो.\n\nनसल्यास *skip* टाइप करा.`,
    hindi:   `✅ *${details.clinic_name || 'Doctor'}* में${details.date_display ? ' ' + details.date_display + ' को' : ''} ${details.time_display} की appointment दर्ज हुई। परिवार को बता दिया। 1 घंटे पहले reminder आएगा। 🔔\n\nDoctor ने कोई नई दवाइयाँ दी हैं? नाम बताएं, मैं reminders सेट कर दूंगा।\n\nनहीं दी तो *skip* लिखें।`,
  }[lang];
}

async function handleBookAppointment(parsed, account, lang, recipient) {
  const appointmentType = parsed.details?.appointment_type;

  // No address — can't search
  if (!recipient?.home_address) {
    return {
      english: 'I could not find your home address. Please complete your profile setup first.',
      marathi: 'तुमचा पत्ता सापडला नाही. कृपया आधी प्रोफाइल सेटअप पूर्ण करा.',
      hindi:   'आपका पता नहीं मिला। पहले प्रोफाइल सेटअप पूर्ण करें।',
    }[lang];
  }

  // Type unclear — ask GP or specialist
  if (!appointmentType || appointmentType === 'null') {
    await updateAccount(account.account_phone, { pending_action: 'appointment_type' });
    return {
      english: `Do you need a general check-up at a nearby clinic, or a specialist at a hospital?\n\n1. Nearby clinic (general)\n2. Specialist at hospital\n\nReply 1 or 2`,
      marathi: `तुम्हाला जवळच्या क्लिनिकमध्ये सामान्य तपासणी हवी आहे, की हॉस्पिटलमध्ये तज्ज्ञ डॉक्टर?\n\n1. जवळचे क्लिनिक (सामान्य)\n2. हॉस्पिटलमध्ये तज्ज्ञ\n\n1 किंवा 2 reply करा`,
      hindi:   `क्या आपको नज़दीकी क्लिनिक में सामान्य जांच चाहिए, या अस्पताल में विशेषज्ञ?\n\n1. नज़दीकी क्लिनिक (सामान्य)\n2. अस्पताल में विशेषज्ञ\n\n1 या 2 reply करें`,
    }[lang];
  }

  // Specialist — ask which type
  if (appointmentType === 'specialist' && !parsed.details?.specialty) {
    await updateAccount(account.account_phone, { pending_action: 'specialist_type' });
    return {
      english: 'Which type of specialist do you need?\n\nFor example: eye, heart, bones, skin, ENT, teeth',
      marathi: 'कोणत्या प्रकारचे तज्ज्ञ डॉक्टर हवे आहेत?\n\nउदाहरण: डोळे, हृदय, हाडे, त्वचा, कान-नाक-घसा, दात',
      hindi:   'किस प्रकार के विशेषज्ञ डॉक्टर चाहिए?\n\nउदाहरण: आँख, दिल, हड्डी, त्वचा, कान-नाक-गला, दाँत',
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
        english: `You've visited *${returningClinic.name}* before.\nWould you like to go there again?\n\n1. Yes, ${returningClinic.name}\n2. No, find a different clinic\n\nReply 1 or 2`,
        marathi: `पूर्वी *${returningClinic.name}* येथे गेला होतात.\nपुन्हा तेथेच जायचे आहे का?\n\n1. हो, ${returningClinic.name}\n2. नाही, नवीन clinic शोधा\n\n1 किंवा 2 reply करा`,
        hindi:   `पहले *${returningClinic.name}* में गए थे।\nवहीं जाना है?\n\n1. हाँ, ${returningClinic.name}\n2. नहीं, नई clinic खोजें\n\n1 या 2 reply करें`,
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
      english: `Do you want to book at your saved doctor (${doctor.info}), or find a nearby clinic?\n\n1. My saved doctor\n2. Find nearby clinic\n\nReply 1 or 2`,
      marathi: `तुमच्या नेहमीच्या डॉक्टरकडे (${doctor.info}) appointment बुक करायची आहे, की जवळचे क्लिनिक शोधायचे?\n\n1. माझे नेहमीचे डॉक्टर\n2. जवळचे क्लिनिक शोधा\n\n1 किंवा 2 reply करा`,
      hindi:   `क्या आप अपने पुराने डॉक्टर (${doctor.info}) के यहाँ appointment बुक करना चाहते हैं, या नज़दीकी क्लिनिक खोजें?\n\n1. मेरे पुराने डॉक्टर\n2. नज़दीकी क्लिनिक खोजें\n\n1 या 2 reply करें`,
    }[lang];
  }

  // Search clinics directly
  const specialty = appointmentType === 'specialist' ? parsed.details?.specialty : null;
  return await searchAndFormatClinics(recipient, specialty, lang);
}

async function searchAndFormatClinics(recipient, specialty, lang) {
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
      english: 'Sorry, I could not find any clinics near your address. Please try again.',
      marathi: 'माफ करा, तुमच्या पत्त्याजवळ क्लिनिक सापडले नाही. कृपया पुन्हा प्रयत्न करा.',
      hindi:   'माफ़ करें, आपके पते के पास कोई क्लिनिक नहीं मिला। कृपया फिर से प्रयास करें।',
    }[lang];
  }

  await updateAccount(recipient.account_phone, {
    pending_data: {
      clinics,
      next_page_token: nextPageToken || null,
    },
  });

  return formatClinicList(clinics, specialty, lang, !!nextPageToken);
}

function formatClinicList(clinics, specialty, lang, hasMore) {
  const header = {
    english: `Here are the nearest ${specialty ? specialty + ' hospitals' : 'clinics'} near you:\n\n`,
    marathi: `तुमच्या जवळचे ${specialty ? specialty + ' हॉस्पिटल' : 'क्लिनिक'}:\n\n`,
    hindi:   `आपके पास के ${specialty ? specialty + ' अस्पताल' : 'क्लिनिक'}:\n\n`,
  }[lang];

  const list = clinics.map((c, i) => {
    const rating = c.rating ? ` ⭐ ${c.rating}` : '';
    const reviews = c.reviews ? ` (${c.reviews} reviews)` : '';
    const phone = c.phone ? `\n📞 ${c.phone}` : '';
    return `${i + 1}. *${c.name}*${rating}${reviews}\n${c.address}${phone}`;
  }).join('\n\n');

  const footer = {
    english: `\n\nSelect a number 1–5 for clinic contact details to book the appointment. Type *more* for more options.\nNeed a specialist? Just say — e.g. "eye doctor" or "heart doctor"`,
    marathi: `\n\nAppointment साठी 1–5 नंबर निवडा clinic contact details साठी. *more* टाइप करा अजून पर्यायांसाठी.\nतज्ज्ञ डॉक्टर हवे? सांगा — उदा. "डोळ्यांचे डॉक्टर"`,
    hindi:   `\n\nAppointment के लिए 1–5 नंबर चुनें clinic contact details के लिए। *more* लिखें और options के लिए।\nविशेषज्ञ चाहिए? बताएं — जैसे "आँख का डॉक्टर"`,
  }[lang];

  const noMore = {
    english: `\n\nSelect a number 1–5 for clinic contact details to book the appointment.\nNeed a specialist? Just say — e.g. "eye doctor" or "heart doctor"`,
    marathi: `\n\nAppointment साठी 1–5 नंबर निवडा clinic contact details साठी.\nतज्ज्ञ डॉक्टर हवे? सांगा — उदा. "डोळ्यांचे डॉक्टर"`,
    hindi:   `\n\nAppointment के लिए 1–5 नंबर चुनें clinic contact details के लिए।\nविशेषज्ञ चाहिए? बताएं — जैसे "आँख का डॉक्टर"`,
  }[lang];

  return header + list + (hasMore ? footer : noMore);
}

// ─── SOS ─────────────────────────────────────────────────────────────────────

function isSOS(text) {
  return /\b(help|emergency|sos|madad|bachao|bachav|मदत|आपत्काल|मदद|बचाओ)\b/i.test(text.trim());
}

async function handleSOS(account, lang, recipient) {
  const name = recipient?.recipient_name || 'Your family member';
  const address = recipient?.home_address || 'their home';
  const familyContacts = recipient?.family_contacts || [];
  const toE164 = p => p.startsWith('+') ? p : `+${p.replace(/\D/g, '')}`;

  const hasHealthCard = !!(
    recipient?.blood_group ||
    (Array.isArray(recipient?.allergies) && recipient.allergies.length > 0) ||
    (Array.isArray(recipient?.major_illnesses) && recipient.major_illnesses.length > 0) ||
    (Array.isArray(recipient?.surgeries) && recipient.surgeries.length > 0) ||
    recipient?.medical_history
  );

  if (familyContacts.length > 0) {
    const alertMsg = lang === 'hindi'
      ? `🆘 *${name}* को मदद चाहिए!\n\n📍 ${address}\n\nतुरंत संपर्क करें। — CareProxy`
      : `🆘 *${name}* यांना मदत हवी आहे!\n\n📍 ${address}\n\nताबडतोब संपर्क करा. — CareProxy`;

    const ambulanceMsg = lang === 'hindi'
      ? `🚑 एम्बुलेंस नंबर:\n\n• सरकारी एम्बुलेंस: tel:108\n• पुलिस + आपातकाल: tel:112`
      : `🚑 Ambulance नंबर:\n\n• सरकारी Ambulance: tel:108\n• पोलीस + आपत्काल: tel:112`;

    const contacts = [...new Set(familyContacts.map(toE164))];
    await Promise.all(contacts.flatMap(p => [
      sendTextMessage(p, alertMsg).catch(e => console.error(`SOS alert failed to ${p.slice(0, 5)}***:`, e.message)),
      sendTextMessage(p, ambulanceMsg).catch(e => console.error(`SOS ambulance failed to ${p.slice(0, 5)}***:`, e.message)),
    ]));

    if (hasHealthCard) {
      const healthCard = generateHealthCard(recipient);
      await Promise.all(contacts.map(p =>
        sendTextMessage(p, healthCard).catch(e => console.error(`SOS health card failed to ${p.slice(0, 5)}***:`, e.message))
      ));
    }
  }

  const cardNote = !hasHealthCard ? {
    english: '\n\nNote: Health card is not set up yet. Type *health card* to set it up.',
    marathi: '\n\nटीप: Health card अजून सेट केलेले नाही. सेट करण्यासाठी *health card* टाइप करा.',
    hindi:   '\n\nनोट: Health card अभी सेट नहीं है। सेट करने के लिए *health card* लिखें.',
  }[lang] : '';

  return {
    english: `🆘 Emergency!\n\nCall *108* now: tel:108\nOr dial *112*: tel:112\n\nYour family has been alerted.${cardNote}`,
    marathi: `🆘 आपत्कालीन स्थिती!\n\n*108* वर तात्काळ फोन करा: tel:108\nकिंवा *112*: tel:112\n\nकुटुंबाला कळवले.${cardNote}`,
    hindi:   `🆘 आपातकाल!\n\n*108* पर तुरंत फोन करें: tel:108\nया *112*: tel:112\n\nपरिवार को सूचित किया।${cardNote}`,
  }[lang];
}

// ─── Medication helpers ───────────────────────────────────────────────────────

function isMedicationAck(text) {
  return /^(done|taken|yes|हो|ha|घेतलं|ghetal|le liya|ले लिया|ok|okay|हाँ|haan|लिया|घेतले)$/i.test(text.trim());
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
    english: `Your 7-day free trial has ended.\n\nSubscribe for ₹499/month to continue using CareProxy:${linkLine}`,
    marathi: `तुमचा ७ दिवसांचा free trial संपला.\n\nCareProxy वापरणे सुरू ठेवण्यासाठी ₹499/महिना subscribe करा:${linkLine}`,
    hindi:   `आपका ७ दिन का free trial खत्म हो गया।\n\n₹499/महीना subscribe करके CareProxy जारी रखें:${linkLine}`,
  }[lang];
}

export default router;

import { Router } from 'express';
import { config } from '../config/env.js';
import { parseIntent } from '../services/claude.js';
import { sendTextMessage } from '../services/whatsapp.js';
import { getOrCreateAccount, updateAccount, getConversationHistory, saveMessage, getPrimaryCareRecipient } from '../services/supabase.js';
import { handleOnboarding } from '../services/onboarding.js';
import { findNearbyClinics, findMoreClinics } from '../services/maps.js';

const router = Router();

// Deduplicate Meta webhook retries — store processed message IDs for 60s
const processedMessageIds = new Set();

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

    const senderPhone = message.from;
    const messageText = message.text.body;

    const account = await getOrCreateAccount(senderPhone);
    await saveMessage(senderPhone, 'user', messageText);

    let reply;

    if (!account.onboarding_complete) {
      reply = await handleOnboarding(account, messageText);
    } else {
      const recipient = await getPrimaryCareRecipient(senderPhone);
      const lang = recipient?.preferred_language || 'english';

      if (isMoreRequest(messageText)) {
        reply = await handleMoreClinics(account, lang);
      } else if (account.pending_action) {
        reply = await handlePendingAction(account, messageText, lang, recipient);
      } else {
        const history = await getConversationHistory(senderPhone, 3);
        const parsedIntent = await parseIntent(messageText, history);
        reply = await buildReply(parsedIntent, account, lang, recipient);
      }
    }

    await sendTextMessage(senderPhone, reply);
    await saveMessage(senderPhone, 'assistant', reply);
  } catch (err) {
    console.error('Webhook handler error:', err.message);
  }
});

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
    pending_data: nextPageToken ? { next_page_token: nextPageToken } : null,
  });

  return formatClinicList(clinics, null, lang, !!nextPageToken);
}

// ─── Pending action handler (post-onboarding follow-up replies) ───────────────

async function handlePendingAction(account, messageText, lang, recipient) {
  const choice = messageText.trim().toLowerCase();
  const { pending_action, account_phone } = account;

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

  // Unknown pending state — reset and re-prompt
  await updateAccount(account_phone, { pending_action: null });
  return {
    english: 'I can help you with doctor appointments, medication reminders, or emergency help. What do you need?',
    marathi: 'मी डॉक्टर अपॉइंटमेंट, औषधांची आठवण किंवा आपत्कालीन मदतीसाठी मदत करू शकतो. काय हवे आहे?',
    hindi:   'मैं डॉक्टर अपॉइंटमेंट, दवाई रिमाइंडर या आपातकाल में मदद कर सकता हूं। क्या चाहिए?',
  }[lang];
}

// ─── Intent reply builder ─────────────────────────────────────────────────────

async function buildReply(parsed, account, lang, recipient) {
  if (parsed.intent === 'book_appointment') {
    return await handleBookAppointment(parsed, account, lang, recipient);
  }

  const REPLIES = {
    sos: {
      english: 'Emergency noted! Alerting your family now.',
      marathi: 'आपत्कालीन परिस्थिती समजली! कुटुंबाला संदेश पाठवत आहोत.',
      hindi:   'आपातकाल समझ गए! परिवार को सूचित कर रहे हैं।',
    },
    medication_reminder: {
      english: 'We will set your medication reminder.',
      marathi: 'आम्ही तुमची औषधांची आठवण सेट करतो.',
      hindi:   'दवाई का रिमाइंडर सेट कर देंगे।',
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
      english: `Do you need a general check-up at a nearby clinic, or a specialist at a hospital?\n\n1. Nearby clinic (general)\n2. Specialist at hospital`,
      marathi: `तुम्हाला जवळच्या क्लिनिकमध्ये सामान्य तपासणी हवी आहे, की हॉस्पिटलमध्ये तज्ज्ञ डॉक्टर?\n\n1. जवळचे क्लिनिक (सामान्य)\n2. हॉस्पिटलमध्ये तज्ज्ञ`,
      hindi:   `क्या आपको नज़दीकी क्लिनिक में सामान्य जांच चाहिए, या अस्पताल में विशेषज्ञ?\n\n1. नज़दीकी क्लिनिक (सामान्य)\n2. अस्पताल में विशेषज्ञ`,
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

  // GP with saved doctor — offer choice
  const savedDoctors = recipient.saved_doctors || [];
  const hasValidSavedDoctor = savedDoctors.length > 0 && savedDoctors[0]?.info &&
    !/^\d+$/.test(savedDoctors[0].info.replace(/\s/g, ''));

  if (hasValidSavedDoctor && appointmentType === 'gp') {
    await updateAccount(account.account_phone, { pending_action: 'saved_doctor_choice' });
    const doctor = savedDoctors[0];
    return {
      english: `Do you want to book at your saved doctor (${doctor.info}), or find a nearby clinic?\n\n1. My saved doctor\n2. Find nearby clinic`,
      marathi: `तुमच्या नेहमीच्या डॉक्टरकडे (${doctor.info}) appointment बुक करायची आहे, की जवळचे क्लिनिक शोधायचे?\n\n1. माझे नेहमीचे डॉक्टर\n2. जवळचे क्लिनिक शोधा`,
      hindi:   `क्या आप अपने पुराने डॉक्टर (${doctor.info}) के यहाँ appointment बुक करना चाहते हैं, या नज़दीकी क्लिनिक खोजें?\n\n1. मेरे पुराने डॉक्टर\n2. नज़दीकी क्लिनिक खोजें`,
    }[lang];
  }

  // Search clinics directly
  const specialty = appointmentType === 'specialist' ? parsed.details?.specialty : null;
  return await searchAndFormatClinics(recipient, specialty, lang);
}

async function searchAndFormatClinics(recipient, specialty, lang) {
  const { clinics, nextPageToken } = await findNearbyClinics(recipient.home_address, specialty);

  if (!clinics.length) {
    return {
      english: 'Sorry, I could not find any clinics near your address. Please try again.',
      marathi: 'माफ करा, तुमच्या पत्त्याजवळ क्लिनिक सापडले नाही. कृपया पुन्हा प्रयत्न करा.',
      hindi:   'माफ़ करें, आपके पते के पास कोई क्लिनिक नहीं मिला। कृपया फिर से प्रयास करें।',
    }[lang];
  }

  await updateAccount(recipient.account_phone, {
    pending_data: nextPageToken ? { next_page_token: nextPageToken } : null,
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
    english: `\n\nReply 1–5 to book, or type *more* for more options.\nNeed a specialist? Just say — e.g. "eye doctor" or "heart doctor"`,
    marathi: `\n\n1 ते 5 उत्तर देऊन appointment बुक करा, किंवा *more* टाइप करा.\nतज्ज्ञ डॉक्टर हवे? सांगा — उदा. "डोळ्यांचे डॉक्टर" किंवा "हृदयरोग तज्ज्ञ"`,
    hindi:   `\n\n1–5 जवाब देकर appointment बुक करें, या *more* लिखें।\nविशेषज्ञ चाहिए? बताएं — जैसे "आँख का डॉक्टर" या "दिल का डॉक्टर"`,
  }[lang];

  const noMore = {
    english: `\n\nReply 1–5 to book.\nNeed a specialist? Just say — e.g. "eye doctor" or "heart doctor"`,
    marathi: `\n\n1 ते 5 उत्तर देऊन appointment बुक करा.\nतज्ज्ञ डॉक्टर हवे? सांगा — उदा. "डोळ्यांचे डॉक्टर"`,
    hindi:   `\n\n1–5 जवाब देकर appointment बुक करें।\nविशेषज्ञ चाहिए? बताएं — जैसे "आँख का डॉक्टर"`,
  }[lang];

  return header + list + (hasMore ? footer : noMore);
}

export default router;

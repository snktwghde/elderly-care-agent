import { updateAccount, upsertCareRecipient } from './supabase.js';

const Q = {
  welcome:
    `Welcome to CareProxy! 👋\n\nI help elderly people with locating nearby clinics for doctor appointments, medication reminders, and emergency help — all on WhatsApp.\n\nLet's get you set up. Please choose your language / भाषा निवडा / अपनी भाषा चुनें:\n\n1. English\n2. मराठी\n3. हिंदी`,

  name: {
    english: `What is your name?`,
    marathi: `तुमचे नाव काय आहे?`,
    hindi:   `आपका नाम क्या है?`,
  },

  address: {
    english: `What is your home address? (area and city is fine)`,
    marathi: `तुमचा घराचा पत्ता सांगा. (भाग आणि शहर पुरेसे आहे)`,
    hindi:   `आपका घर का पता बताएं. (इलाका और शहर काफी है)`,
  },

  contacts: {
    english: `Share up to 2 contact numbers to notify for appointments, medications and emergencies. Enter 10-digit numbers (e.g. 9876543210).\n\nType *skip* if none.`,
    marathi: `Appointment, औषध आणि आपत्काल alerts साठी सूचित करायच्या 2 जणांचे नंबर द्या. 10 आकडी नंबर (उदा. 9876543210).\n\nकोणी नसल्यास *skip* टाइप करा.`,
    hindi:   `Appointment, दवाई और आपातकाल alerts के लिए 2 संपर्क नंबर दें. 10 अंक का नंबर (जैसे 9876543210).\n\nकोई नहीं तो *skip* लिखें.`,
  },

  doctor: {
    english: `Do you have a regular doctor or clinic you usually visit?\n\nShare the name and address — we'll show you their contact details when you need to book a visit.\n\nIf not, reply *skip*`,
    marathi: `तुमचे नेहमीचे डॉक्टर किंवा क्लिनिक आहे का?\n\nनाव व पत्ता द्या — visit बुक करायची असेल तेव्हा आम्ही contact details दाखवू.\n\nनसल्यास *skip* टाइप करा.`,
    hindi:   `क्या आपका कोई नियमित डॉक्टर या क्लिनिक है?\n\nनाम और पता दें — जब visit बुक करनी हो, हम contact details दिखाएंगे.\n\nनहीं है तो *skip* लिखें.`,
  },

  doctor_details: {
    english: `Please share the name and address of your regular doctor or clinic.\n\nType *skip* to do it later.`,
    marathi: `तुमच्या नेहमीच्या डॉक्टर किंवा क्लिनिकचे नाव आणि पत्ता सांगा.\n\nनंतर करायचे असल्यास *skip* टाइप करा.`,
    hindi:   `अपने नियमित डॉक्टर या क्लिनिक का नाम और पता बताएं.\n\nबाद में करना हो तो *skip* लिखें.`,
  },

  complete: {
    english: `All set! CareProxy is ready for you.\n\nYou can now:\n• Locate nearby clinics to book doctor appointment\n• Locate specialised hospitals (type *specialised*)\n• Set medication reminders\n• Emergency helplines (type *help* anytime)\n• Sends appointment, medication and emergency alerts to your family\n\nJust send a message anytime.`,
    marathi: `सर्व तयार! CareProxy तुमच्यासाठी तयार आहे.\n\nआता तुम्ही:\n• Doctor appointment साठी जवळचे clinic शोधा\n• तज्ज्ञ हॉस्पिटल शोधा (*specialised* टाइप करा)\n• औषधांची आठवण सेट करा\n• आपत्कालीन helplines (*help* टाइप करा)\n• Appointment, औषध आणि emergency alerts कुटुंबाला पाठवले जातात\n\nकधीही संदेश करा.`,
    hindi:   `सब तैयार! CareProxy आपके लिए तैयार है.\n\nअब आप:\n• Doctor appointment के लिए नज़दीकी clinic खोजें\n• विशेषज्ञ अस्पताल खोजें (*specialised* लिखें)\n• दवाई reminder सेट करें\n• आपातकालीन helplines (*help* लिखें)\n• Appointment, दवाई और emergency alerts परिवार को भेजे जाते हैं\n\nकभी भी message करें.`,
  },
};

function parseLanguage(text) {
  const t = text.trim().toLowerCase();
  if (t === '1' || t === 'english') return 'english';
  if (t === '2' || t.includes('मराठी') || t === 'marathi') return 'marathi';
  if (t === '3' || t.includes('हिंदी') || t === 'hindi') return 'hindi';
  return 'english';
}

function normalisePhone(raw) {
  const digits = raw.replace(/\D/g, '');
  if (digits.length === 10) return `+91${digits}`;
  if (digits.startsWith('91') && digits.length === 12) return `+${digits}`;
  return `+${digits}`;
}

function parseContacts(text) {
  const numbers = text.match(/[\d+]{10,13}/g) || [];
  return numbers.map(normalisePhone).slice(0, 2);
}

export async function handleOnboarding(account, messageText) {
  const step = account.onboarding_step || 'start';
  const data = account.onboarding_data || {};
  const lang = data.language || 'english';

  switch (step) {
    case 'start': {
      await updateAccount(account.account_phone, { onboarding_step: 'language' });
      return Q.welcome;
    }

    case 'language': {
      const language = parseLanguage(messageText);
      await updateAccount(account.account_phone, {
        onboarding_step: 'name',
        onboarding_data: { ...data, language },
      });
      return Q.name[language];
    }

    case 'name': {
      const recipientName = messageText.trim();
      await updateAccount(account.account_phone, {
        onboarding_step: 'address',
        onboarding_data: { ...data, recipient_name: recipientName },
      });
      return Q.address[lang];
    }

    case 'address': {
      await updateAccount(account.account_phone, {
        onboarding_step: 'contacts',
        onboarding_data: { ...data, home_address: messageText.trim() },
      });
      return Q.contacts[lang];
    }

    case 'contacts': {
      const isSkip = /^skip$/i.test(messageText.trim());
      const contacts = isSkip ? [] : parseContacts(messageText);
      await updateAccount(account.account_phone, {
        onboarding_step: 'doctor',
        onboarding_data: { ...data, family_contacts: contacts },
      });
      return Q.doctor[lang];
    }

    case 'doctor': {
      const isSkip = /^skip$/i.test(messageText.trim());
      const isYes = /^(yes|yeah|yep|हो|ho|haan|हाँ|ha|हा|ji|जी|sure|ok|okay|हां|bilkul)$/i.test(messageText.trim());

      if (isYes) {
        await updateAccount(account.account_phone, { onboarding_step: 'doctor_details' });
        return Q.doctor_details[lang];
      }

      const savedDoctors = isSkip ? [] : [{ info: messageText.trim() }];
      const finalData = { ...data, saved_doctors: savedDoctors };
      await saveCareRecipient(account, finalData);
      await updateAccount(account.account_phone, {
        account_type: 'self',
        onboarding_complete: true,
        onboarding_step: 'complete',
        onboarding_data: null,
      });
      return Q.complete[lang];
    }

    case 'doctor_details': {
      const isSkip = /^skip$/i.test(messageText.trim());
      const savedDoctors = isSkip ? [] : [{ info: messageText.trim() }];
      const finalData = { ...data, saved_doctors: savedDoctors };
      await saveCareRecipient(account, finalData);
      await updateAccount(account.account_phone, {
        account_type: 'self',
        onboarding_complete: true,
        onboarding_step: 'complete',
        onboarding_data: null,
      });
      return Q.complete[lang];
    }

    default: {
      await updateAccount(account.account_phone, { onboarding_step: 'start' });
      return Q.welcome;
    }
  }
}

async function saveCareRecipient(account, data) {
  await upsertCareRecipient({
    account_phone: account.account_phone,
    recipient_name: data.recipient_name,
    recipient_phone: account.account_phone,
    preferred_language: data.language || 'english',
    home_address: data.home_address,
    family_contacts: data.family_contacts || [],
    saved_doctors: data.saved_doctors || [],
  });
}

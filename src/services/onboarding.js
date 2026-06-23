import { updateAccount, upsertCareRecipient } from './supabase.js';

const Q = {
  welcome:
    `Welcome to CareProxy! 👋\n\nI help elderly people with doctor appointments, medication reminders, and emergency help — all on WhatsApp.\n\nLet's get you set up. Please choose your language / भाषा निवडा / अपनी भाषा चुनें:\n\n1. English\n2. मराठी\n3. हिंदी`,

  account_type: {
    english: `Are you setting this up for yourself or for an elderly family member?\n\n1. For myself\n2. For an elderly family member`,
    marathi: `हे तुमच्यासाठी सेट करत आहात की कुटुंबातील वृद्ध व्यक्तीसाठी?\n\n1. माझ्यासाठी\n2. वृद्ध कुटुंबातील सदस्यासाठी`,
    hindi:   `क्या आप यह अपने लिए सेट कर रहे हैं या किसी बुजुर्ग परिवार के सदस्य के लिए?\n\n1. अपने लिए\n2. बुजुर्ग परिवार के सदस्य के लिए`,
  },

  name_self: {
    english: `What is your name?`,
    marathi: `तुमचे नाव काय आहे?`,
    hindi:   `आपका नाम क्या है?`,
  },

  name_caregiver: {
    english: `What is your elderly family member's name?`,
    marathi: `तुमच्या वृद्ध कुटुंबातील सदस्याचे नाव काय आहे?`,
    hindi:   `आपके बुजुर्ग परिवार के सदस्य का नाम क्या है?`,
  },

  address: {
    english: (name) => `What is ${name}'s home address? (area and city is fine)`,
    marathi: (name) => `${name} यांचा घराचा पत्ता सांगा. (भाग आणि शहर पुरेसे आहे)`,
    hindi:   (name) => `${name} का घर का पता बताएं. (इलाका और शहर काफी है)`,
  },

  recipient_phone: {
    english: (name) => `What is ${name}'s WhatsApp number? We will send reminders directly to them.\n\nFormat: 91XXXXXXXXXX`,
    marathi: (name) => `${name} यांचा WhatsApp नंबर काय आहे? आम्ही त्यांना थेट reminders पाठवू.\n\nFormat: 91XXXXXXXXXX`,
    hindi:   (name) => `${name} का WhatsApp नंबर क्या है? हम उन्हें सीधे reminders भेजेंगे.\n\nFormat: 91XXXXXXXXXX`,
  },

  contacts: {
    english: `Share up to 3 contact numbers for emergencies (family or friends we should notify). Send them together or one by one.`,
    marathi: `आपत्कालीन परिस्थितीत सूचित करायच्या 3 जणांचे नंबर द्या. एकत्र किंवा वेगळे पाठवू शकता.`,
    hindi:   `आपातकाल में सूचित करने के लिए 3 संपर्क नंबर दें. एक साथ या अलग-अलग भेज सकते हैं.`,
  },

  doctor: {
    english: (name) => `Does ${name} have a regular doctor or clinic they prefer to visit?\n\nShare their name and number so we can book appointments there directly.\n\nIf not, reply *skip*`,
    marathi: (name) => `${name} यांचे नेहमीचे डॉक्टर किंवा क्लिनिक आहे का?\n\nनाव व नंबर द्या, म्हणजे आम्ही तिथे थेट appointment बुक करू.\n\nनसल्यास *skip* टाइप करा.`,
    hindi:   (name) => `क्या ${name} का कोई नियमित डॉक्टर या क्लिनिक है?\n\nनाम और नंबर दें ताकि हम सीधे वहाँ appointment बुक कर सकें.\n\nनहीं है तो *skip* लिखें.`,
  },

  complete: {
    english: (name) => `All set! CareProxy is ready for ${name}.\n\nYou can now:\n• Book a doctor appointment\n• Set medication reminders\n• Get emergency help\n\nJust send a message anytime.`,
    marathi: (name) => `सर्व तयार! CareProxy ${name} यांच्यासाठी तयार आहे.\n\nआता तुम्ही:\n• Doctor appointment बुक करा\n• औषधांची आठवण सेट करा\n• आपत्कालीन मदत मिळवा\n\nकधीही संदेश करा.`,
    hindi:   (name) => `सब तैयार! CareProxy ${name} के लिए तैयार है.\n\nअब आप:\n• Doctor appointment बुक करें\n• दवाई reminder सेट करें\n• आपातकालीन मदद लें\n\nकभी भी message करें.`,
  },
};

function parseLanguage(text) {
  const t = text.trim().toLowerCase();
  if (t === '1' || t === 'english') return 'english';
  if (t === '2' || t.includes('मराठी') || t === 'marathi') return 'marathi';
  if (t === '3' || t.includes('हिंदी') || t === 'hindi') return 'hindi';
  return 'english';
}

function parseAccountType(text) {
  const t = text.trim().toLowerCase();
  if (t === '1' || t.includes('myself') || t.includes('माझ्यासाठी') || t.includes('अपने')) return 'self';
  return 'caregiver';
}

function parseContacts(text, accountPhone, accountType) {
  const numbers = text.match(/\d{10,12}/g) || [];
  const contacts = numbers.map(n => n.length === 10 ? `91${n}` : n);
  if (accountType === 'caregiver' && !contacts.includes(accountPhone)) {
    contacts.unshift(accountPhone);
  }
  return contacts.slice(0, 3);
}

export async function handleOnboarding(account, messageText) {
  const step = account.onboarding_step || 'start';
  const data = account.onboarding_data || {};
  const lang = data.language || 'english';
  const name = data.recipient_name || 'you';

  switch (step) {
    case 'start': {
      await updateAccount(account.account_phone, { onboarding_step: 'language' });
      return Q.welcome;
    }

    case 'language': {
      const language = parseLanguage(messageText);
      await updateAccount(account.account_phone, {
        onboarding_step: 'account_type',
        onboarding_data: { ...data, language },
      });
      return Q.account_type[language];
    }

    case 'account_type': {
      const accountType = parseAccountType(messageText);
      await updateAccount(account.account_phone, {
        account_type: accountType,
        onboarding_step: 'name',
        onboarding_data: { ...data, account_type: accountType },
      });
      return accountType === 'self' ? Q.name_self[lang] : Q.name_caregiver[lang];
    }

    case 'name': {
      const recipientName = messageText.trim();
      await updateAccount(account.account_phone, {
        onboarding_step: 'address',
        onboarding_data: { ...data, recipient_name: recipientName },
      });
      return Q.address[lang](recipientName);
    }

    case 'address': {
      const nextStep = data.account_type === 'caregiver' ? 'recipient_phone' : 'contacts';
      await updateAccount(account.account_phone, {
        onboarding_step: nextStep,
        onboarding_data: { ...data, home_address: messageText.trim() },
      });
      return data.account_type === 'caregiver'
        ? Q.recipient_phone[lang](data.recipient_name || '')
        : Q.contacts[lang];
    }

    case 'recipient_phone': {
      await updateAccount(account.account_phone, {
        onboarding_step: 'contacts',
        onboarding_data: { ...data, recipient_phone: messageText.trim() },
      });
      return Q.contacts[lang];
    }

    case 'contacts': {
      const contacts = parseContacts(messageText, account.account_phone, data.account_type);
      await updateAccount(account.account_phone, {
        onboarding_step: 'doctor',
        onboarding_data: { ...data, family_contacts: contacts },
      });
      return Q.doctor[lang](name);
    }

    case 'doctor': {
      const isSkip = messageText.trim().toLowerCase() === 'skip';
      const savedDoctors = isSkip ? [] : [{ info: messageText.trim() }];
      const finalData = { ...data, saved_doctors: savedDoctors };

      await saveCareRecipient(account, finalData);
      await updateAccount(account.account_phone, {
        onboarding_complete: true,
        onboarding_step: 'complete',
        onboarding_data: null,
      });
      return Q.complete[lang](data.recipient_name || 'you');
    }

    default: {
      await updateAccount(account.account_phone, { onboarding_step: 'start' });
      return Q.language_choice;
    }
  }
}

async function saveCareRecipient(account, data) {
  const recipientPhone = data.account_type === 'self'
    ? account.account_phone
    : (data.recipient_phone || account.account_phone);

  await upsertCareRecipient({
    account_phone: account.account_phone,
    recipient_name: data.recipient_name,
    recipient_phone: recipientPhone,
    preferred_language: data.language || 'english',
    home_address: data.home_address,
    family_contacts: data.family_contacts || [],
    saved_doctors: data.saved_doctors || [],
  });
}

import { updateAccount, updateCareRecipient } from './supabase.js';
import { sendTextMessage } from './whatsapp.js';

export function generateHealthCard(recipient) {
  const name = recipient?.recipient_name || 'Patient';
  const bloodGroup = recipient?.blood_group || 'Not provided';
  const medications = (recipient?.medication_schedule || []).map(m => m.name).join(', ') || 'Not provided';
  const allergies = (recipient?.allergies || []).map(a => a.name).join(', ') || 'Not provided';
  const illnesses = (recipient?.major_illnesses || []).join(', ') || 'Not provided';
  const surgeries = (recipient?.surgeries || [])
    .map(s => s.date ? `${s.name} (${s.date})` : s.name).join(', ') || 'Not provided';
  const history = recipient?.medical_history || 'Not provided';
  const emergency = (recipient?.family_contacts || [])[0] || 'Not provided';

  return [
    `🩺 *Health Card — ${name}*`,
    `─────────────────────`,
    `🩸 Blood Group: ${bloodGroup}`,
    `💊 Current Medications: ${medications}`,
    `⚠️ Allergies: ${allergies}`,
    `🏥 Major Illnesses: ${illnesses}`,
    `🔪 Surgeries: ${surgeries}`,
    `📋 Medical History: ${history}`,
    `📞 Emergency Contact: ${emergency}`,
    `─────────────────────`,
  ].join('\n');
}

export async function sendHealthCardOffer(phone, lang) {
  const msg = {
    english: `Doctors often ask for current medications and medical history during visits — this lets you share it instantly.\n\nWould you like to set up your health card? (Takes about 5 minutes)\n\nReply *Yes* to set up or *No* to skip for now.`,
    marathi: `डॉक्टरांना visit दरम्यान नेहमी medications आणि medical history विचारावी लागते — health card असल्यास ते लगेच share करता येते.\n\nतुमचे health card सेट करायचे आहे का? (सुमारे 5 मिनिटे)\n\n*हो* म्हणा सेट करण्यासाठी किंवा *नको* म्हणा नंतरसाठी.`,
    hindi: `Doctors visit के दौरान हमेशा medications और medical history पूछते हैं — health card होने से वो तुरंत share होती है.\n\nक्या आप अपना health card सेट करना चाहते हैं? (लगभग 5 मिनट)\n\n*हाँ* कहें सेट करने के लिए या *नहीं* बाद के लिए.`,
  }[lang] || `Doctors often ask for current medications and medical history during visits — this lets you share it instantly.\n\nWould you like to set up your health card? (Takes about 5 minutes)\n\nReply *Yes* to set up or *No* to skip for now.`;

  await updateAccount(phone, { pending_action: 'health_card_offer_pending' });
  await sendTextMessage(phone, msg);
}

export async function startHealthCardSetup(accountPhone, lang) {
  await updateAccount(accountPhone, { pending_action: 'health_card_blood_group' });
  return {
    english: `Let's set up your health card.\n\nWhat is your *blood group*? (e.g., B+, O-, AB+)\n\nType *skip* if you don't know or want to fill it later.`,
    marathi: `तुमचे health card सेट करूया.\n\nतुमचा *blood group* काय आहे? (उदा. B+, O-, AB+)\n\nमाहीत नसल्यास किंवा नंतर भरायचे असल्यास *skip* टाइप करा.`,
    hindi: `आपका health card सेट करते हैं.\n\nआपका *blood group* क्या है? (जैसे B+, O-, AB+)\n\nनहीं पता या बाद में भरना हो तो *skip* लिखें.`,
  }[lang];
}

const VALID_BLOOD_GROUPS = new Set(['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-', 'A1+', 'A1-', 'A1B+', 'A1B-']);
const SKIP_RE = /^(skip|don'?t know|nahi pata|pata nahi|माहीत नाही|पता नहीं|नाही|नको|नहीं)$/i;

export async function handleHealthCardSetup(account, messageText, lang, recipient) {
  const { pending_action, account_phone } = account;
  const input = messageText.trim().slice(0, 500);
  const isSkip = SKIP_RE.test(input);

  // ── health_card_offer_pending ──────────────────────────────────────────────
  if (pending_action === 'health_card_offer_pending') {
    const isYes = /^(yes|हो|ho|haan|हाँ|ha|हा|ok|okay|हो\s*जी|हां|ho ja)$/i.test(input);

    if (isYes) return await startHealthCardSetup(account_phone, lang);

    await updateAccount(account_phone, { pending_action: null });
    return {
      english: `No problem. You can set it up later — just type *health card* anytime.`,
      marathi: `ठीक आहे. नंतर केव्हाही *health card* टाइप करा.`,
      hindi: `कोई बात नहीं। बाद में कभी भी *health card* लिखें.`,
    }[lang];
  }

  // ── health_card_blood_group ────────────────────────────────────────────────
  if (pending_action === 'health_card_blood_group') {
    if (!isSkip) {
      const normalised = input.toUpperCase().replace(/\s+/g, '');
      if (!VALID_BLOOD_GROUPS.has(normalised)) {
        return {
          english: `Please enter a valid blood group (e.g., A+, B-, O+, AB+) or type *skip* to leave it blank.`,
          marathi: `कृपया valid blood group टाका (उदा. A+, B-, O+, AB+) किंवा रिकामे सोडायचे असल्यास *skip* टाइप करा.`,
          hindi: `कृपया valid blood group डालें (जैसे A+, B-, O+, AB+) या *skip* लिखें अगर खाली छोड़ना है.`,
        }[lang];
      }
      await updateCareRecipient(account_phone, { blood_group: normalised });
    }
    await updateAccount(account_phone, { pending_action: 'health_card_allergies' });
    return {
      english: `Got it!\n\nDo you have any *allergies*? List them separated by commas (e.g., Penicillin, Peanuts, Dust).\n\nType *skip* if none.`,
      marathi: `ठीक आहे!\n\nतुम्हाला कोणती *allergies* आहेत का? स्वल्पविरामाने विभागून लिहा (उदा. Penicillin, Peanuts).\n\nनसल्यास *skip* टाइप करा.`,
      hindi: `ठीक है!\n\nक्या आपको कोई *allergies* हैं? उन्हें comma से अलग करके लिखें (जैसे Penicillin, Peanuts).\n\n*skip* लिखें अगर कोई नहीं.`,
    }[lang];
  }

  // ── health_card_allergies ─────────────────────────────────────────────────
  if (pending_action === 'health_card_allergies') {
    if (!isSkip) {
      const items = input.split(/,|\n/).map(s => s.trim()).filter(Boolean).slice(0, 10);
      const allergies = items.map(name => ({ type: 'other', name: name.slice(0, 100) }));
      await updateCareRecipient(account_phone, { allergies });
    }
    await updateAccount(account_phone, { pending_action: 'health_card_illnesses' });
    return {
      english: `Got it!\n\nDo you have any *major illnesses*? (e.g., Diabetes, High blood pressure, Asthma)\n\nType *skip* if none.`,
      marathi: `ठीक आहे!\n\nतुम्हाला कोणते *प्रमुख आजार* आहेत का? (उदा. Diabetes, High blood pressure, Asthma)\n\nनसल्यास *skip* टाइप करा.`,
      hindi: `ठीक है!\n\nक्या आपको कोई *बड़ी बीमारियाँ* हैं? (जैसे Diabetes, High blood pressure, Asthma)\n\n*skip* लिखें अगर कोई नहीं.`,
    }[lang];
  }

  // ── health_card_illnesses ─────────────────────────────────────────────────
  if (pending_action === 'health_card_illnesses') {
    if (!isSkip) {
      const illnesses = input.split(/,|\n/).map(s => s.trim()).filter(Boolean).slice(0, 10);
      await updateCareRecipient(account_phone, { major_illnesses: illnesses });
    }
    await updateAccount(account_phone, { pending_action: 'health_card_surgeries' });
    return {
      english: `Got it!\n\nHave you had any *surgeries*? List them with year if known (e.g., Appendix removal 2019, Cataract surgery 2022).\n\nType *skip* if none.`,
      marathi: `ठीक आहे!\n\nतुम्हाला कोणत्या *शस्त्रक्रिया* झाल्या आहेत का? शक्य असल्यास वर्षासह लिहा (उदा. Appendix removal 2019).\n\nनसल्यास *skip* टाइप करा.`,
      hindi: `ठीक है!\n\nआपकी कोई *surgeries* हुई हैं? हो सके तो साल के साथ लिखें (जैसे Appendix removal 2019).\n\n*skip* लिखें अगर कोई नहीं.`,
    }[lang];
  }

  // ── health_card_surgeries ─────────────────────────────────────────────────
  if (pending_action === 'health_card_surgeries') {
    if (!isSkip) {
      const items = input.split(/,|\n/).map(s => s.trim()).filter(Boolean).slice(0, 10);
      const surgeries = items.map(item => {
        const yearMatch = item.match(/\b(19|20)\d{2}\b/);
        const date = yearMatch ? yearMatch[0] : null;
        const name = item.replace(/\b(19|20)\d{2}\b/, '').trim().replace(/\s+/g, ' ') || item;
        return { name: name.slice(0, 150), date };
      });
      await updateCareRecipient(account_phone, { surgeries });
    }
    await updateAccount(account_phone, { pending_action: 'health_card_history' });
    return {
      english: `Almost done!\n\nIs there any other *medical history* to add? (e.g., family history of heart disease, past hospitalisations)\n\nType *skip* to finish.`,
      marathi: `जवळजवळ झाले!\n\nइतर *वैद्यकीय इतिहास* काही सांगायचे आहे का? (उदा. कुटुंबात हृदयरोगाचा इतिहास)\n\nसंपवायचे असल्यास *skip* टाइप करा.`,
      hindi: `लगभग हो गया!\n\nकोई और *medical history* बताना है? (जैसे परिवार में दिल की बीमारी, पुराने hospitalisations)\n\nखत्म करने के लिए *skip* लिखें.`,
    }[lang];
  }

  // ── health_card_history ───────────────────────────────────────────────────
  if (pending_action === 'health_card_history') {
    if (!isSkip) {
      await updateCareRecipient(account_phone, { medical_history: input.slice(0, 500) });
    }
    await updateAccount(account_phone, { pending_action: null });
    return {
      english: `✅ Health card saved!\n\nType *health card* anytime to see it. During an SOS, it will be sent automatically to your family.`,
      marathi: `✅ Health card जतन झाले!\n\nकेव्हाही *health card* टाइप करा पाहण्यासाठी. SOS वेळी ते आपोआप कुटुंबाला पाठवले जाईल.`,
      hindi: `✅ Health card सेव हो गया!\n\nकभी भी *health card* लिखें देखने के लिए। SOS के समय यह automatically परिवार को भेजा जाएगा.`,
    }[lang];
  }

  // Unknown setup state — reset
  await updateAccount(account_phone, { pending_action: null });
  return {
    english: `Something went wrong. Type *health card* to start over.`,
    marathi: `काहीतरी चुकले. पुन्हा सुरू करण्यासाठी *health card* टाइप करा.`,
    hindi: `कुछ गलत हुआ। फिर से शुरू करने के लिए *health card* लिखें.`,
  }[lang];
}

const FIELD_TO_STATE = {
  blood_group: 'health_card_update_blood_group',
  allergies: 'health_card_update_allergies',
  major_illnesses: 'health_card_update_illnesses',
  surgeries: 'health_card_update_surgeries',
  medical_history: 'health_card_update_history',
};

const FIELD_QUESTIONS = {
  blood_group: {
    english: `What is the new *blood group*? (e.g., B+, O-, AB+)`,
    marathi: `नवीन *blood group* काय आहे? (उदा. B+, O-, AB+)`,
    hindi:   `नया *blood group* क्या है? (जैसे B+, O-, AB+)`,
  },
  allergies: {
    english: `Which *allergy* would you like to add? (e.g., Penicillin, Peanuts)`,
    marathi: `कोणती *allergy* add करायची आहे? (उदा. Penicillin, Peanuts)`,
    hindi:   `कौन सी *allergy* add करनी है? (जैसे Penicillin, Peanuts)`,
  },
  major_illnesses: {
    english: `Which *illness* would you like to add? (e.g., Thyroid, Arthritis)`,
    marathi: `कोणता *आजार* add करायचा आहे? (उदा. Thyroid, Arthritis)`,
    hindi:   `कौन सी *बीमारी* add करनी है? (जैसे Thyroid, Arthritis)`,
  },
  surgeries: {
    english: `Which *surgery* would you like to add? Include year if known (e.g., Hip replacement 2023)`,
    marathi: `कोणती *शस्त्रक्रिया* add करायची आहे? शक्य असल्यास वर्षासह (उदा. Hip replacement 2023)`,
    hindi:   `कौन सी *surgery* add करनी है? साल के साथ हो तो (जैसे Hip replacement 2023)`,
  },
  medical_history: {
    english: `What would you like to update in *medical history*?`,
    marathi: `*वैद्यकीय इतिहासात* काय बदलायचे आहे?`,
    hindi:   `*medical history* में क्या बदलना है?`,
  },
};

export async function startHealthCardFieldUpdate(accountPhone, fieldName, lang) {
  const state = FIELD_TO_STATE[fieldName];
  if (!state) return null;
  await updateAccount(accountPhone, { pending_action: state });
  return FIELD_QUESTIONS[fieldName][lang] || FIELD_QUESTIONS[fieldName].english;
}

export async function handleHealthCardUpdate(account, messageText, lang, recipient) {
  const { pending_action, account_phone } = account;
  const input = messageText.trim().slice(0, 500);
  const isSkip = SKIP_RE.test(input);

  if (pending_action === 'health_card_update_blood_group') {
    await updateAccount(account_phone, { pending_action: null });
    if (isSkip) {
      return {
        english: `Blood group not changed.`,
        marathi: `Blood group बदललेला नाही.`,
        hindi:   `Blood group नहीं बदला.`,
      }[lang];
    }
    const normalised = input.toUpperCase().replace(/\s+/g, '');
    if (!VALID_BLOOD_GROUPS.has(normalised)) {
      return {
        english: `Please enter a valid blood group (e.g., A+, B-, O+, AB+).`,
        marathi: `कृपया valid blood group टाका (उदा. A+, B-, O+, AB+).`,
        hindi:   `कृपया valid blood group डालें (जैसे A+, B-, O+, AB+).`,
      }[lang];
    }
    await updateCareRecipient(account_phone, { blood_group: normalised });
    return {
      english: `✅ Blood group updated to *${normalised}*.`,
      marathi: `✅ Blood group *${normalised}* वर update झाला.`,
      hindi:   `✅ Blood group *${normalised}* हो गया.`,
    }[lang];
  }

  if (pending_action === 'health_card_update_allergies') {
    await updateAccount(account_phone, { pending_action: null });
    if (isSkip) return { english: 'No changes made.', marathi: 'बदल नाही.', hindi: 'कोई बदलाव नहीं.' }[lang];
    const newItems = input.split(/,|\n/).map(s => s.trim()).filter(Boolean).slice(0, 10);
    const existing = recipient?.allergies || [];
    const merged = [...existing, ...newItems.map(name => ({ type: 'other', name: name.slice(0, 100) }))];
    await updateCareRecipient(account_phone, { allergies: merged });
    const added = newItems.join(', ');
    return {
      english: `✅ Added *${added}* to your allergies.`,
      marathi: `✅ *${added}* allergies मध्ये add केले.`,
      hindi:   `✅ *${added}* allergies में add हो गया.`,
    }[lang];
  }

  if (pending_action === 'health_card_update_illnesses') {
    await updateAccount(account_phone, { pending_action: null });
    if (isSkip) return { english: 'No changes made.', marathi: 'बदल नाही.', hindi: 'कोई बदलाव नहीं.' }[lang];
    const newItems = input.split(/,|\n/).map(s => s.trim()).filter(Boolean).slice(0, 10);
    const existing = recipient?.major_illnesses || [];
    await updateCareRecipient(account_phone, { major_illnesses: [...existing, ...newItems] });
    return {
      english: `✅ Added *${newItems.join(', ')}* to your major illnesses.`,
      marathi: `✅ *${newItems.join(', ')}* प्रमुख आजारांमध्ये add केले.`,
      hindi:   `✅ *${newItems.join(', ')}* बड़ी बीमारियों में add हो गया.`,
    }[lang];
  }

  if (pending_action === 'health_card_update_surgeries') {
    await updateAccount(account_phone, { pending_action: null });
    if (isSkip) return { english: 'No changes made.', marathi: 'बदल नाही.', hindi: 'कोई बदलाव नहीं.' }[lang];
    const newItems = input.split(/,|\n/).map(s => s.trim()).filter(Boolean).slice(0, 10);
    const newSurgeries = newItems.map(item => {
      const yearMatch = item.match(/\b(19|20)\d{2}\b/);
      const date = yearMatch ? yearMatch[0] : null;
      const name = item.replace(/\b(19|20)\d{2}\b/, '').trim().replace(/\s+/g, ' ') || item;
      return { name: name.slice(0, 150), date };
    });
    const existing = recipient?.surgeries || [];
    await updateCareRecipient(account_phone, { surgeries: [...existing, ...newSurgeries] });
    return {
      english: `✅ Added *${newItems.join(', ')}* to your surgeries.`,
      marathi: `✅ *${newItems.join(', ')}* शस्त्रक्रियांमध्ये add केले.`,
      hindi:   `✅ *${newItems.join(', ')}* surgeries में add हो गया.`,
    }[lang];
  }

  if (pending_action === 'health_card_update_history') {
    await updateAccount(account_phone, { pending_action: null });
    if (isSkip) return { english: 'No changes made.', marathi: 'बदल नाही.', hindi: 'कोई बदलाव नहीं.' }[lang];
    await updateCareRecipient(account_phone, { medical_history: input.slice(0, 500) });
    return {
      english: `✅ Medical history updated.`,
      marathi: `✅ वैद्यकीय इतिहास update झाला.`,
      hindi:   `✅ Medical history update हो गई.`,
    }[lang];
  }

  // Unknown update state — reset
  await updateAccount(account_phone, { pending_action: null });
  return {
    english: `Something went wrong. Please try again.`,
    marathi: `काहीतरी चुकले. पुन्हा प्रयत्न करा.`,
    hindi:   `कुछ गलत हुआ। फिर कोशिश करें.`,
  }[lang];
}

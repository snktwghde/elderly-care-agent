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

export async function sendHealthCardOffer(phone, lang, isSelf = true, recipientName = '') {
  const whose = isSelf ? 'your' : `${recipientName}'s`;
  const subject = isSelf ? 'you' : recipientName;
  const msg = {
    english: `Would you like to set up ${whose} health card?\n\nDoctors often ask for current medications and medical history during visits — this lets ${subject} share it instantly. (Takes about 5 minutes)\n\nReply *Yes* to set up or *No* to skip for now.`,
    marathi: isSelf
      ? `तुमचे health card सेट करायचे आहे का?\n\nडॉक्टरांना visit दरम्यान नेहमी medications आणि medical history विचारावी लागते — health card असल्यास ते लगेच share करता येते. (सुमारे 5 मिनिटे)\n\n*हो* म्हणा सेट करण्यासाठी किंवा *नको* म्हणा नंतरसाठी.`
      : `${recipientName} यांचे health card सेट करायचे आहे का?\n\nडॉक्टरांना visit दरम्यान नेहमी medications आणि medical history विचारावी लागते — health card असल्यास ते लगेच share करता येते. (सुमारे 5 मिनिटे)\n\n*हो* म्हणा सेट करण्यासाठी किंवा *नको* म्हणा नंतरसाठी.`,
    hindi: isSelf
      ? `क्या आप अपना health card सेट करना चाहते हैं?\n\nDoctors visit के दौरान हमेशा medications और medical history पूछते हैं — health card होने से वो तुरंत share होती है. (लगभग 5 मिनट)\n\n*हाँ* कहें सेट करने के लिए या *नहीं* बाद के लिए.`
      : `क्या आप ${recipientName} का health card सेट करना चाहते हैं?\n\nDoctors visit के दौरान हमेशा medications और medical history पूछते हैं — health card होने से वो तुरंत share होती है. (लगभग 5 मिनट)\n\n*हाँ* कहें सेट करने के लिए या *नहीं* बाद के लिए.`,
  }[lang] || `Would you like to set up ${whose} health card?\n\nDoctors often ask for current medications and medical history during visits — this lets ${subject} share it instantly. (Takes about 5 minutes)\n\nReply *Yes* to set up or *No* to skip for now.`;

  await updateAccount(phone, { pending_action: 'health_card_offer_pending' });
  await sendTextMessage(phone, msg);
}

export async function startHealthCardSetup(accountPhone, lang, isSelf = true, recipientName = '') {
  await updateAccount(accountPhone, { pending_action: 'health_card_blood_group' });
  const whose = isSelf ? 'your' : `${recipientName}'s`;
  return {
    english: `Let's set up ${whose} health card.\n\nWhat is ${isSelf ? 'your' : `${recipientName}'s`} *blood group*? (e.g., B+, O-, AB+)\n\nType *skip* if unknown or to fill it later.`,
    marathi: isSelf
      ? `तुमचे health card सेट करूया.\n\nतुमचा *blood group* काय आहे? (उदा. B+, O-, AB+)\n\nमाहीत नसल्यास किंवा नंतर भरायचे असल्यास *skip* टाइप करा.`
      : `${recipientName} यांचे health card सेट करूया.\n\n${recipientName} यांचा *blood group* काय आहे? (उदा. B+, O-, AB+)\n\nमाहीत नसल्यास किंवा नंतर भरायचे असल्यास *skip* टाइप करा.`,
    hindi: isSelf
      ? `आपका health card सेट करते हैं.\n\nआपका *blood group* क्या है? (जैसे B+, O-, AB+)\n\nनहीं पता या बाद में भरना हो तो *skip* लिखें.`
      : `${recipientName} का health card सेट करते हैं.\n\n${recipientName} का *blood group* क्या है? (जैसे B+, O-, AB+)\n\nनहीं पता या बाद में भरना हो तो *skip* लिखें.`,
  }[lang];
}

const VALID_BLOOD_GROUPS = new Set(['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-', 'A1+', 'A1-', 'A1B+', 'A1B-']);
const SKIP_RE = /^(skip|don'?t know|nahi pata|pata nahi|माहीत नाही|पता नहीं|नाही|नको|नहीं)$/i;

export async function handleHealthCardSetup(account, messageText, lang, recipient) {
  const { pending_action, account_phone } = account;
  const input = messageText.trim().slice(0, 500);
  const isSkip = SKIP_RE.test(input);
  const isSelf = account.account_type === 'self';
  const rName = recipient?.recipient_name || 'them';

  // ── health_card_offer_pending ──────────────────────────────────────────────
  if (pending_action === 'health_card_offer_pending') {
    const isYes = /^(yes|हो|ho|haan|हाँ|ha|हा|ok|okay|हो\s*जी|हां|ho ja)$/i.test(input);

    if (isYes) return await startHealthCardSetup(account_phone, lang);

    await updateAccount(account_phone, { pending_action: 'health_card_declined_next_step' });
    return {
      english: `No problem. You can set it up later — just type *health card* anytime.\n\nWhat would you like to do next?\n\n1. Find a clinic\n2. Set medication reminder\n3. Set up health card`,
      marathi: `ठीक आहे. नंतर केव्हाही *health card* टाइप करा.\n\nपुढे काय करायचे आहे?\n\n1. Clinic शोधा\n2. औषध reminder सेट करा\n3. Health card सेट करा`,
      hindi: `कोई बात नहीं। बाद में कभी भी *health card* लिखें.\n\nआगे क्या करना है?\n\n1. Clinic खोजें\n2. दवाई reminder सेट करें\n3. Health card सेट करें`,
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
    await updateAccount(account_phone, { pending_action: 'health_card_current_meds' });
    return {
      english: `Got it!\n\nWhat *current medications* do ${isSelf ? 'you' : rName} take regularly? List the names separated by commas (e.g., Metformin, Amlodipine, Aspirin).\n\nType *skip* if none.`,
      marathi: isSelf
        ? `ठीक आहे!\n\nतुम्ही सध्या कोणती *औषधे* नियमित घेता? नावे स्वल्पविरामाने विभागून लिहा (उदा. Metformin, Amlodipine).\n\nनसल्यास *skip* टाइप करा.`
        : `ठीक आहे!\n\n${rName} सध्या कोणती *औषधे* नियमित घेतात? नावे स्वल्पविरामाने विभागून लिहा (उदा. Metformin, Amlodipine).\n\nनसल्यास *skip* टाइप करा.`,
      hindi: isSelf
        ? `ठीक है!\n\nआप अभी कौन सी *दवाइयाँ* नियमित लेते हैं? नाम comma से अलग करके लिखें (जैसे Metformin, Amlodipine).\n\nकोई नहीं तो *skip* लिखें.`
        : `ठीक है!\n\n${rName} अभी कौन सी *दवाइयाँ* नियमित लेते हैं? नाम comma से अलग करके लिखें (जैसे Metformin, Amlodipine).\n\nकोई नहीं तो *skip* लिखें.`,
    }[lang];
  }

  // ── health_card_current_meds ──────────────────────────────────────────────
  if (pending_action === 'health_card_current_meds') {
    if (!isSkip) {
      const items = input.split(/,|\n/).map(s => s.trim()).filter(Boolean).slice(0, 20);
      const newMeds = items.map(n => ({ name: n.slice(0, 100) }));
      const existing = recipient?.medication_schedule || [];
      await updateCareRecipient(account_phone, { medication_schedule: [...existing, ...newMeds] });
    }
    await updateAccount(account_phone, { pending_action: 'health_card_allergies' });
    return {
      english: `Got it!\n\nDo ${isSelf ? 'you' : rName} have any *allergies*? List them separated by commas (e.g., Penicillin, Peanuts, Dust).\n\nType *skip* if none.`,
      marathi: isSelf
        ? `ठीक आहे!\n\nतुम्हाला कोणती *allergies* आहेत का? स्वल्पविरामाने विभागून लिहा (उदा. Penicillin, Peanuts).\n\nनसल्यास *skip* टाइप करा.`
        : `ठीक आहे!\n\n${rName} यांना कोणती *allergies* आहेत का? स्वल्पविरामाने विभागून लिहा (उदा. Penicillin, Peanuts).\n\nनसल्यास *skip* टाइप करा.`,
      hindi: isSelf
        ? `ठीक है!\n\nक्या आपको कोई *allergies* हैं? उन्हें comma से अलग करके लिखें (जैसे Penicillin, Peanuts).\n\n*skip* लिखें अगर कोई नहीं.`
        : `ठीक है!\n\nक्या ${rName} को कोई *allergies* हैं? उन्हें comma से अलग करके लिखें (जैसे Penicillin, Peanuts).\n\n*skip* लिखें अगर कोई नहीं.`,
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
      english: `Got it!\n\nDo ${isSelf ? 'you' : rName} have any *major illnesses*? (e.g., Diabetes, High blood pressure, Asthma)\n\nType *skip* if none.`,
      marathi: isSelf
        ? `ठीक आहे!\n\nतुम्हाला कोणते *प्रमुख आजार* आहेत का? (उदा. Diabetes, High blood pressure, Asthma)\n\nनसल्यास *skip* टाइप करा.`
        : `ठीक आहे!\n\n${rName} यांना कोणते *प्रमुख आजार* आहेत का? (उदा. Diabetes, High blood pressure, Asthma)\n\nनसल्यास *skip* टाइप करा.`,
      hindi: isSelf
        ? `ठीक है!\n\nक्या आपको कोई *बड़ी बीमारियाँ* हैं? (जैसे Diabetes, High blood pressure, Asthma)\n\n*skip* लिखें अगर कोई नहीं.`
        : `ठीक है!\n\nक्या ${rName} को कोई *बड़ी बीमारियाँ* हैं? (जैसे Diabetes, High blood pressure, Asthma)\n\n*skip* लिखें अगर कोई नहीं.`,
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
      english: `Got it!\n\nHave ${isSelf ? 'you' : rName} had any *surgeries*? List them with year if known (e.g., Appendix removal 2019, Cataract surgery 2022).\n\nType *skip* if none.`,
      marathi: isSelf
        ? `ठीक आहे!\n\nतुम्हाला कोणत्या *शस्त्रक्रिया* झाल्या आहेत का? शक्य असल्यास वर्षासह लिहा (उदा. Appendix removal 2019).\n\nनसल्यास *skip* टाइप करा.`
        : `ठीक आहे!\n\n${rName} यांना कोणत्या *शस्त्रक्रिया* झाल्या आहेत का? शक्य असल्यास वर्षासह लिहा (उदा. Appendix removal 2019).\n\nनसल्यास *skip* टाइप करा.`,
      hindi: isSelf
        ? `ठीक है!\n\nआपकी कोई *surgeries* हुई हैं? हो सके तो साल के साथ लिखें (जैसे Appendix removal 2019).\n\n*skip* लिखें अगर कोई नहीं.`
        : `ठीक है!\n\n${rName} की कोई *surgeries* हुई हैं? हो सके तो साल के साथ लिखें (जैसे Appendix removal 2019).\n\n*skip* लिखें अगर कोई नहीं.`,
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
      english: `Almost done!\n\nIs there any other *medical history* to add for ${isSelf ? 'you' : rName}? (e.g., family history of heart disease, past hospitalisations)\n\nType *skip* to finish.`,
      marathi: isSelf
        ? `जवळजवळ झाले!\n\nइतर *वैद्यकीय इतिहास* काही सांगायचे आहे का? (उदा. कुटुंबात हृदयरोगाचा इतिहास)\n\nसंपवायचे असल्यास *skip* टाइप करा.`
        : `जवळजवळ झाले!\n\n${rName} यांचा इतर *वैद्यकीय इतिहास* काही सांगायचे आहे का? (उदा. कुटुंबात हृदयरोगाचा इतिहास)\n\nसंपवायचे असल्यास *skip* टाइप करा.`,
      hindi: isSelf
        ? `लगभग हो गया!\n\nकोई और *medical history* बताना है? (जैसे परिवार में दिल की बीमारी, पुराने hospitalisations)\n\nखत्म करने के लिए *skip* लिखें.`
        : `लगभग हो गया!\n\n${rName} की कोई और *medical history* बताना है? (जैसे परिवार में दिल की बीमारी, पुराने hospitalisations)\n\nखत्म करने के लिए *skip* लिखें.`,
    }[lang];
  }

  // ── health_card_history ───────────────────────────────────────────────────
  if (pending_action === 'health_card_history') {
    if (!isSkip) {
      await updateCareRecipient(account_phone, { medical_history: input.slice(0, 500) });
    }
    await updateAccount(account_phone, { pending_action: null });
    return {
      english: `✅ Health card saved!\n\nType *health card* anytime to see it. During an SOS, it will be sent automatically to your family.\n\nWhat's next: say *find doctor* to locate a nearby clinic, or *set medication reminders* to set medicine reminders.`,
      marathi: `✅ Health card जतन झाले!\n\nकेव्हाही *health card* टाइप करा पाहण्यासाठी. SOS वेळी ते आपोआप कुटुंबाला पाठवले जाईल.\n\nपुढे काय: जवळचे clinic शोधण्यासाठी *find doctor* म्हणा, किंवा औषध reminders साठी *set medication reminders* म्हणा.`,
      hindi: `✅ Health card सेव हो गया!\n\nकभी भी *health card* लिखें देखने के लिए। SOS के समय यह automatically परिवार को भेजा जाएगा.\n\nआगे क्या: नज़दीकी clinic खोजने के लिए *find doctor* कहें, या दवाई reminders के लिए *set medication reminders* लिखें.`,
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
  const isSelf = account.account_type === 'self';
  const rName = recipient?.recipient_name || 'them';

  if (pending_action === 'health_card_update_blood_group') {
    if (isSkip) {
      await updateAccount(account_phone, { pending_action: null });
      return {
        english: `Blood group not changed.`,
        marathi: `Blood group बदललेला नाही.`,
        hindi:   `Blood group नहीं बदला.`,
      }[lang];
    }
    const normalised = input.toUpperCase().replace(/\s+/g, '');
    if (!VALID_BLOOD_GROUPS.has(normalised)) {
      // Leave pending_action intact so user can retry
      return {
        english: `Please enter a valid blood group (e.g., A+, B-, O+, AB+).`,
        marathi: `कृपया valid blood group टाका (उदा. A+, B-, O+, AB+).`,
        hindi:   `कृपया valid blood group डालें (जैसे A+, B-, O+, AB+).`,
      }[lang];
    }
    await updateAccount(account_phone, { pending_action: null });
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
      english: `✅ Added *${added}* to ${isSelf ? 'your' : `${rName}'s`} allergies.`,
      marathi: `✅ *${added}* ${isSelf ? '' : `${rName} यांच्या `}allergies मध्ये add केले.`,
      hindi:   `✅ *${added}* ${isSelf ? '' : `${rName} की `}allergies में add हो गया.`,
    }[lang];
  }

  if (pending_action === 'health_card_update_illnesses') {
    await updateAccount(account_phone, { pending_action: null });
    if (isSkip) return { english: 'No changes made.', marathi: 'बदल नाही.', hindi: 'कोई बदलाव नहीं.' }[lang];
    const newItems = input.split(/,|\n/).map(s => s.trim()).filter(Boolean).slice(0, 10);
    const existing = recipient?.major_illnesses || [];
    await updateCareRecipient(account_phone, { major_illnesses: [...existing, ...newItems] });
    return {
      english: `✅ Added *${newItems.join(', ')}* to ${isSelf ? 'your' : `${rName}'s`} major illnesses.`,
      marathi: `✅ *${newItems.join(', ')}* ${isSelf ? '' : `${rName} यांच्या `}प्रमुख आजारांमध्ये add केले.`,
      hindi:   `✅ *${newItems.join(', ')}* ${isSelf ? '' : `${rName} की `}बड़ी बीमारियों में add हो गया.`,
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
      english: `✅ Added *${newItems.join(', ')}* to ${isSelf ? 'your' : `${rName}'s`} surgeries.`,
      marathi: `✅ *${newItems.join(', ')}* ${isSelf ? '' : `${rName} यांच्या `}शस्त्रक्रियांमध्ये add केले.`,
      hindi:   `✅ *${newItems.join(', ')}* ${isSelf ? '' : `${rName} की `}surgeries में add हो गया.`,
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

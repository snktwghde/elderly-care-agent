import { updateCareRecipient, getPrimaryCareRecipient } from './supabase.js';

const MAX_PATTERNS = 5;
const LANGUAGE_UPDATE_INTERVAL_MS = 60 * 60 * 1000; // 1 hour

export function extractBaseName(medicineName) {
  return medicineName.replace(/\d+\s*(mg|ml|mcg|g|iu|units?)\b/gi, '').trim().toLowerCase();
}

export function getInsights(recipient) {
  return recipient?.user_insights || {};
}

export function buildInsightSystemPrompt(insights) {
  if (!insights || Object.keys(insights).length === 0) return '';

  const lines = [];

  if (insights.preferred_language) {
    lines.push(`User's preferred language: ${insights.preferred_language}`);
  }

  const p = insights.message_patterns || {};
  const vocab = [];
  if (p.affirmative?.length) vocab.push(`"${p.affirmative.join('", "')}" means yes/confirm`);
  if (p.negative?.length) vocab.push(`"${p.negative.join('", "')}" means no/cancel`);
  if (p.book_appointment?.length) vocab.push(`"${p.book_appointment.join('", "')}" means book appointment`);
  if (p.sos?.length) vocab.push(`"${p.sos.join('", "')}" means emergency`);
  if (vocab.length) {
    lines.push(`This user's vocabulary (always recognise as valid): ${vocab.join('; ')}`);
  }

  if (lines.length === 0) return '';
  return `\n\nUser-specific context (learned):\n${lines.join('\n')}\nNever ask user to rephrase if they use any of the above words.`;
}

export async function updateClinicInsight(accountPhone, clinic) {
  try {
    const recipient = await getPrimaryCareRecipient(accountPhone);
    if (!recipient) return;

    const insights = recipient.user_insights || {};
    const history = insights.clinic_history || [];
    const existing = history.find(c => c.name === clinic.name);

    const updatedHistory = existing
      ? history.map(c => c.name === clinic.name ? { ...c, count: c.count + 1 } : c)
      : [...history, { name: clinic.name, phone: clinic.phone || null, address: clinic.address || null, count: 1 }];

    await updateCareRecipient(accountPhone, {
      user_insights: { ...insights, clinic_history: updatedHistory },
    });
  } catch (e) {
    console.error('updateClinicInsight failed:', e.message);
  }
}

export async function updateMedicationInsight(accountPhone, medicationSchedule) {
  try {
    const recipient = await getPrimaryCareRecipient(accountPhone);
    if (!recipient) return;

    const insights = recipient.user_insights || {};
    await updateCareRecipient(accountPhone, {
      user_insights: { ...insights, active_medications: medicationSchedule.map(m => m.name) },
    });
  } catch (e) {
    console.error('updateMedicationInsight failed:', e.message);
  }
}

export async function removeMedicationFromInsight(accountPhone, baseNameToRemove) {
  try {
    const recipient = await getPrimaryCareRecipient(accountPhone);
    if (!recipient) return recipient;

    const insights = recipient.user_insights || {};
    const updatedMeds = (insights.active_medications || []).filter(
      m => extractBaseName(m) !== baseNameToRemove
    );
    await updateCareRecipient(accountPhone, {
      user_insights: { ...insights, active_medications: updatedMeds },
    });
    return recipient;
  } catch (e) {
    console.error('removeMedicationFromInsight failed:', e.message);
    return null;
  }
}

export async function updateLanguageInsight(accountPhone, detectedLanguage) {
  try {
    if (!detectedLanguage || detectedLanguage === 'unknown' || detectedLanguage === 'mixed') return;

    const recipient = await getPrimaryCareRecipient(accountPhone);
    if (!recipient) return;

    const insights = recipient.user_insights || {};
    if (insights.last_analyzed) {
      const elapsed = Date.now() - new Date(insights.last_analyzed).getTime();
      if (elapsed < LANGUAGE_UPDATE_INTERVAL_MS) return;
    }

    await updateCareRecipient(accountPhone, {
      user_insights: {
        ...insights,
        preferred_language: detectedLanguage,
        last_analyzed: new Date().toISOString(),
      },
    });
  } catch (e) {
    console.error('updateLanguageInsight failed:', e.message);
  }
}

export async function updateMessagePattern(accountPhone, messageText, intent) {
  try {
    const TRACKED = ['book_appointment', 'sos'];
    if (!intent || !TRACKED.includes(intent)) return;

    const phrase = messageText.trim().toLowerCase().slice(0, 50);
    if (!phrase) return;

    const recipient = await getPrimaryCareRecipient(accountPhone);
    if (!recipient) return;

    const insights = recipient.user_insights || {};
    const patterns = insights.message_patterns || {};
    const existing = patterns[intent] || [];
    if (existing.includes(phrase)) return;

    await updateCareRecipient(accountPhone, {
      user_insights: {
        ...insights,
        message_patterns: { ...patterns, [intent]: [...existing, phrase].slice(-MAX_PATTERNS) },
      },
    });
  } catch (e) {
    console.error('updateMessagePattern failed:', e.message);
  }
}

export async function updateAffirmativePattern(accountPhone, phrase) {
  try {
    const normalised = phrase.trim().toLowerCase().slice(0, 30);
    if (!normalised) return;

    const recipient = await getPrimaryCareRecipient(accountPhone);
    if (!recipient) return;

    const insights = recipient.user_insights || {};
    const patterns = insights.message_patterns || {};
    const existing = patterns.affirmative || [];
    if (existing.includes(normalised)) return;

    await updateCareRecipient(accountPhone, {
      user_insights: {
        ...insights,
        message_patterns: { ...patterns, affirmative: [...existing, normalised].slice(-MAX_PATTERNS) },
      },
    });
  } catch (e) {
    console.error('updateAffirmativePattern failed:', e.message);
  }
}

export async function updateNegativePattern(accountPhone, phrase) {
  try {
    const normalised = phrase.trim().toLowerCase().slice(0, 30);
    if (!normalised) return;

    const recipient = await getPrimaryCareRecipient(accountPhone);
    if (!recipient) return;

    const insights = recipient.user_insights || {};
    const patterns = insights.message_patterns || {};
    const existing = patterns.negative || [];
    if (existing.includes(normalised)) return;

    await updateCareRecipient(accountPhone, {
      user_insights: {
        ...insights,
        message_patterns: { ...patterns, negative: [...existing, normalised].slice(-MAX_PATTERNS) },
      },
    });
  } catch (e) {
    console.error('updateNegativePattern failed:', e.message);
  }
}

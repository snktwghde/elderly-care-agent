import Anthropic from '@anthropic-ai/sdk';
import { config } from '../config/env.js';
import { buildInsightSystemPrompt } from './intelligence.js';

const anthropic = new Anthropic({ apiKey: config.anthropic.apiKey });

const SYSTEM_PROMPT = `You are a WhatsApp message parser for CareProxy, an elderly care agent in India.

Parse the incoming WhatsApp message and return ONLY valid JSON with this shape:
{
  "intent": "<one of: book_appointment | confirm_appointment | medication_reminder | view_medicines | sos | setup_health_card | show_health_card | update_health_card | unknown>",
  "language": "<one of: hindi | marathi | english | mixed>",
  "confidence": "<one of: high | medium | low>",
  "details": {
    "appointment_type": "<one of: gp | specialist | null — gp if general clinic visit, specialist only if user explicitly mentions eye/heart/bone/skin/etc., null if unclear>",
    "specialty": "<specialist type if appointment_type is specialist, else null>",
    "doctor_name": "<doctor name if mentioned, else null>",
    "date_hint": "<date or time hint if mentioned, else null>",
    "medication_name": "<medication if mentioned, else null>",
    "health_card_field": "<blood_group|allergies|major_illnesses|surgeries|medical_history|null — which field the user wants to update>",
    "health_card_value": "<the new value if user stated it, else null>"
  }
}

Common Indian phrases to recognise:

Book appointment (gp — general clinic visit):
- English: "doctor appointment", "clinic appointment", "need to see the doctor", "need to see a doctor", "book a doctor"
- Marathi (Devanagari): "डॉक्टरकडे जायचं आहे", "डॉक्टरची अपॉइंटमेंट हवी आहे"
- Marathi (Latin): "doctor appointment pahije", "appointment book kara", "doctor kade jayche aahe"
- Hindi: "doctor appointment chahiye", "doctor ko dikhana hai", "doctor bulao", "appointment book karo"

Book appointment (specialist — only when explicitly stated):
- "eye doctor", "bone doctor", "heart doctor", "skin doctor", "netra doctor"
- "डोळ्यांचे डॉक्टर", "हाडांचे डॉक्टर"
- "aankh ka doctor", "haddi ka doctor"

SOS: "help", "emergency", "madad", "bachao", "ambulance", "mala madad kara", "मला मदत करा", "मदत करो"
Medication: "medicine", "dawai", "tablet", "reminder", "reminders", "aushadh", "औषध", "दवाई"
Confirm appointment (user reporting they booked it themselves):
- "appointment book zali", "appointment fixed", "appointment confirm zali", "appointment ho gaya"
- "I booked", "booked the appointment", "doctor ne time dila", "appointment milali"
- Hindi: "appointment book ho gayi", "doctor ne appointment diya"

View medicines (user wants to see their current medicine list and schedule):
- English: "my medicines", "show medicines", "view medicines", "what medicines", "current medicines", "medicine list", "show my medicines"
- Marathi: "mazi aushadhe", "aushadhe dakhav", "kiti aushadhe gheto", "औषधे दाखव"
- Hindi: "meri dawai", "dawai dikhao", "kaun si dawai", "meri davaiyaan", "कौन सी दवाई"

Status: "status", "confirm", "appointment hua", "appointment zali ka", "appointment confirmed"

Health card — show (user wants to see their health card):
- English: "health card", "medical card", "show health card", "show my health card", "medical summary", "my medical info"
- Marathi: "health card dakhav", "maza health card", "health card pahije", "medical card"
- Hindi: "health card dikhao", "medical card bhejo", "mera health card dikhao", "medical summary chahiye"

Health card — setup (user wants to create/set up their health card):
- "set up health card", "create health card", "setup health card", "health card banao"
- "health card setup karo", "health card bana"

Health card — update (user wants to update a specific field):
- "update blood group", "change blood group", "add allergy", "new allergy", "add surgery", "surgery add karo"
- "update medical history", "add illness", "blood group update karo", "allergy add karo"
- Set health_card_field to: blood_group | allergies | major_illnesses | surgeries | medical_history
- Set health_card_value to the stated value if mentioned (e.g., "update blood group to B+" → health_card_field: "blood_group", health_card_value: "B+")

Language detection rules:
- "marathi" if Devanagari Marathi script OR Latin words: "kara", "ahe", "aahe", "mala", "tumi", "zali", "zale", "pahije", "aahe"
- "hindi" if Hindi words: "karo", "hai", "hain", "mujhe", "chahiye", "kar do", "kya hua"
- "english" if primarily English
- "mixed" only if genuinely mixed

Return ONLY the JSON object. No explanation, no markdown.`;

export async function classifyClinicSpeech(speechResult) {
  const message = await anthropic.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 100,
    messages: [{
      role: 'user',
      content: `Classify what a clinic receptionist just said during a phone call to book a doctor appointment.

Return ONLY valid JSON: {"intent": "<intent>", "details": "<date/time if mentioned, else null>"}

Intents:
- name_request: asked for patient name
- spell_request: asked to spell the name
- address_request: asked for address or location
- date_time_request: asked for preferred date or time
- slot_offered: offered a specific date/time slot
- confirmed: appointment is confirmed
- walk_in_only: only walk-in patients accepted, no phone booking
- rejected: cannot take appointment (full, closed, etc)
- greeting_only: just said hello, waiting for us to speak
- unknown: cannot determine

<clinic_speech>${String(speechResult).slice(0, 500)}</clinic_speech>`,
    }],
  });

  const raw = message.content[0].text.trim().replace(/^```json\s*/i, '').replace(/```$/, '').trim();
  try {
    return JSON.parse(raw);
  } catch {
    return { intent: 'unknown', details: null };
  }
}

export async function parseAppointmentDetails(messageText) {
  const today = new Date().toLocaleDateString('en-IN', {
    timeZone: 'Asia/Kolkata',
    weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
  });

  const message = await anthropic.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 150,
    messages: [{
      role: 'user',
      content: `Today is ${today} (IST, Pune, India). A user just confirmed a doctor appointment via WhatsApp. Extract the details.

Return ONLY valid JSON:
{"clinic_name":"<clinic or doctor name, or null>","date_display":"<e.g. Thursday, 26 June 2026>","time_display":"<e.g. 10:00 AM>","datetime_iso":"<UTC ISO e.g. 2026-06-26T04:30:00.000Z — IST is UTC+5:30>"}

If date or time cannot be determined, use null for those fields.
<user_message>${String(messageText).slice(0, 500)}</user_message>`,
    }],
  });

  const raw = message.content[0].text.trim().replace(/^```json\s*/i, '').replace(/```$/, '').trim();
  try {
    return JSON.parse(raw);
  } catch {
    return { clinic_name: null, date_display: null, time_display: null, datetime_iso: null };
  }
}

export async function parseIntent(messageText, conversationHistory = [], userInsights = null) {
  const safeText = String(messageText).slice(0, 500);

  // Format history as plain text — 2x cheaper than JSON per token cost rules
  const historyText = conversationHistory
    .map(msg => `${msg.role === 'user' ? 'User' : 'Assistant'}: ${String(msg.content).slice(0, 300)}`)
    .join('\n');

  const userContent = historyText
    ? `Previous conversation:\n${historyText}\n\n<user_message>${safeText}</user_message>`
    : `<user_message>${safeText}</user_message>`;

  const insightText = buildInsightSystemPrompt(userInsights);
  const systemBlocks = [
    { type: 'text', text: SYSTEM_PROMPT, cache_control: { type: 'ephemeral' } },
    ...(insightText ? [{ type: 'text', text: insightText }] : []),
  ];

  const message = await anthropic.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 200,
    system: systemBlocks,
    messages: [{ role: 'user', content: userContent }],
  });

  const raw = message.content[0].text.trim().replace(/^```json\s*/i, '').replace(/```$/,'').trim();

  try {
    return JSON.parse(raw);
  } catch {
    return {
      intent: 'unknown',
      language: 'unknown',
      confidence: 'low',
      details: { raw_message: messageText, parse_error: raw },
    };
  }
}

export async function parseIntentSafe(messageText, conversationHistory = [], userInsights = null) {
  try {
    return await parseIntent(messageText, conversationHistory, userInsights);
  } catch (e) {
    console.error('[Claude API error]', e.message);
    return { intent: 'unknown', language: 'unknown', confidence: 'low', details: {} };
  }
}

export async function reformatMedicalHistory(rawInput) {
  try {
    const message = await anthropic.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 200,
      messages: [{
        role: 'user',
        content: `Rewrite the following as a clean one or two sentence third-person medical summary. Keep it factual and concise. No preamble, no quotes, no explanation — just the summary.\n\n${String(rawInput).slice(0, 500)}`,
      }],
    });
    return message.content[0].text.trim().slice(0, 500);
  } catch {
    return String(rawInput).slice(0, 500);
  }
}

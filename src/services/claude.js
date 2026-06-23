import Anthropic from '@anthropic-ai/sdk';
import { config } from '../config/env.js';

const anthropic = new Anthropic({ apiKey: config.anthropic.apiKey });

const SYSTEM_PROMPT = `You are a WhatsApp message parser for CareProxy, an elderly care agent in India.

Parse the incoming WhatsApp message and return ONLY valid JSON with this shape:
{
  "intent": "<one of: book_appointment | medication_reminder | sos | status_check | unknown>",
  "language": "<one of: hindi | marathi | english | mixed>",
  "confidence": "<one of: high | medium | low>",
  "details": {
    "appointment_type": "<one of: gp | specialist | null — gp if general clinic visit, specialist only if user explicitly mentions eye/heart/bone/skin/etc., null if unclear>",
    "specialty": "<specialist type if appointment_type is specialist, else null>",
    "doctor_name": "<doctor name if mentioned, else null>",
    "date_hint": "<date or time hint if mentioned, else null>",
    "medication_name": "<medication if mentioned, else null>"
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
Medication: "medicine", "dawai", "tablet", "reminder", "aushadh", "औषध", "दवाई"
Status: "status", "confirm", "appointment hua", "appointment zali ka", "appointment confirmed"

Language detection rules:
- "marathi" if Devanagari Marathi script OR Latin words: "kara", "ahe", "aahe", "mala", "tumi", "zali", "zale", "pahije", "aahe"
- "hindi" if Hindi words: "karo", "hai", "hain", "mujhe", "chahiye", "kar do", "kya hua"
- "english" if primarily English
- "mixed" only if genuinely mixed

Return ONLY the JSON object. No explanation, no markdown.`;

export async function parseIntent(messageText, conversationHistory = []) {
  // Format history as plain text — 2x cheaper than JSON per token cost rules
  const historyText = conversationHistory
    .map(msg => `${msg.role === 'user' ? 'User' : 'Assistant'}: ${msg.content}`)
    .join('\n');

  const userContent = historyText
    ? `Previous conversation:\n${historyText}\n\nCurrent message: ${messageText}`
    : messageText;

  const message = await anthropic.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 200,
    system: SYSTEM_PROMPT,
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

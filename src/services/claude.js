import Anthropic from '@anthropic-ai/sdk';
import { config } from '../config/env.js';

const anthropic = new Anthropic({ apiKey: config.anthropic.apiKey });

const SYSTEM_PROMPT = `You are a WhatsApp message parser for CareProxy, an elderly care agent in India.

Parse the incoming WhatsApp message and return ONLY valid JSON with this shape:
{
  "intent": "<one of: book_appointment | medication_reminder | sos | status_check | onboarding | unknown>",
  "language": "<one of: hindi | marathi | english | mixed>",
  "confidence": "<one of: high | medium | low>",
  "details": {
    "specialty": "<medical specialty if mentioned, else null>",
    "doctor_name": "<doctor name if mentioned, else null>",
    "date_hint": "<date or time hint if mentioned, else null>",
    "medication_name": "<medication if mentioned, else null>",
    "raw_message": "<the original message>"
  }
}

Common Indian phrases to recognise:
- Book appointment: "doctor", "appointment", "clinic", "hospital", "daktar", "doctor bulao", "appointment book karo"
- SOS: "help", "emergency", "madad", "bachao", "ambulance"
- Medication: "medicine", "dawai", "tablet", "reminder", "bhool gaya"
- Status: "kya hua", "status", "confirm", "appointment hua"

Return ONLY the JSON object. No explanation, no markdown.`;

export async function parseIntent(messageText) {
  const message = await anthropic.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 512,
    system: SYSTEM_PROMPT,
    messages: [{ role: 'user', content: messageText }],
  });

  const raw = message.content[0].text.trim();

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

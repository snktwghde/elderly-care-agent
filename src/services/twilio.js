import twilio from 'twilio';
import { config } from '../config/env.js';

const client = twilio(config.twilio.accountSid, config.twilio.authToken);

export function normalizePhone(phone) {
  const digits = phone.replace(/\D/g, '');
  if (digits.startsWith('91') && digits.length === 12) return `+${digits}`;
  if (digits.length === 10) return `+91${digits}`;
  return `+${digits}`;
}

export function extractLocality(address) {
  const parts = address.split(',').map(p => p.trim());
  for (let i = parts.length - 1; i >= 0; i--) {
    const part = parts[i];
    if (/\d{6}/.test(part)) continue;    // contains PIN code
    if (/pune/i.test(part)) continue;    // contains city name
    if (/^\d/.test(part)) continue;      // starts with flat/building number
    return part;
  }
  return parts[0] || address;
}

export async function placeClinicCall(clinic, recipient, appointmentId, timePref = null) {
  const name = encodeURIComponent(recipient.recipient_name || '');
  const lang = recipient.preferred_language === 'hindi' ? 'hindi' : 'marathi';
  const locality = encodeURIComponent(extractLocality(recipient.home_address || ''));
  const accountPhone = encodeURIComponent(recipient.account_phone);
  const base = config.baseUrl;

  const rawTimeLabel = timePref?.marathi === 'any' || !timePref
    ? ''
    : (lang === 'hindi' ? timePref.hindi : timePref.marathi);
  const timeLabel = encodeURIComponent(rawTimeLabel);

  const voiceUrl = `${base}/webhook/twilio/voice?appointmentId=${appointmentId}&lang=${lang}&name=${name}&locality=${locality}&timeLabel=${timeLabel}`;
  const statusUrl = `${base}/webhook/twilio/status?appointmentId=${appointmentId}&accountPhone=${accountPhone}&lang=${lang}`;

  const call = await client.calls.create({
    to: clinic.phone,
    from: config.twilio.phoneNumber,
    url: voiceUrl,
    statusCallback: statusUrl,
    statusCallbackEvent: ['completed', 'no-answer', 'busy', 'failed'],
    statusCallbackMethod: 'POST',
    timeout: 30,
  });

  return call.sid;
}

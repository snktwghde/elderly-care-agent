import { Router } from 'express';
import twilio from 'twilio';
import { classifyClinicSpeech } from '../services/claude.js';
import { getAppointment, updateAppointment } from '../services/supabase.js';
import { sendTextMessage } from '../services/whatsapp.js';

const router = Router();
const { VoiceResponse } = twilio.twiml;

// ── Helpers ───────────────────────────────────────────────────────────────────

function voiceConfig(lang) {
  return lang === 'hindi'
    ? { language: 'hi-IN', voice: 'Google.hi-IN-Wavenet-A' }
    : { language: 'mr-IN', voice: 'Google.mr-IN-Wavenet-A' };
}

function openingScript(lang, name) {
  return lang === 'hindi'
    ? `Hello! ${name} ke liye doctor appointment chahiye thi. Ho sakta hai kya?`
    : `नमस्कार! ${name} यांच्यासाठी doctor appointment हवी होती. Appointment मिळेल का?`;
}

function noResponseScript(lang) {
  return lang === 'hindi'
    ? 'Sunai nahi diya. Phir try karenge.'
    : 'ऐकू आले नाही. पुन्हा try करतो.';
}

function buildGather(response, vc, lang, action) {
  return response.gather({
    input: 'speech',
    language: 'hi-IN',
    speechModel: 'phone_call',
    hints: 'naam, naav, naav kaay, spelling, spell kara, spell, patta, address, kuthe rahata, confirm, confirmed, okay, ho, naahi, nahi, appointment, doctor, walk in, direct, date, vel, time, kadhi, subah, sandhyakal, morning, evening, karvenagar, kothrud, vadgaon, pune, aao, aana, book, booked, full, band, patient, number, phone, hospital, clinic, available, nahi milnar, nahi milel',
    speechTimeout: 'auto',
    timeout: 10,
    action,
  });
}

// ── Fast keyword classifier — avoids Claude API call for common phrases ───────

function quickClassify(text) {
  const t = text.toLowerCase();
  if (/\b(spell|spelling)\b/.test(t)) return 'spell_request';
  if (/\b(naam|naav|nav|name|patient)\b/.test(t)) return 'name_request';
  if (/\b(patta|address|kuthe|rahata|rahatat|where)\b/.test(t)) return 'address_request';
  if (/\b(date|vel|veles|time|kiti|vajta|when|kadhi)\b/.test(t)) return 'date_time_request';
  if (/\b(walk.?in|walk in|yeu shak|direct(ly)?|seedha)\b/.test(t)) return 'walk_in_only';
  if (/\b(confirm|confirmed|book(ed)?|done|okay|ok|thik|theek|nakkī|nakki)\b/.test(t)) return 'confirmed';
  if (/\b(nahi|naahi|nako|no\b|band|full|full(y)? book)\b/.test(t)) return 'rejected';
  return null;
}

// ── Opening TwiML when clinic picks up ───────────────────────────────────────

router.post('/voice', (req, res) => {
  const { appointmentId, lang, name, locality, timeLabel } = req.query;
  const decodedName = name || '';
  const vc = voiceConfig(lang);
  const respondUrl = `/webhook/twilio/respond?appointmentId=${appointmentId}&lang=${lang}&name=${encodeURIComponent(name)}&locality=${encodeURIComponent(locality)}&timeLabel=${encodeURIComponent(timeLabel || '')}`;

  const response = new VoiceResponse();
  const gather = buildGather(response, vc, lang, respondUrl);
  gather.say(vc, openingScript(lang, decodedName));

  response.say(vc, noResponseScript(lang));
  response.hangup();

  res.type('text/xml');
  res.send(response.toString());
});

// ── Conversation turns ────────────────────────────────────────────────────────

router.post('/respond', async (req, res) => {
  const { appointmentId, lang, name, locality, timeLabel } = req.query;
  const speechResult = req.body?.SpeechResult || '';
  const decodedName = name || '';
  const decodedLocality = locality || '';
  const decodedTimeLabel = timeLabel || '';
  const vc = voiceConfig(lang);
  const respondUrl = `/webhook/twilio/respond?appointmentId=${appointmentId}&lang=${lang}&name=${encodeURIComponent(name)}&locality=${encodeURIComponent(locality)}&timeLabel=${encodeURIComponent(timeLabel || '')}`;

  const response = new VoiceResponse();
  let replyText = '';
  let endCall = false;
  let newStatus = null;
  let slotDetails = null;

  try {
    if (!speechResult) {
      replyText = lang === 'hindi'
        ? 'Maafi chahta hoon, sunai nahi diya. Kya aap phir se bol sakte hain?'
        : 'माफ करा, नीट ऐकू आले नाही. कृपया पुन्हा सांगा.';
    } else {
      const quickIntent = quickClassify(speechResult);
      const { intent, details } = quickIntent
        ? { intent: quickIntent, details: null }
        : await classifyClinicSpeech(speechResult);

      if (intent === 'name_request') {
        replyText = lang === 'hindi'
          ? `${decodedName} hai.`
          : `${decodedName} आहे नाव.`;
      } else if (intent === 'spell_request') {
        const spelled = decodedName.toUpperCase().split('').join(', ');
        replyText = lang === 'hindi'
          ? `${spelled}.`
          : `${spelled}.`;
      } else if (intent === 'address_request') {
        replyText = lang === 'hindi'
          ? `${decodedLocality}.`
          : `${decodedLocality}.`;
      } else if (intent === 'date_time_request') {
        if (decodedTimeLabel) {
          replyText = lang === 'hindi'
            ? `${decodedTimeLabel} mein milega kya?`
            : `${decodedTimeLabel} मध्ये मिळेल का?`;
        } else {
          replyText = lang === 'hindi'
            ? 'Jab bhi ho, chalega.'
            : 'जेव्हा जमेल तेव्हा चालेल.';
        }
      } else if (intent === 'slot_offered') {
        slotDetails = details;
        replyText = lang === 'hindi'
          ? `Haan theek hai${details ? ', ' + details : ''}. Confirm?`
          : `हो चालेल${details ? ', ' + details : ''}. Confirm झाले का?`;
      } else if (intent === 'confirmed') {
        slotDetails = details;
        replyText = lang === 'hindi'
          ? 'Shukriya! Aa jayenge.'
          : 'धन्यवाद! येतो.';
        endCall = true;
        newStatus = 'confirmed';
      } else if (intent === 'walk_in_only') {
        replyText = lang === 'hindi'
          ? 'Achha, theek hai. Shukriya.'
          : 'ठीक आहे, समजलं. धन्यवाद.';
        endCall = true;
        newStatus = 'walk_in_only';
      } else if (intent === 'rejected') {
        replyText = lang === 'hindi'
          ? 'Theek hai. Shukriya.'
          : 'ठीक आहे. धन्यवाद.';
        endCall = true;
        newStatus = 'failed';
      } else if (intent === 'greeting_only') {
        replyText = openingScript(lang, decodedName);
      } else {
        replyText = lang === 'hindi'
          ? 'Phir se boliye?'
          : 'पुन्हा सांगता का?';
      }
    }

    if (newStatus && appointmentId) {
      await updateAppointment(appointmentId, {
        status: newStatus,
        appointment_date: slotDetails || null,
      });
    }
  } catch (err) {
    console.error('Twilio respond error:', err.message);
    replyText = lang === 'hindi'
      ? 'Ek minute ruk kar baat karein.'
      : 'एक मिनिट थांबून बोला.';
  }

  if (endCall) {
    response.say(vc, replyText);
    response.hangup();
  } else {
    const gather = buildGather(response, vc, lang, respondUrl);
    gather.say(vc, replyText);
    response.say(vc, noResponseScript(lang));
    response.hangup();
  }

  res.type('text/xml');
  res.send(response.toString());
});

// ── Call status callback ──────────────────────────────────────────────────────

router.post('/status', async (req, res) => {
  res.sendStatus(200);

  const { appointmentId, lang } = req.query;
  const callStatus = req.body?.CallStatus;

  if (!appointmentId) return;

  try {
    const appointment = await getAppointment(appointmentId);
    if (!appointment) return;

    // Use DB-stored phone — never trust accountPhone from query params
    const accountPhone = appointment.account_phone;
    if (!accountPhone) return;

    if (callStatus === 'no-answer' || callStatus === 'busy') {
      await updateAppointment(appointmentId, { status: 'no_answer' });
      const msg = lang === 'hindi'
        ? `${appointment.clinic_name} ne call nahi uthaya. Seedha call karein:\n\n📞 ${appointment.clinic_phone}`
        : `${appointment.clinic_name} यांनी call उचलला नाही. थेट call करा:\n\n📞 ${appointment.clinic_phone}`;
      await sendTextMessage(accountPhone, msg);

    } else if (callStatus === 'failed') {
      await updateAppointment(appointmentId, { status: 'failed' });
      const msg = lang === 'hindi'
        ? `${appointment.clinic_name} se connect nahi ho saka. Seedha call karein:\n\n📞 ${appointment.clinic_phone}`
        : `${appointment.clinic_name} शी connection झाले नाही. थेट call करा:\n\n📞 ${appointment.clinic_phone}`;
      await sendTextMessage(accountPhone, msg);

    } else if (callStatus === 'completed') {
      const updated = await getAppointment(appointmentId);
      if (!updated) return;

      if (updated.status === 'confirmed') {
        const slot = updated.appointment_date ? ` — ${updated.appointment_date}` : '';
        const msg = lang === 'hindi'
          ? `✅ ${updated.clinic_name} mein appointment confirm ho gayi${slot}.\n\nAppointment se pehle reminder bhejenge.`
          : `✅ ${updated.clinic_name} मध्ये appointment confirm झाली${slot}.\n\nAppointment आधी reminder पाठवू.`;
        await sendTextMessage(accountPhone, msg);

      } else if (updated.status === 'walk_in_only') {
        const msg = lang === 'hindi'
          ? `${updated.clinic_name} sirf walk-in patients leta hai. Seedha visit karein.`
          : `${updated.clinic_name} फक्त walk-in patients घेतात. थेट जाऊन भेटा.`;
        await sendTextMessage(accountPhone, msg);

      } else if (updated.status === 'calling') {
        await updateAppointment(appointmentId, { status: 'failed' });
        const msg = lang === 'hindi'
          ? `${updated.clinic_name} se baat nahi ho payi. Dobara try karein ya seedha call karein:\n\n📞 ${updated.clinic_phone}`
          : `${updated.clinic_name} शी बोलणे झाले नाही. पुन्हा प्रयत्न करा किंवा थेट call करा:\n\n📞 ${updated.clinic_phone}`;
        await sendTextMessage(accountPhone, msg);
      }
    }
  } catch (err) {
    console.error('Twilio status callback error:', err.message);
  }
});

export default router;

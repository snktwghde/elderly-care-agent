import cron from 'node-cron';
import { getDueReminders, updateAppointment, getPrimaryCareRecipient, getMedicationSchedules, getMedicationLogToday, createMedicationLog, updateCareRecipient, updateAccount } from './supabase.js';
import { sendTextMessage, sendTemplateMessage } from './whatsapp.js';

function toWhatsAppPhone(phone) {
  return phone.startsWith('+') ? phone : `+${phone.replace(/\D/g, '')}`;
}

function hoursUntil(isoDatetime) {
  return (new Date(isoDatetime) - Date.now()) / 36e5;
}

// IST = UTC + 5:30
function toIST(isoDatetime) {
  return new Date(new Date(isoDatetime).getTime() + 5.5 * 3600000);
}

function marathiTime(isoDatetime) {
  const d = toIST(isoDatetime);
  const h = d.getUTCHours();
  const m = d.getUTCMinutes();
  const t = `${h % 12 || 12}${m ? ':' + String(m).padStart(2, '0') : ''}`;
  if (h < 12) return `सकाळी ${t} वाजता`;
  if (h < 17) return `दुपारी ${t} वाजता`;
  return `संध्याकाळी ${t} वाजता`;
}

function hindiTime(isoDatetime) {
  const d = toIST(isoDatetime);
  const h = d.getUTCHours();
  const m = d.getUTCMinutes();
  const t = `${h % 12 || 12}${m ? ':' + String(m).padStart(2, '0') : ''}`;
  if (h < 12) return `सुबह ${t} बजे`;
  if (h < 17) return `दोपहर ${t} बजे`;
  return `शाम ${t} बजे`;
}

function whenMarathi(isoDatetime) {
  const nowIST  = toIST(new Date().toISOString());
  const apptIST = toIST(isoDatetime);
  const diff = apptIST.getUTCDate() - nowIST.getUTCDate();
  if (diff <= 0) return 'आज';
  if (diff === 1) return 'उद्या';
  return 'लवकरच';
}

function whenHindi(isoDatetime) {
  const nowIST  = toIST(new Date().toISOString());
  const apptIST = toIST(isoDatetime);
  const diff = apptIST.getUTCDate() - nowIST.getUTCDate();
  if (diff <= 0) return 'आज';
  if (diff === 1) return 'कल';
  return 'जल्द ही';
}

async function processReminders() {
  const appointments = await getDueReminders();

  for (const appt of appointments) {
    const h = hoursUntil(appt.appointment_datetime);
    if (h < 0) continue;

    const recipient = await getPrimaryCareRecipient(appt.account_phone);
    if (!recipient) continue;

    const lang = recipient.preferred_language === 'hindi' ? 'hindi' : 'marathi';
    const userPhone = toWhatsAppPhone(appt.account_phone);
    const clinic = appt.clinic_name || 'Doctor';
    const dt     = appt.appointment_datetime;

    // Single reminder 1 hour before — sent only to the user, not family
    if (!appt.reminder_2h_sent && h >= 0.75 && h <= 1.25) {
      await updateAppointment(appt.id, { reminder_2h_sent: true });
      const mapsUrl = `https://maps.google.com/?q=${encodeURIComponent(appt.clinic_address || clinic)}`;
      const msg = lang === 'hindi'
        ? `⏰ Reminder: आपकी appointment 1 घंटे में है — ${hindiTime(dt)} ${clinic}।\n\n📍 ${mapsUrl}`
        : `⏰ Reminder: तुमची appointment 1 तासात आहे — ${marathiTime(dt)} ${clinic}.\n\n📍 ${mapsUrl}`;
      await sendTextMessage(userPhone, msg).catch(e => console.error(`Reminder failed to ${userPhone.slice(0, 5)}***:`, e.message));
    }
  }
}

function timeToMinutes(hhmm) {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
}

function currentISTTime() {
  const d = toIST(new Date().toISOString());
  return `${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')}`;
}

function currentISTDateStr() {
  const d = toIST(new Date().toISOString());
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
}

async function processMedicationReminders() {
  const recipients = await getMedicationSchedules();
  const current = currentISTTime();
  const todayStr = currentISTDateStr();

  for (const recipient of recipients) {
    const schedules = recipient.medication_schedule;
    if (!schedules?.length) continue;

    const lang = recipient.preferred_language === 'hindi' ? 'hindi' : 'marathi';
    const phone = toWhatsAppPhone(recipient.account_phone);

    // ─── Handle expired medicine courses ─────────────────────────────────────
    const expiredMeds = schedules.filter(s => s.end_date && todayStr >= s.end_date);
    if (expiredMeds.length > 0) {
      const kept = schedules.filter(s => !(s.end_date && todayStr >= s.end_date));
      await updateCareRecipient(recipient.account_phone, { medication_schedule: kept });
      const accountPhone = toWhatsAppPhone(recipient.account_phone);
      for (const expired of expiredMeds) {
        const msg = lang === 'hindi'
          ? `✅ *${expired.name}* का कोर्स पूरा हो गया — reminders बंद कर दिए।\n\nनई दवाई का reminder सेट करना है? *yes* या *skip* लिखें।`
          : `✅ *${expired.name}* चा कोर्स पूर्ण झाला — reminders थांबवले.\n\nनवीन औषधाचे reminder सेट करायचे आहे का? *yes* किंवा *skip* म्हणा.`;
        await sendTextMessage(accountPhone, msg).catch(e => console.error(`Course complete msg failed to ${accountPhone.slice(0, 5)}***:`, e.message));
      }
      await updateAccount(recipient.account_phone, { pending_action: 'awaiting_post_course_response', pending_data: null });
    }

    // ─── Send due reminders for active medicines ──────────────────────────────
    for (let medIndex = 0; medIndex < schedules.length; medIndex++) {
      const schedule = schedules[medIndex];
      if (!schedule?.times?.length) continue;
      if (schedule.end_date && todayStr >= schedule.end_date) continue;

      for (let slot = 0; slot < schedule.times.length; slot++) {
        const diff = timeToMinutes(current) - timeToMinutes(schedule.times[slot]);
        if (diff < -2 || diff > 10) continue;

        const existing = await getMedicationLogToday(recipient.account_phone, medIndex, slot);
        if (existing) continue;

        // Mark sent BEFORE sending to prevent spam
        await createMedicationLog(recipient.account_phone, medIndex, slot);

        const langCode = lang === 'hindi' ? 'hi' : lang === 'english' ? 'en' : 'mr';
        await sendTemplateMessage(phone, 'medication_reminder', langCode, [schedule.name])
          .catch(e => console.error(`Medication reminder failed to ${phone.slice(0, 5)}***:`, e.message));
      }
    }
  }
}

export function startReminderScheduler() {
  cron.schedule('*/5 * * * *', async () => {
    try { await processReminders(); } catch (err) { console.error('Reminder error:', err.message); }
    try { await processMedicationReminders(); } catch (err) { console.error('Medication reminder error:', err.message); }
  });
}

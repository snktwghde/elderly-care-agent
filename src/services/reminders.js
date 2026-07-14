import cron from 'node-cron';
import { getDueReminders, updateAppointment, getPrimaryCareRecipient, getMedicationSchedules, getMedicationLogToday, createMedicationLog } from './supabase.js';
import { sendTextMessage } from './whatsapp.js';

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
    const userPhone = toWhatsAppPhone(recipient.recipient_phone || appt.account_phone);
    const clinic = appt.clinic_name || 'Doctor';
    const name   = recipient.recipient_name;
    const dt     = appt.appointment_datetime;

    // Single reminder 1 hour before — sent only to the user, not family
    if (!appt.reminder_2h_sent && h >= 0.75 && h <= 1.25) {
      await updateAppointment(appt.id, { reminder_2h_sent: true });
      const mapsUrl = `https://maps.google.com/?q=${encodeURIComponent(clinic + ', Pune')}`;
      const msg = lang === 'hindi'
        ? `⏰ Reminder: ${name} की appointment 1 घंटे में है — ${hindiTime(dt)} ${clinic}।\n\n📍 ${mapsUrl}`
        : `⏰ Reminder: ${name} यांची appointment 1 तासात आहे — ${marathiTime(dt)} ${clinic}.\n\n📍 ${mapsUrl}`;
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

async function processMedicationReminders() {
  const recipients = await getMedicationSchedules();
  const current = currentISTTime();

  for (const recipient of recipients) {
    const schedules = recipient.medication_schedule;
    if (!schedules?.length) continue;

    const lang = recipient.preferred_language === 'hindi' ? 'hindi' : 'marathi';
    const phone = toWhatsAppPhone(recipient.recipient_phone || recipient.account_phone);

    for (let medIndex = 0; medIndex < schedules.length; medIndex++) {
      const schedule = schedules[medIndex];
      if (!schedule?.times?.length) continue;

      for (let slot = 0; slot < schedule.times.length; slot++) {
        const diff = Math.abs(timeToMinutes(current) - timeToMinutes(schedule.times[slot]));
        if (diff > 2) continue;

        const existing = await getMedicationLogToday(recipient.account_phone, medIndex, slot);
        if (existing) continue;

        // Mark sent BEFORE sending to prevent spam
        await createMedicationLog(recipient.account_phone, medIndex, slot);

        const msg = lang === 'hindi'
          ? `💊 ${recipient.recipient_name} जी, *${schedule.name}* लेने का समय हो गया।\n\nलेने के बाद *Done* लिखें।`
          : `💊 ${recipient.recipient_name}, *${schedule.name}* घेण्याची वेळ झाली.\n\nघेतल्यावर *Done* म्हणा.`;

        await sendTextMessage(phone, msg).catch(e => console.error(`Medication reminder failed to ${phone.slice(0, 5)}***:`, e.message));
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

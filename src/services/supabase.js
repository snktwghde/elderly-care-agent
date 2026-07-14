import { createClient } from '@supabase/supabase-js';
import { config } from '../config/env.js';

const supabase = createClient(config.supabase.url, config.supabase.serviceKey);

// ─── Accounts ─────────────────────────────────────────────────────────────────

export async function getOrCreateAccount(accountPhone) {
  const { data: existing } = await supabase
    .from('accounts')
    .select('*')
    .eq('account_phone', accountPhone)
    .single();

  if (existing) return existing;

  const { data, error } = await supabase
    .from('accounts')
    .insert({ account_phone: accountPhone })
    .select()
    .single();

  if (error) throw new Error(`Failed to create account: ${error.message}`);
  return data;
}

export async function updateAccount(accountPhone, fields) {
  const { data, error } = await supabase
    .from('accounts')
    .update(fields)
    .eq('account_phone', accountPhone)
    .select()
    .single();

  if (error) throw new Error(`Failed to update account: ${error.message}`);
  return data;
}

// ─── Care Recipients ──────────────────────────────────────────────────────────

export async function getPrimaryCareRecipient(accountPhone) {
  const { data, error } = await supabase
    .from('care_recipients')
    .select('*')
    .eq('account_phone', accountPhone)
    .limit(1)
    .single();

  if (error) return null;
  return data;
}

export async function getCareRecipients(accountPhone) {
  const { data, error } = await supabase
    .from('care_recipients')
    .select('*')
    .eq('account_phone', accountPhone);

  if (error) throw new Error(`Failed to get care recipients: ${error.message}`);
  return data || [];
}

export async function upsertCareRecipient(recipient) {
  const { id, ...fields } = recipient;

  if (id) {
    const { data, error } = await supabase
      .from('care_recipients')
      .update(fields)
      .eq('id', id)
      .select()
      .single();
    if (error) throw new Error(`Failed to update care recipient: ${error.message}`);
    return data;
  }

  const { data, error } = await supabase
    .from('care_recipients')
    .insert(fields)
    .select()
    .single();
  if (error) throw new Error(`Failed to insert care recipient: ${error.message}`);
  return data;
}

// ─── Appointments ─────────────────────────────────────────────────────────────

export async function createAppointment(data) {
  const { data: record, error } = await supabase
    .from('appointments')
    .insert(data)
    .select()
    .single();

  if (error) throw new Error(`Failed to create appointment: ${error.message}`);
  return record;
}

export async function updateAppointment(id, fields) {
  const { data, error } = await supabase
    .from('appointments')
    .update(fields)
    .eq('id', id)
    .select()
    .single();

  if (error) throw new Error(`Failed to update appointment: ${error.message}`);
  return data;
}

export async function getDueReminders() {
  const { data, error } = await supabase
    .from('appointments')
    .select('*')
    .eq('status', 'confirmed')
    .not('appointment_datetime', 'is', null)
    .or('reminder_evening_sent.eq.false,reminder_2h_sent.eq.false');

  if (error) throw new Error(`Failed to get due reminders: ${error.message}`);
  return data || [];
}

export async function getAppointment(id) {
  const { data, error } = await supabase
    .from('appointments')
    .select('*')
    .eq('id', id)
    .single();

  if (error) return null;
  return data;
}

// ─── Care Recipient Updates ───────────────────────────────────────────────────

export async function updateCareRecipient(accountPhone, fields) {
  const { data, error } = await supabase
    .from('care_recipients')
    .update(fields)
    .eq('account_phone', accountPhone)
    .select()
    .single();
  if (error) throw new Error(`Failed to update care recipient: ${error.message}`);
  return data;
}

// ─── Medication Schedules ─────────────────────────────────────────────────────

export async function getMedicationSchedules() {
  const { data, error } = await supabase
    .from('care_recipients')
    .select('account_phone, recipient_phone, recipient_name, preferred_language, family_contacts, medication_schedule')
    .not('medication_schedule', 'is', null);
  if (error) throw new Error(`Failed to get medication schedules: ${error.message}`);
  return (data || []).filter(r => r.medication_schedule?.length > 0);
}

export async function getMedicationLogToday(accountPhone, medicineIndex, slot) {
  const today = new Date().toISOString().slice(0, 10);
  const { data } = await supabase
    .from('medication_logs')
    .select('id, acknowledged')
    .eq('account_phone', accountPhone)
    .eq('reminder_date', today)
    .eq('medicine_index', medicineIndex)
    .eq('slot', slot)
    .single();
  return data || null;
}

export async function createMedicationLog(accountPhone, medicineIndex, slot) {
  const today = new Date().toISOString().slice(0, 10);
  const { data, error } = await supabase
    .from('medication_logs')
    .insert({ account_phone: accountPhone, reminder_date: today, medicine_index: medicineIndex, slot })
    .select()
    .single();
  if (error) throw new Error(`Failed to create medication log: ${error.message}`);
  return data;
}

export async function acknowledgeMedicationLog(accountPhone) {
  const today = new Date().toISOString().slice(0, 10);
  const { data } = await supabase
    .from('medication_logs')
    .select('id')
    .eq('account_phone', accountPhone)
    .eq('reminder_date', today)
    .eq('acknowledged', false)
    .order('created_at', { ascending: false })
    .limit(1)
    .single();
  if (!data) return false;
  const { error } = await supabase.from('medication_logs').update({ acknowledged: true }).eq('id', data.id);
  if (error) throw new Error(`Failed to acknowledge medication log: ${error.message}`);
  return true;
}

// ─── Message Logs ────────────────────────────────────────────────────────────

export async function logMessage({ accountPhone, incomingMessage, parsedIntent, parsedLanguage, parsedConfidence, outgoingReply, error }) {
  await supabase.from('message_logs').insert({
    account_phone: accountPhone,
    incoming_message: incomingMessage?.slice(0, 1000),
    parsed_intent: parsedIntent || null,
    parsed_language: parsedLanguage || null,
    parsed_confidence: parsedConfidence || null,
    outgoing_reply: outgoingReply?.slice(0, 2000),
    error: error || null,
  });
}

export async function countUnknownIntentsLastHour(accountPhone) {
  const since = new Date(Date.now() - 60 * 60 * 1000).toISOString();
  const { count } = await supabase
    .from('message_logs')
    .select('*', { count: 'exact', head: true })
    .eq('account_phone', accountPhone)
    .eq('parsed_intent', 'unknown')
    .gte('created_at', since);
  return count || 0;
}

// ─── Clinic Cache ─────────────────────────────────────────────────────────────

export async function getCachedClinics(cacheKey) {
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
  const { data } = await supabase
    .from('clinic_cache')
    .select('clinics, next_page_token, lat, lng, keyword')
    .eq('cache_key', cacheKey)
    .gte('cached_at', sevenDaysAgo)
    .single();
  return data || null;
}

export async function cacheClinics(cacheKey, result) {
  await supabase.from('clinic_cache').upsert({
    cache_key: cacheKey,
    clinics: result.clinics,
    next_page_token: result.nextPageToken || null,
    lat: result.lat,
    lng: result.lng,
    keyword: result.keyword,
    cached_at: new Date().toISOString(),
  });
}

// ─── Conversation History ─────────────────────────────────────────────────────

export async function getConversationHistory(accountPhone, limit = 10) {
  const { data, error } = await supabase
    .from('conversation_history')
    .select('role, content')
    .eq('account_phone', accountPhone)
    .order('created_at', { ascending: false })
    .limit(limit);

  if (error) throw new Error(`Failed to get conversation history: ${error.message}`);
  return (data || []).reverse();
}

export async function saveMessage(accountPhone, role, content) {
  const { error } = await supabase
    .from('conversation_history')
    .insert({ account_phone: accountPhone, role, content });

  if (error) throw new Error(`Failed to save message: ${error.message}`);
}

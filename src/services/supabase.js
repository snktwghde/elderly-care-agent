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

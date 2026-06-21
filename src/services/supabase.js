import { createClient } from '@supabase/supabase-js';
import { config } from '../config/env.js';

const supabase = createClient(config.supabase.url, config.supabase.serviceKey);

export async function getUser(phone) {
  const { data, error } = await supabase
    .from('user_profile')
    .select('*')
    .eq('elderly_user_phone', phone)
    .single();

  if (error && error.code !== 'PGRST116') {
    throw new Error(`Supabase getUser failed: ${error.message}`);
  }
  return data;
}

export async function upsertUser(profile) {
  const { data, error } = await supabase
    .from('user_profile')
    .upsert(profile, { onConflict: 'elderly_user_phone' })
    .select()
    .single();

  if (error) {
    throw new Error(`Supabase upsertUser failed: ${error.message}`);
  }
  return data;
}

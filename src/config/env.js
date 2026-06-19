import 'dotenv/config';

const REQUIRED_VARS = [
  'WHATSAPP_TOKEN',
  'WHATSAPP_PHONE_ID',
  'WEBHOOK_VERIFY_TOKEN',
  'ANTHROPIC_API_KEY',
  'SUPABASE_URL',
  'SUPABASE_ANON_KEY',
];

const missing = REQUIRED_VARS.filter((key) => !process.env[key]);
if (missing.length > 0) {
  console.error('Missing required environment variables:', missing.join(', '));
  process.exit(1);
}

export const config = {
  port: process.env.PORT || 3000,
  whatsapp: {
    token: process.env.WHATSAPP_TOKEN,
    phoneId: process.env.WHATSAPP_PHONE_ID,
    verifyToken: process.env.WEBHOOK_VERIFY_TOKEN,
  },
  anthropic: {
    apiKey: process.env.ANTHROPIC_API_KEY,
  },
  supabase: {
    url: process.env.SUPABASE_URL,
    anonKey: process.env.SUPABASE_ANON_KEY,
  },
};

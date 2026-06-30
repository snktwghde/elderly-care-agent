import 'dotenv/config';

const REQUIRED_VARS = [
  'WHATSAPP_TOKEN',
  'WHATSAPP_PHONE_ID',
  'WEBHOOK_VERIFY_TOKEN',
  'META_APP_SECRET',
  'ANTHROPIC_API_KEY',
  'SUPABASE_URL',
  'SUPABASE_SERVICE_KEY',
  'GOOGLE_MAPS_API_KEY',
  'BASE_URL',
  'RAZORPAY_KEY_ID',
  'RAZORPAY_KEY_SECRET',
  'RAZORPAY_PLAN_ID',
  'RAZORPAY_WEBHOOK_SECRET',
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
    appSecret: process.env.META_APP_SECRET,
  },
  anthropic: {
    apiKey: process.env.ANTHROPIC_API_KEY,
  },
  supabase: {
    url: process.env.SUPABASE_URL,
    serviceKey: process.env.SUPABASE_SERVICE_KEY,
  },
  maps: {
    apiKey: process.env.GOOGLE_MAPS_API_KEY,
  },
  baseUrl: process.env.BASE_URL?.replace(/\/$/, ''),
  razorpay: {
    keyId: process.env.RAZORPAY_KEY_ID,
    keySecret: process.env.RAZORPAY_KEY_SECRET,
    planId: process.env.RAZORPAY_PLAN_ID,
  },
};

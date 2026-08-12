import './config/env.js';
import crypto from 'crypto';
import express from 'express';
import { rateLimit } from 'express-rate-limit';
import { config } from './config/env.js';
import whatsappWebhook from './webhook/whatsapp.js';
import razorpayRoutes from './routes/razorpay.js';
import { startReminderScheduler } from './services/reminders.js';

const app = express();
app.set('trust proxy', 1);

// Verify Meta webhook signature before parsing body
function verifyMetaSignature(req, res, buf) {
  if (req.method !== 'POST') return;
  const sig = req.get('x-hub-signature-256');
  if (!sig) {
    res.status(401).end();
    throw new Error('Missing X-Hub-Signature-256');
  }
  const expected = 'sha256=' + crypto
    .createHmac('sha256', config.whatsapp.appSecret)
    .update(buf)
    .digest('hex');
  if (!crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) {
    res.status(401).end();
    throw new Error('Invalid webhook signature');
  }
}

// Rate limit: 60 requests/min per IP on all webhook endpoints
const webhookLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 60,
  standardHeaders: true,
  legacyHeaders: false,
});

app.use('/webhook/razorpay', webhookLimiter, express.raw({ type: 'application/json' }));
app.use('/webhook', webhookLimiter, express.json({ verify: verifyMetaSignature }));
app.use(express.json());

app.get('/', (_req, res) => res.send('OK'));
app.get('/health', (_req, res) => res.json({ status: 'ok', service: 'CareProxy' }));

app.use('/webhook', whatsappWebhook);
app.use('/webhook/razorpay', razorpayRoutes);

app.listen(config.port, () => {
  console.log(`CareProxy running on port ${config.port}`);
  console.log(`Webhook URL: ${config.baseUrl}/webhook`);
  startReminderScheduler();
});

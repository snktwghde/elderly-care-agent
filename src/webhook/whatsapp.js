import { Router } from 'express';
import { config } from '../config/env.js';
import { parseIntent } from '../services/claude.js';
import { sendTextMessage } from '../services/whatsapp.js';

const router = Router();

// Meta webhook verification (one-time setup)
router.get('/', (req, res) => {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];

  if (mode === 'subscribe' && token === config.whatsapp.verifyToken) {
    console.log('Webhook verified by Meta');
    return res.status(200).send(challenge);
  }

  res.status(403).send('Forbidden');
});

// Incoming messages from WhatsApp
router.post('/', async (req, res) => {
  // Always respond 200 immediately — Meta retries if we don't
  res.status(200).send('OK');

  try {
    const entry = req.body?.entry?.[0];
    const change = entry?.changes?.[0];
    const value = change?.value;

    if (!value?.messages?.length) return;

    const message = value.messages[0];
    if (message.type !== 'text') return;

    const senderPhone = message.from;
    const messageText = message.text.body;

    console.log(`\n--- Incoming WhatsApp Message ---`);
    console.log(`From : ${senderPhone}`);
    console.log(`Text : ${messageText}`);

    const parsedIntent = await parseIntent(messageText);

    console.log(`Intent:`, JSON.stringify(parsedIntent, null, 2));
    console.log(`---------------------------------\n`);

    const reply = buildReply(parsedIntent);
    await sendTextMessage(senderPhone, reply);
  } catch (err) {
    console.error('Webhook handler error:', err.message);
  }
});

function buildReply(parsed) {
  switch (parsed.intent) {
    case 'book_appointment':
      return 'Samajh gaye! Aapke liye clinic dhundh rahe hain. (Got it! Looking for a clinic near you.)';
    case 'sos':
      return 'Emergency samajh gaye! Abhi family ko message kar rahe hain. (Emergency noted! Alerting your family now.)';
    case 'medication_reminder':
      return 'Dawai reminder set kar denge. (We will set your medication reminder.)';
    case 'status_check':
      return 'Aapki appointment ka status check kar rahe hain. (Checking your appointment status.)';
    default:
      return 'Namaste! Main CareProxy hoon. Aap doctor appointment, dawai reminder, ya emergency help ke liye message kar sakte hain.';
  }
}

export default router;

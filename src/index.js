import './config/env.js';
import express from 'express';
import { config } from './config/env.js';
import whatsappWebhook from './webhook/whatsapp.js';

const app = express();

app.use(express.json());

app.get('/health', (_req, res) => res.json({ status: 'ok', service: 'CareProxy' }));

app.use('/webhook', whatsappWebhook);

app.listen(config.port, () => {
  console.log(`CareProxy running on port ${config.port}`);
  console.log(`Webhook URL: http://localhost:${config.port}/webhook`);
});

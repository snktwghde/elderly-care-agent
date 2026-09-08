import axios from 'axios';
import { config } from '../config/env.js';

const BASE_URL = `https://graph.facebook.com/v21.0/${config.whatsapp.phoneId}/messages`;

export async function sendTextMessage(to, body) {
  const payload = {
    messaging_product: 'whatsapp',
    recipient_type: 'individual',
    to,
    type: 'text',
    text: { body },
  };

  const response = await axios.post(BASE_URL, payload, {
    headers: {
      Authorization: `Bearer ${config.whatsapp.token}`,
      'Content-Type': 'application/json',
    },
  });

  return response.data;
}

export async function sendNamedTemplateMessage(to, templateName, langCode, namedParams = {}) {
  const payload = {
    messaging_product: 'whatsapp',
    recipient_type: 'individual',
    to,
    type: 'template',
    template: {
      name: templateName,
      language: { code: langCode },
      components: Object.keys(namedParams).length ? [{
        type: 'body',
        parameters: Object.entries(namedParams).map(([parameter_name, text]) => ({ type: 'text', parameter_name, text })),
      }] : [],
    },
  };

  const response = await axios.post(BASE_URL, payload, {
    headers: {
      Authorization: `Bearer ${config.whatsapp.token}`,
      'Content-Type': 'application/json',
    },
  });

  return response.data;
}

export async function sendTemplateMessage(to, templateName, langCode, params = []) {
  const payload = {
    messaging_product: 'whatsapp',
    recipient_type: 'individual',
    to,
    type: 'template',
    template: {
      name: templateName,
      language: { code: langCode },
      components: params.length ? [{
        type: 'body',
        parameters: params.map(text => ({ type: 'text', text })),
      }] : [],
    },
  };

  const response = await axios.post(BASE_URL, payload, {
    headers: {
      Authorization: `Bearer ${config.whatsapp.token}`,
      'Content-Type': 'application/json',
    },
  });

  return response.data;
}

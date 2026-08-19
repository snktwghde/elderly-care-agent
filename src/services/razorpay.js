import Razorpay from 'razorpay';
import crypto from 'crypto';
import { config } from '../config/env.js';
import { updateAccount } from './supabase.js';

const razorpay = new Razorpay({
  key_id: config.razorpay.keyId,
  key_secret: config.razorpay.keySecret,
});

export async function createSubscription(accountPhone) {
  const subscription = await razorpay.subscriptions.create({
    plan_id: config.razorpay.planId,
    total_count: 12,
    quantity: 1,
    customer_notify: 0,
    notes: { account_phone: accountPhone },
  });
  return { id: subscription.id, paymentUrl: subscription.short_url };
}

export async function getPaymentLink(subscriptionId) {
  const subscription = await razorpay.subscriptions.fetch(subscriptionId);
  return subscription.short_url;
}

export async function getOrCreatePaymentLink(account) {
  if (account.razorpay_subscription_id) {
    return getPaymentLink(account.razorpay_subscription_id);
  }
  const { id, paymentUrl } = await createSubscription(account.account_phone);
  await updateAccount(account.account_phone, { razorpay_subscription_id: id });
  return paymentUrl;
}

export function verifyWebhookSignature(rawBody, signature) {
  const secret = process.env.RAZORPAY_WEBHOOK_SECRET;
  if (!secret) throw new Error('RAZORPAY_WEBHOOK_SECRET not set');
  const expectedBuf = crypto
    .createHmac('sha256', secret)
    .update(rawBody)
    .digest();
  const sigBuf = Buffer.from(signature, 'hex');
  if (expectedBuf.length !== sigBuf.length) return false;
  return crypto.timingSafeEqual(expectedBuf, sigBuf);
}

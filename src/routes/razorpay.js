import express from 'express';
import { verifyWebhookSignature } from '../services/razorpay.js';
import { updateAccount, getOrCreateAccount } from '../services/supabase.js';

const router = express.Router();

router.post('/', async (req, res) => {
  const signature = req.headers['x-razorpay-signature'];
  if (!signature) return res.status(400).end();

  try {
    const valid = verifyWebhookSignature(req.body, signature);
    if (!valid) return res.status(401).end();
  } catch (err) {
    console.error('Razorpay webhook signature error:', err.message);
    return res.status(500).end();
  }

  let event;
  try {
    event = JSON.parse(req.body.toString());
  } catch {
    return res.status(400).end();
  }

  const subscription = event?.payload?.subscription?.entity;
  const accountPhone = subscription?.notes?.account_phone;

  if (!accountPhone) return res.status(200).end();

  // Cross-check subscription ID matches what we stored — prevents cross-account manipulation
  const storedAccount = await getOrCreateAccount(accountPhone).catch(() => null);
  if (storedAccount?.razorpay_subscription_id && storedAccount.razorpay_subscription_id !== subscription.id) {
    console.error('Razorpay webhook: subscription ID mismatch for', accountPhone.slice(0, 5) + '***');
    return res.status(400).end();
  }

  if (event.event === 'subscription.charged') {
    await updateAccount(accountPhone, {
      subscription_status: 'active',
      razorpay_subscription_id: subscription.id,
    }).catch(e => console.error('Failed to activate subscription:', e.message));
  }

  if (['subscription.cancelled', 'subscription.halted', 'subscription.completed'].includes(event.event)) {
    await updateAccount(accountPhone, {
      subscription_status: 'expired',
    }).catch(e => console.error('Failed to expire subscription:', e.message));
  }

  res.status(200).end();
});

export default router;

/**
 * payment.ts — Stripe checkout + webhook handlers.
 *
 * Identity = sed address + passphrase (verified against existing position_hashes).
 * No Supabase auth, no new user model. Stripe handles payment + email collection.
 * Webhook records the subscription in beach_subscriptions.
 */

import type { IncomingMessage, ServerResponse } from 'node:http';
import { getClient, getBlock } from '../db.js';
import { hashPassphrase } from '../tools/collective-ops.js';
import { beachPage, landingPage, successPage, errorPage } from '../pages.js';

const STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY || '';
const STRIPE_WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET || '';
const STRIPE_PRICE_ID = process.env.STRIPE_PRICE_ID || '';
const SITE_URL = process.env.SITE_URL || 'https://beach.hermitcrab.me';

// ── Helpers ──

function html(res: ServerResponse, status: number, body: string) {
  res.writeHead(status, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end(body);
}

async function readBody(req: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk);
  }
  return Buffer.concat(chunks).toString('utf-8');
}

/** Parse sed address into collective + position. Returns null if invalid. */
function parseSedAddress(addr: string): { collective: string; position: string } | null {
  const parts = addr.trim().split(':');
  if (parts.length !== 3 || parts[0] !== 'sed') return null;
  const pos = parseInt(parts[2], 10);
  if (isNaN(pos) || pos < 1 || pos > 9) return null;
  return { collective: parts[1], position: parts[2] };
}

// ── Route handlers ──

export function handleBeach(_req: IncomingMessage, res: ServerResponse) {
  html(res, 200, beachPage());
}

export function handleLifeguard(_req: IncomingMessage, res: ServerResponse) {
  html(res, 200, landingPage());
}

export function handleSuccess(_req: IncomingMessage, res: ServerResponse) {
  html(res, 200, successPage());
}

export async function handleCheckout(req: IncomingMessage, res: ServerResponse) {
  const raw = await readBody(req);
  const params = new URLSearchParams(raw);
  const sedAddress = params.get('sed_address')?.trim() || '';
  const passphrase = params.get('passphrase') || '';

  if (!sedAddress || !passphrase) {
    html(res, 400, errorPage('Sedimentary address and passphrase are required.'));
    return;
  }

  // Parse and validate
  const parsed = parseSedAddress(sedAddress);
  if (!parsed) {
    html(res, 400, errorPage('Invalid sedimentary address. Expected format: sed:collective:position (e.g. sed:commons:3)'));
    return;
  }

  // Look up the collective block
  const owner = `sed:${parsed.collective}`;
  const row = await getBlock(owner, parsed.collective);
  if (!row) {
    html(res, 400, errorPage(`Collective "${parsed.collective}" not found.`));
    return;
  }

  // Check position exists
  const block = row.block;
  if (block[parsed.position] === undefined) {
    html(res, 400, errorPage(`Position ${parsed.position} in "${parsed.collective}" is empty. Register first through the pscale MCP.`));
    return;
  }

  // Verify passphrase
  const hashes = row.position_hashes || {};
  const storedHash = hashes[parsed.position];
  if (!storedHash) {
    html(res, 400, errorPage(`Position ${parsed.position} has no passphrase hash. Something is wrong with this registration.`));
    return;
  }

  const computedHash = await hashPassphrase(passphrase, parsed.collective, parsed.position);
  if (computedHash !== storedHash) {
    html(res, 403, errorPage('Incorrect passphrase.'));
    return;
  }

  // Check if already backed
  const { data: existing } = await getClient()
    .from('beach_subscriptions')
    .select('id')
    .eq('sed_address', sedAddress)
    .maybeSingle();

  if (existing) {
    html(res, 200, errorPage('This position is already backed up. You\'re covered.'));
    return;
  }

  // Check Stripe config before calling API
  if (!STRIPE_SECRET_KEY || !STRIPE_PRICE_ID) {
    html(res, 500, errorPage('Payment system not configured. Contact support.'));
    return;
  }

  // Create Stripe Checkout session
  const stripeParams = new URLSearchParams({
    'mode': 'payment',
    'line_items[0][price]': STRIPE_PRICE_ID,
    'line_items[0][quantity]': '1',
    'success_url': `${SITE_URL}/success`,
    'cancel_url': SITE_URL,
    'customer_creation': 'always',
    'metadata[sed_address]': sedAddress,
  });

  const stripeRes = await fetch('https://api.stripe.com/v1/checkout/sessions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${STRIPE_SECRET_KEY}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: stripeParams.toString(),
  });

  const session = await stripeRes.json();

  if (session.error) {
    html(res, 500, errorPage(`Payment error: ${session.error.message}`));
    return;
  }

  // Redirect to Stripe Checkout
  res.writeHead(303, { 'Location': session.url });
  res.end();
}

export async function handleWebhook(req: IncomingMessage, res: ServerResponse) {
  if (!STRIPE_WEBHOOK_SECRET) {
    res.writeHead(500);
    res.end('Webhook not configured');
    return;
  }

  const body = await readBody(req);
  const sig = req.headers['stripe-signature'] as string | undefined;

  if (!sig) {
    res.writeHead(400);
    res.end('Missing signature');
    return;
  }

  let event: any;
  try {
    event = await verifyStripeWebhook(body, sig, STRIPE_WEBHOOK_SECRET);
  } catch (err) {
    console.error('Webhook verification failed:', err);
    res.writeHead(400);
    res.end('Invalid signature');
    return;
  }

  if (event.type !== 'checkout.session.completed') {
    res.writeHead(200);
    res.end(JSON.stringify({ received: true }));
    return;
  }

  const session = event.data.object;
  const sedAddress = session.metadata?.sed_address;
  const email = session.customer_details?.email || session.customer_email;
  const customerId = session.customer;

  if (!sedAddress) {
    console.error('No sed_address in checkout metadata', session.id);
    res.writeHead(400);
    res.end('Missing sed_address');
    return;
  }

  // Record the subscription
  const { error } = await getClient()
    .from('beach_subscriptions')
    .upsert({
      sed_address: sedAddress,
      stripe_customer_id: customerId || null,
      stripe_session_id: session.id,
      email: email || null,
      backed_at: new Date().toISOString(),
    }, { onConflict: 'sed_address' });

  if (error) {
    console.error('Failed to record subscription:', error);
    res.writeHead(500);
    res.end('DB error');
    return;
  }

  console.log(`Beach backup registered: ${sedAddress} (${email || 'no email'})`);
  res.writeHead(200);
  res.end(JSON.stringify({ received: true }));
}

// ── Stripe webhook signature verification ──
// Same manual HMAC approach as xstream-play (no SDK needed)

async function verifyStripeWebhook(
  payload: string,
  sigHeader: string,
  secret: string,
): Promise<any> {
  const parts = sigHeader.split(',').reduce(
    (acc, part) => {
      const [key, val] = part.split('=');
      if (key === 't') acc.timestamp = val;
      if (key === 'v1') acc.signatures.push(val);
      return acc;
    },
    { timestamp: '', signatures: [] as string[] },
  );

  const signedPayload = `${parts.timestamp}.${payload}`;
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const sig = await crypto.subtle.sign(
    'HMAC',
    key,
    new TextEncoder().encode(signedPayload),
  );
  const expectedSig = Array.from(new Uint8Array(sig))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');

  const valid = parts.signatures.some(s => s === expectedSig);
  if (!valid) throw new Error('Invalid webhook signature');

  // Reject events older than 5 minutes
  const age = Math.floor(Date.now() / 1000) - parseInt(parts.timestamp);
  if (age > 300) throw new Error('Webhook timestamp too old');

  return JSON.parse(payload);
}

// bKash Tokenized Checkout client (grant token, create, execute, query).
//
// Turn it on in backend/.env with the credentials from your bKash merchant account:
//   BKASH_MODE=sandbox            (or "live" once bKash approves your merchant account)
//   BKASH_USERNAME=...  BKASH_PASSWORD=...  BKASH_APP_KEY=...  BKASH_APP_SECRET=...
//
// Request shapes follow bKash's tokenized checkout v1.2.0-beta. They could not be checked
// against bKash's own reference or sandbox while this was written (no credentials), so run
// one sandbox payment end to end before relying on it. BKASH_BASE_URL overrides the host.
const SANDBOX = 'https://tokenized.sandbox.bka.sh/v1.2.0-beta';
const LIVE = 'https://tokenized.pay.bka.sh/v1.2.0-beta';

let cached = { token: null, expiresAt: 0 };

function baseUrl() {
  if (process.env.BKASH_BASE_URL) return process.env.BKASH_BASE_URL.replace(/\/$/, '');
  return process.env.BKASH_MODE === 'live' ? LIVE : SANDBOX;
}

function enabled() {
  return (
    ['sandbox', 'live'].includes(process.env.BKASH_MODE) &&
    Boolean(process.env.BKASH_USERNAME && process.env.BKASH_PASSWORD && process.env.BKASH_APP_KEY && process.env.BKASH_APP_SECRET)
  );
}

async function post(path, headers, body) {
  let response;
  try {
    response = await fetch(`${baseUrl()}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json', ...headers },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(30000),
    });
  } catch (error) {
    throw new Error(`Could not reach bKash (${error.message}).`);
  }

  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(`bKash returned HTTP ${response.status}.`);
  return data;
}

async function grantToken() {
  if (cached.token && Date.now() < cached.expiresAt) return cached.token;

  const data = await post(
    '/tokenized/checkout/token/grant',
    { username: process.env.BKASH_USERNAME, password: process.env.BKASH_PASSWORD },
    { app_key: process.env.BKASH_APP_KEY, app_secret: process.env.BKASH_APP_SECRET }
  );

  if (!data.id_token) throw new Error(data.statusMessage || 'bKash did not return a token.');

  // Refresh a minute early so a token never expires mid-request.
  cached = { token: data.id_token, expiresAt: Date.now() + (Number(data.expires_in) || 3600) * 1000 - 60000 };
  return cached.token;
}

async function authorised(path, body) {
  const token = await grantToken();
  const data = await post(path, { authorization: token, 'x-app-key': process.env.BKASH_APP_KEY }, body);

  // bKash reports business errors in the body, usually with HTTP 200.
  if (data.statusCode && data.statusCode !== '0000') {
    throw new Error(data.statusMessage || `bKash error ${data.statusCode}.`);
  }
  return data;
}

/** Starts a payment. Returns { paymentID, bkashURL }: send the customer to bkashURL. */
async function createPayment({ amount, invoice, payerReference, callbackURL }) {
  const data = await authorised('/tokenized/checkout/create', {
    mode: '0011',
    payerReference: payerReference || 'customer',
    callbackURL,
    amount: Number(amount).toFixed(2),
    currency: 'BDT',
    intent: 'sale',
    merchantInvoiceNumber: invoice,
  });

  if (!data.paymentID || !data.bkashURL) throw new Error('bKash did not return a payment link.');
  return { paymentID: data.paymentID, bkashURL: data.bkashURL };
}

/** Confirms the payment after the customer approved it. */
function executePayment(paymentID) {
  return authorised('/tokenized/checkout/execute', { paymentID });
}

/** Asks bKash for the current state of a payment. */
function queryPayment(paymentID) {
  return authorised('/tokenized/checkout/payment/status', { paymentID });
}

function resetTokenCache() {
  cached = { token: null, expiresAt: 0 };
}

module.exports = { enabled, createPayment, executePayment, queryPayment, resetTokenCache };

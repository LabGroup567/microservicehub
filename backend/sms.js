// Sends text messages. Pick a provider with SMS_PROVIDER in backend/.env:
//   twilio     - needs TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_FROM
//   bulksmsbd  - needs BULKSMSBD_API_KEY, BULKSMSBD_SENDER_ID (approved sender ID)
// With nothing configured, messages are printed in the server terminal (development).
const outbox = []; // used by tests (SMS_TRANSPORT=memory)

function mode() {
  if (process.env.SMS_TRANSPORT === 'memory') return 'memory';
  if (process.env.SMS_PROVIDER === 'twilio' && process.env.TWILIO_ACCOUNT_SID) return 'twilio';
  if (process.env.SMS_PROVIDER === 'bulksmsbd' && process.env.BULKSMSBD_API_KEY) return 'bulksmsbd';
  return 'console';
}

/** True when real texts can be delivered (the Profile page uses this to explain the option). */
function smsAvailable() {
  return ['twilio', 'bulksmsbd', 'memory'].includes(mode());
}

// Bangladeshi mobile numbers: 01XXXXXXXXX -> 8801XXXXXXXXX
function toInternational(phone) {
  const digits = String(phone || '').replace(/[^\d]/g, '').replace(/^88/, '');
  return /^01[3-9]\d{8}$/.test(digits) ? `88${digits}` : null;
}

async function sendViaTwilio(to, body) {
  const sid = process.env.TWILIO_ACCOUNT_SID;
  const auth = Buffer.from(`${sid}:${process.env.TWILIO_AUTH_TOKEN}`).toString('base64');

  const response = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`, {
    method: 'POST',
    headers: { Authorization: `Basic ${auth}`, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ To: `+${to}`, From: process.env.TWILIO_FROM, Body: body }),
  });

  if (!response.ok) throw new Error(`Twilio responded ${response.status}: ${(await response.text()).slice(0, 200)}`);
}

async function sendViaBulkSmsBd(to, body) {
  const response = await fetch('https://bulksmsbd.net/api/smsapi', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      api_key: process.env.BULKSMSBD_API_KEY,
      senderid: process.env.BULKSMSBD_SENDER_ID,
      number: to,
      message: body,
    }),
  });

  if (!response.ok) throw new Error(`BulkSMSBD responded ${response.status}`);
}

/** Sends one SMS to a Bangladeshi number. Never throws. Returns true when it was handed off. */
async function sendSms(phone, body) {
  const to = toInternational(phone);
  if (!to) return false;

  const text = String(body).slice(0, 300);

  try {
    switch (mode()) {
      case 'memory':
        outbox.push({ to, body: text });
        break;
      case 'twilio':
        await sendViaTwilio(to, text);
        break;
      case 'bulksmsbd':
        await sendViaBulkSmsBd(to, text);
        break;
      default:
        console.log(`\n--- SMS (no provider configured, printed here) ---\nTo: +${to}\n${text}\n---\n`);
    }
    return true;
  } catch (error) {
    console.error('SMS failed:', error.message);
    return false;
  }
}

module.exports = { sendSms, smsAvailable, toInternational, outbox, mode };

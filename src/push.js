import { apiFetch } from './api.js';

export function pushSupported() {
  return (
    'serviceWorker' in navigator &&
    'PushManager' in window &&
    'Notification' in window &&
    window.isSecureContext
  );
}

function keyToBytes(base64) {
  const padded = `${base64}${'='.repeat((4 - (base64.length % 4)) % 4)}`
    .replace(/-/g, '+')
    .replace(/_/g, '/');
  const raw = atob(padded);
  return Uint8Array.from(raw, (char) => char.charCodeAt(0));
}

async function registration() {
  return navigator.serviceWorker.register('/sw.js');
}

/** Returns 'unsupported', 'blocked', 'off' or 'on'. */
export async function getPushState() {
  if (!pushSupported()) return 'unsupported';
  if (Notification.permission === 'denied') return 'blocked';

  const reg = await navigator.serviceWorker.getRegistration('/sw.js');
  const sub = reg ? await reg.pushManager.getSubscription() : null;
  return sub && Notification.permission === 'granted' ? 'on' : 'off';
}

export async function enablePush() {
  if (!pushSupported()) {
    throw new Error('This browser or connection does not support phone notifications (HTTPS is required).');
  }

  const permission = await Notification.requestPermission();
  if (permission !== 'granted') {
    throw new Error('Notifications are blocked. Allow them in your browser settings and try again.');
  }

  const config = await apiFetch('/push/key', { auth: false });
  if (!config.enabled) throw new Error('Push notifications are not configured on the server.');

  const reg = await registration();
  await navigator.serviceWorker.ready;

  const subscription =
    (await reg.pushManager.getSubscription()) ||
    (await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: keyToBytes(config.public_key),
    }));

  await apiFetch('/push/subscribe', {
    method: 'POST',
    body: { subscription: subscription.toJSON() },
  });
}

export async function disablePush() {
  const reg = await navigator.serviceWorker.getRegistration('/sw.js');
  const subscription = reg ? await reg.pushManager.getSubscription() : null;

  if (subscription) {
    await apiFetch('/push/unsubscribe', {
      method: 'POST',
      body: { endpoint: subscription.endpoint },
    }).catch(() => {});
    await subscription.unsubscribe();
  }
}
